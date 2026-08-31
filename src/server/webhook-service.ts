import { randomBytes } from 'crypto'
import { lookup } from 'dns/promises'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError } from '@/domain/errors'
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
  assinarPayload,
} from '@/domain/webhook/assinatura'
import { ehIpPrivado, validarUrlDestino } from '@/domain/webhook/destino'
import { MAXIMO_TENTATIVAS, deveRetentar, proximaTentativaEm } from '@/domain/webhook/retentativa'

/** Eventos que a plataforma publica, conforme a spec 5.7. */
export const EVENTOS = [
  'order.created',
  'order.released',
  'order.generated',
  'order.posted',
  'order.delivered',
  'order.cancelled',
] as const

export type Evento = (typeof EVENTOS)[number]

/** Tempo máximo de uma tentativa. Endpoint lento não segura a fila. */
const TIMEOUT_MS = 10_000

/** Quantas entregas um disparo processa por vez. */
const LOTE_PADRAO = 50

/**
 * Gera o segredo de assinatura. 32 bytes de aleatoriedade criptográfica —
 * `Math.random()` aqui permitiria a terceiros forjar entregas assinadas.
 */
export function gerarSegredo(): string {
  return randomBytes(32).toString('hex')
}

export function ehEvento(valor: string): valor is Evento {
  return (EVENTOS as readonly string[]).includes(valor)
}

/**
 * Cadastra o destino de webhook de um cliente. A URL é validada antes de
 * gravar: destino interno recusado no cadastro nunca chega a virar uma
 * requisição saindo do nosso servidor.
 */
export async function cadastrarWebhook(
  userId: string,
  url: string,
  eventos: string[],
): Promise<{ id: string; url: string; eventos: string[]; segredo: string }> {
  const destino = validarUrlDestino(url)
  if (!destino.valida) {
    throw new ArquivoInvalidoError(destino.motivo)
  }

  const desconhecidos = eventos.filter((evento) => !ehEvento(evento))
  if (eventos.length === 0 || desconhecidos.length > 0) {
    throw new ArquivoInvalidoError(
      desconhecidos.length > 0
        ? `Evento desconhecido: ${desconhecidos.join(', ')}.`
        : 'Informe ao menos um evento.',
    )
  }

  const segredo = gerarSegredo()
  const app = await prisma.webhookApp.create({
    data: { userId, url: destino.url.toString(), eventos, segredo },
  })

  // O segredo volta só aqui, na criação. Depois disso não é exibido de novo:
  // quem perder gera outro.
  return { id: app.id, url: app.url, eventos, segredo }
}

/**
 * Enfileira o evento para todos os webhooks ativos do dono do envio.
 *
 * Recebe a transação do chamador e **não faz I/O de rede**: a chamada HTTP
 * dentro de uma transação de banco prende a conexão pelo tempo de um
 * servidor de terceiro responder, e um timeout dele derruba o commit do
 * pagamento. Aqui só se gravam linhas; a entrega acontece depois, no
 * disparo.
 *
 * O payload é congelado agora. Se o envio mudar em seguida, a notificação
 * continua descrevendo o que aconteceu naquele instante.
 */
export async function enfileirarEvento(
  shipmentId: string,
  evento: Evento,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const envio = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      codigoRastreio: true,
      precoCobradoCentavos: true,
      criadoEm: true,
    },
  })

  if (!envio) {
    return 0
  }

  const apps = await tx.webhookApp.findMany({
    where: { userId: envio.userId, ativo: true },
    select: { id: true, eventos: true },
  })

  const interessados = apps.filter((app) =>
    Array.isArray(app.eventos) ? (app.eventos as string[]).includes(evento) : false,
  )

  if (interessados.length === 0) {
    return 0
  }

  const payload = montarPayload(evento, envio)

  await tx.webhookDelivery.createMany({
    data: interessados.map((app) => ({
      webhookAppId: app.id,
      evento,
      payload,
      // Primeira tentativa é imediata: o disparo pega tudo que está vencido.
      proximaTentativaEm: new Date(),
    })),
  })

  return interessados.length
}

type EnvioPayload = {
  id: string
  status: string
  codigoRastreio: string | null
  precoCobradoCentavos: number
  criadoEm: Date
}

/**
 * Formato do payload, espelhando o do SuperFrete para que plugins existentes
 * funcionem trocando apenas a base URL. `tracking` é nulo enquanto o envio
 * não tem código — o que, na prática, significa antes de `order.generated`.
 */
function montarPayload(evento: Evento, envio: EnvioPayload) {
  return {
    event: evento,
    data: {
      id: envio.id,
      status: envio.status,
      tracking: envio.codigoRastreio,
      tracking_url: envio.codigoRastreio ? `/r/${envio.codigoRastreio}` : null,
      price: (envio.precoCobradoCentavos / 100).toFixed(2),
      created_at: envio.criadoEm.toISOString(),
    },
    sent_at: new Date().toISOString(),
  }
}

/**
 * Resolve o host e recusa quando o IP aponta para dentro.
 *
 * Validar apenas a URL cadastrada não protege: um domínio público sob
 * controle do cliente pode resolver para `127.0.0.1` ou para o endereço de
 * metadados da nuvem. Como o DNS pode mudar entre o cadastro e a entrega,
 * esta checagem roda a cada tentativa.
 */
async function destinoSeguro(url: URL, resolver: ResolvedorDns): Promise<boolean> {
  if (!validarUrlDestino(url.toString()).valida) {
    return false
  }

  try {
    const enderecos = await resolver(url.hostname)
    return enderecos.length > 0 && enderecos.every((endereco) => !ehIpPrivado(endereco))
  } catch {
    return false
  }
}

/**
 * Resolução de nome, injetável. O padrão consulta o DNS real; o teste passa
 * um resolvedor próprio para exercitar o caso de domínio público que aponta
 * para dentro, sem depender de rede nem de um domínio de verdade que resolva
 * para loopback.
 */
export type ResolvedorDns = (host: string) => Promise<string[]>

export const resolverDnsPadrao: ResolvedorDns = async (host) => {
  const enderecos = await lookup(host, { all: true })
  return enderecos.map(({ address }) => address)
}

export type ResultadoDisparo = { entregues: number; falhas: number; desistidas: number }

/**
 * Processa as entregas vencidas.
 *
 * Cada entrega é isolada: uma que falha registra o próprio erro e reagenda a
 * si mesma, sem interromper as demais. Um cliente com endpoint quebrado não
 * atrasa o webhook de todo mundo — é o critério de aceite do roadmap.
 *
 * `redirect: 'manual'` porque seguir redirecionamento automaticamente
 * escaparia da validação de IP: o primeiro salto pode ser público e o
 * segundo, interno.
 */
export async function dispararPendentes(
  agora = new Date(),
  limite = LOTE_PADRAO,
  resolver: ResolvedorDns = resolverDnsPadrao,
): Promise<ResultadoDisparo> {
  const pendentes = await prisma.webhookDelivery.findMany({
    where: {
      entregueEm: null,
      proximaTentativaEm: { not: null, lte: agora },
      tentativas: { lt: MAXIMO_TENTATIVAS },
    },
    include: { webhookApp: true },
    orderBy: { proximaTentativaEm: 'asc' },
    take: limite,
  })

  const resultado: ResultadoDisparo = { entregues: 0, falhas: 0, desistidas: 0 }

  for (const entrega of pendentes) {
    const tentativas = entrega.tentativas + 1
    const corpo = JSON.stringify(entrega.payload)

    let statusHttp: number | null = null
    let erro: string | null = null

    if (!entrega.webhookApp.ativo) {
      // Desativado depois do enfileiramento: não insiste.
      await prisma.webhookDelivery.update({
        where: { id: entrega.id },
        data: { tentativas, erro: 'Webhook desativado.', proximaTentativaEm: null },
      })
      resultado.desistidas += 1
      continue
    }

    try {
      const url = new URL(entrega.webhookApp.url)
      if (!(await destinoSeguro(url, resolver))) {
        await prisma.webhookDelivery.update({
          where: { id: entrega.id },
          data: {
            tentativas,
            erro: 'Destino recusado: resolve para endereço de rede interna.',
            proximaTentativaEm: null,
          },
        })
        resultado.desistidas += 1
        continue
      }

      const { assinatura, timestamp } = assinarPayload(entrega.webhookApp.segredo, corpo, agora)

      const resposta = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          [CABECALHO_ASSINATURA]: assinatura,
          [CABECALHO_TIMESTAMP]: timestamp,
          'user-agent': 'frete-webhook/1',
        },
        body: corpo,
      })

      statusHttp = resposta.status
    } catch (causa) {
      erro = causa instanceof Error ? causa.message.slice(0, 500) : 'Falha na entrega.'
    }

    const entregue = statusHttp !== null && statusHttp >= 200 && statusHttp < 300

    if (entregue) {
      await prisma.webhookDelivery.update({
        where: { id: entrega.id },
        data: { tentativas, statusHttp, erro: null, entregueEm: agora, proximaTentativaEm: null },
      })
      resultado.entregues += 1
      continue
    }

    const proxima = deveRetentar(statusHttp) ? proximaTentativaEm(tentativas, agora) : null

    await prisma.webhookDelivery.update({
      where: { id: entrega.id },
      data: { tentativas, statusHttp, erro, proximaTentativaEm: proxima },
    })

    if (proxima) {
      resultado.falhas += 1
    } else {
      resultado.desistidas += 1
    }
  }

  return resultado
}

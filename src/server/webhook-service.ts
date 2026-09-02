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
const TIMEOUT_MS = 5_000

/** Quantas entregas um disparo processa por vez. */
const LOTE_PADRAO = 20

/**
 * Teto de tempo do disparo inteiro.
 *
 * O laço é sequencial, então sem este teto um lote de destinos lentos
 * multiplica o tempo limite individual pelo tamanho do lote e prende a
 * requisição por minutos — o suficiente para ocupar o servidor e fazer a
 * aplicação inteira parecer travada. Quando o orçamento acaba, o disparo
 * devolve o que conseguiu; o que sobrou continua na fila, vencido, e sai na
 * próxima chamada.
 */
const ORCAMENTO_MS = 20_000

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
      precoFreteCentavos: true,
      precoCobradoCentavos: true,
      criadoEm: true,
      referenciaExterna: true,
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
  /** O transporte. É o que o integrador mostra ao comprador dele. */
  precoFreteCentavos: number
  /** A taxa por etiqueta. Fica fora do payload — ver `montarPayload`. */
  precoCobradoCentavos: number
  criadoEm: Date
  referenciaExterna: string | null
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
      /*
        A referência da loja viaja no mesmo evento que traz o código. Sem
        ela, quem recebe o webhook precisa de uma consulta extra só para
        saber de qual pedido dele se trata.
      */
      external_id: envio.referenciaExterna,
      /*
        O FRETE, não a taxa por etiqueta.

        Vinha de `precoCobradoCentavos` — o R$ 1,00 que a plataforma cobra
        do lojista — onde o integrador espera o valor do transporte. O
        mesmo erro já tinha sido corrigido no /cart e no /order/info; aqui
        ficou para trás, e uma loja que gravasse este campo como custo de
        envio registraria 1,00 no lugar de 28,00.

        A taxa não entra no payload de propósito: ela é assunto entre a
        plataforma e o lojista, e quem consome o webhook nada tem a ver com
        ela. Quem precisar dela lê `label_fee` em /order/info.
      */
      price: (envio.precoFreteCentavos / 100).toFixed(2),
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

export type ResultadoDisparo = {
  entregues: number
  falhas: number
  desistidas: number
  /** Vencidas que não couberam no orçamento de tempo desta chamada. */
  restantes: number
}

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

  const resultado: ResultadoDisparo = { entregues: 0, falhas: 0, desistidas: 0, restantes: 0 }
  const limiteDeTempo = Date.now() + ORCAMENTO_MS

  for (const [indice, entrega] of pendentes.entries()) {
    if (Date.now() >= limiteDeTempo) {
      // Sem efeito colateral nenhum sobre as não processadas: seguem
      // vencidas na fila, com as mesmas tentativas, para a próxima chamada.
      resultado.restantes = pendentes.length - indice
      break
    }

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

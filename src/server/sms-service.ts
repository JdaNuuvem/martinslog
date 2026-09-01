import type { CanalMensagem } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { env } from '@/env'
import { cifrar, decifrar, dicaDaChave } from '@/infra/crypto/segredo'
import { smsProvider, type CredenciaisSms } from '@/infra/sms'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { compor, custoDoTexto, TEXTOS_PADRAO_SMS } from '@/domain/mensagem/texto'

/**
 * Canal de SMS: da configuração ao envio.
 *
 * A fila e o histórico são os mesmos do WhatsApp (`MensagemEnvio`), porque o
 * problema é o mesmo: gravar primeiro, enviar depois, registrar o motivo de
 * cada falha. O que muda é onde o texto mora — no WhatsApp ele vive aprovado
 * na Meta, aqui ele é nosso.
 */

/** Espera antes de cada nova tentativa, em minutos. */
const ATRASOS_MINUTOS = [2, 10, 60, 360] as const
const MAXIMO_TENTATIVAS = ATRASOS_MINUTOS.length + 1

const LOTE_PADRAO = 25
const ORCAMENTO_MS = 25_000

function proximaTentativaEm(tentativasFeitas: number, agora = new Date()): Date | null {
  const atraso = ATRASOS_MINUTOS[tentativasFeitas - 1]
  if (atraso === undefined) return null
  return new Date(atraso * 60 * 1000 + agora.getTime())
}

/* ===================== Credenciais ===================== */

export type OrigemCredencial = 'perfil' | 'plataforma' | 'nenhuma'

export type CredencialResolvida = {
  origem: OrigemCredencial
  provedor: string
  credenciais: CredenciaisSms | null
}

/**
 * De quem é a conta que vai pagar este envio.
 *
 * O perfil tem precedência sobre a plataforma. A ordem importa: a loja que se
 * deu ao trabalho de contratar a própria conta espera aparecer como o próprio
 * remetente e pagar o próprio envio — cair na conta da plataforma sem aviso
 * seria a plataforma pagando pelo que não é dela.
 *
 * Sem nenhuma das duas, devolve `nenhuma` em vez de estourar. Não é erro: é
 * uma conta que ainda não ligou o canal, e a fila registra isso no histórico.
 */
export async function resolverCredencial(perfilId: string): Promise<CredencialResolvida> {
  const doPerfil = await prisma.smsConfig.findUnique({ where: { perfilId } })

  if (doPerfil?.ativo) {
    return {
      origem: 'perfil',
      provedor: doPerfil.provedor,
      credenciais: {
        identificador: doPerfil.identificador,
        chave: decifrar(doPerfil.chaveCifrada),
        remetente: doPerfil.remetente,
      },
    }
  }

  if (env.SMS_CHAVE && env.SMS_PROVEDOR) {
    return {
      origem: 'plataforma',
      provedor: env.SMS_PROVEDOR,
      credenciais: {
        identificador: env.SMS_IDENTIFICADOR ?? null,
        chave: env.SMS_CHAVE,
        remetente: env.SMS_REMETENTE ?? null,
      },
    }
  }

  return { origem: 'nenhuma', provedor: 'registrado', credenciais: null }
}

export type EntradaConfigSms = {
  provedor: string
  chave?: string | null
  identificador?: string | null
  remetente?: string | null
}

/** Guarda a conta própria de uma loja. A chave nunca volta em leitura. */
export async function salvarConfig(perfilId: string, entrada: EntradaConfigSms) {
  const atual = await prisma.smsConfig.findUnique({ where: { perfilId } })
  const chave = entrada.chave?.trim()

  if (!chave && !atual) {
    throw new Error('Informe a chave do provedor de SMS.')
  }

  const dados = {
    provedor: entrada.provedor.trim().toLowerCase(),
    identificador: entrada.identificador?.trim() || null,
    remetente: entrada.remetente?.trim() || null,
    ativo: true,
    ...(chave ? { chaveCifrada: cifrar(chave), dicaChave: dicaDaChave(chave) } : {}),
  }

  return prisma.smsConfig.upsert({
    where: { perfilId },
    create: { perfilId, chaveCifrada: cifrar(chave!), dicaChave: dicaDaChave(chave!), ...dados },
    update: dados,
  })
}

/* ===================== Textos ===================== */

/**
 * Garante que a loja tenha um texto para o evento.
 *
 * Cria o padrão na primeira vez em que o evento acontece, em vez de exigir
 * que alguém preencha uma tela antes de a primeira venda ser avisada. Um canal
 * ligado que não manda nada porque ninguém escreveu o texto é a forma mais
 * silenciosa de o recurso não existir.
 *
 * O texto é editável depois; este é só o ponto de partida.
 */
export async function garantirTemplate(perfilId: string, evento: string) {
  const existente = await prisma.mensagemTemplate.findUnique({
    where: { perfilId_evento_canal: { perfilId, evento, canal: 'SMS' } },
  })
  if (existente) return existente

  const padrao = TEXTOS_PADRAO_SMS[evento]
  if (!padrao) return null

  return prisma.mensagemTemplate.create({
    data: {
      perfilId,
      canal: 'SMS',
      evento,
      nome: `sms-${evento.toLowerCase()}`,
      previa: padrao,
      variaveis: [],
    },
  })
}

/* ===================== Fila ===================== */

export type PedidoDeSms = {
  perfilId: string
  evento: string
  para: string
  pedidoId?: string | null
  shipmentId?: string | null
  valores: Record<string, string | null | undefined>
}

export type ResultadoEnfileiramento =
  | 'enfileirada'
  | 'sem-template'
  | 'telefone-invalido'
  | 'repetida'

/**
 * Põe um SMS na fila.
 *
 * Diferente do WhatsApp, **não exige credencial configurada**. A mensagem é
 * enfileirada de qualquer jeito e o disparo decide por onde ela sai — inclusive
 * pelo provedor que só registra, quando não há conta contratada.
 *
 * A escolha é deliberada: recusar no enfileiramento faria as mensagens de hoje
 * desaparecerem, e no dia em que a conta fosse ligada não haveria histórico
 * nenhum mostrando o que teria sido enviado. Enfileirar sempre transforma o
 * período sem fornecedor num ensaio observável.
 */
export async function enfileirarSms(entrada: PedidoDeSms): Promise<ResultadoEnfileiramento> {
  const template = await garantirTemplate(entrada.perfilId, entrada.evento)
  if (!template || !template.ativo) return 'sem-template'

  const para = normalizarTelefone(entrada.para)
  if (!para) return 'telefone-invalido'

  try {
    await prisma.mensagemEnvio.create({
      data: {
        perfilId: entrada.perfilId,
        canal: 'SMS' as CanalMensagem,
        templateId: template.id,
        pedidoId: entrada.pedidoId ?? null,
        shipmentId: entrada.shipmentId ?? null,
        evento: entrada.evento,
        para,
        proximaTentativaEm: new Date(),
      },
    })
    return 'enfileirada'
  } catch (erro) {
    if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') {
      return 'repetida'
    }
    throw erro
  }
}

/* ===================== Disparo ===================== */

export type ResultadoDisparo = {
  enviadas: number
  falhas: number
  desistidas: number
  restantes: number
}

/**
 * Processa os SMS vencidos.
 *
 * Como a fila de webhooks, é sob demanda: quem chama é o agendador. Enquanto
 * ninguém chamar, nada se perde — as mensagens ficam pendentes no banco.
 */
export async function dispararSmsPendentes(limite = LOTE_PADRAO): Promise<ResultadoDisparo> {
  const comecou = Date.now()

  const pendentes = await prisma.mensagemEnvio.findMany({
    where: {
      canal: 'SMS',
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
    orderBy: { proximaTentativaEm: 'asc' },
    take: limite,
    include: {
      template: true,
      pedido: true,
      perfil: { select: { nome: true, nomeExibicao: true } },
    },
  })

  let enviadas = 0
  let falhas = 0
  let desistidas = 0

  for (const item of pendentes) {
    if (Date.now() - comecou > ORCAMENTO_MS) break

    if (!item.template) {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'DESISTIU',
          erro: 'O texto foi removido depois do agendamento.',
          proximaTentativaEm: null,
        },
      })
      desistidas++
      continue
    }

    const credencial = await resolverCredencial(item.perfilId)
    const texto = compor(item.template.previa, await valoresDe(item))

    const resultado = await smsProvider.enviar(
      credencial.credenciais ?? { chave: '' },
      { para: item.para, texto, referencia: item.id },
    )

    const tentativas = item.tentativas + 1

    if (resultado.ok) {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'ENVIADA',
          idExterno: resultado.idExterno,
          enviadaEm: new Date(),
          tentativas,
          erro: null,
          proximaTentativaEm: null,
          /*
            Grava o provedor que de fato atendeu, e não o configurado: sem
            fornecedor contratado quem atende é o que só registra, e o
            histórico precisa dizer isso. Do contrário, "enviada" mentiria.
            */
          provedor: smsProvider.nome,
        },
      })
      enviadas++
      continue
    }

    const proxima = resultado.retentavel ? proximaTentativaEm(tentativas) : null
    const desistiu = proxima === null

    await prisma.mensagemEnvio.update({
      where: { id: item.id },
      data: {
        status: desistiu ? 'DESISTIU' : 'PENDENTE',
        tentativas,
        erro: resultado.codigo ? `[${resultado.codigo}] ${resultado.mensagem}` : resultado.mensagem,
        proximaTentativaEm: proxima,
        provedor: smsProvider.nome,
      },
    })

    if (desistiu) desistidas++
    else falhas++
  }

  const restantes = await prisma.mensagemEnvio.count({
    where: {
      canal: 'SMS',
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
  })

  return { enviadas, falhas, desistidas, restantes }
}

/**
 * Valores das variáveis, lidos no momento do envio.
 *
 * Não congelados no enfileiramento de propósito: entre a fila e o disparo o
 * envio pode ter ganhado código de rastreio, e mandar o aviso sem o link seria
 * mandar metade da mensagem.
 */
async function valoresDe(item: {
  perfilId: string
  shipmentId: string | null
  perfil: { nome: string; nomeExibicao: string | null }
  pedido: { clienteNome: string; valorCentavos: number; checkoutUrl: string | null } | null
}): Promise<Record<string, string>> {
  const base = process.env.APP_URL ?? 'https://app.martinslog.net'
  /*
    O comprador vê `nomeExibicao`; o nome interno é do painel. Quem não
    configurou nada cai no interno, que é melhor do que uma mensagem sem
    remetente nenhum.
  */
  const valores: Record<string, string> = {
    loja: item.perfil.nomeExibicao?.trim() || item.perfil.nome,
  }

  if (item.pedido) {
    valores.cliente = primeiroNome(item.pedido.clienteNome)
    valores.valor = (item.pedido.valorCentavos / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
    valores.link_checkout = item.pedido.checkoutUrl ?? ''
  }

  if (item.shipmentId) {
    const envio = await prisma.shipment.findUnique({
      where: { id: item.shipmentId },
      select: { codigoRastreio: true, destinatario: true },
    })

    if (envio?.codigoRastreio) {
      valores.codigo_rastreio = envio.codigoRastreio
      valores.link_rastreio = `${base}/r/${envio.codigoRastreio}`
    }

    const destinatario = envio?.destinatario as { nome?: string } | null
    if (!valores.cliente && destinatario?.nome) {
      valores.cliente = primeiroNome(destinatario.nome)
    }
  }

  return valores
}

/**
 * Só o primeiro nome.
 *
 * Cabe no limite de 160 caracteres e soa como gente. "Maria" em vez de
 * "Maria Aparecida da Conceição Santos" pode ser a diferença entre uma
 * mensagem e duas cobradas.
 */
function primeiroNome(completo: string): string {
  return completo.trim().split(/\s+/)[0] ?? completo
}

export { custoDoTexto }

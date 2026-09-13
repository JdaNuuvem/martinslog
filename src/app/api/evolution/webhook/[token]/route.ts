import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { env } from '@/env'
import {
  atualizarStatusMensagem,
  enviarNaConversa,
  registrarMensagem,
  roboPodeResponder,
} from '@/server/conversa-service'
import { responder } from '@/server/robo-atendimento'
import { pediuParaParar, registrarNaoPerturbe } from '@/server/pode-enviar'
import {
  lerMensagem,
  statusDaEvolution,
  telefoneDoJid,
  type RegistroEvolution,
} from '@/domain/whatsapp/mensagem-evolution'
import { dispararSincronizacao } from '@/server/whatsapp/importacao-service'

type Params = { params: Promise<{ token: string }> }

/**
 * Entrada de eventos da Evolution.
 *
 * Pública por necessidade — o webhook chega de fora de qualquer sessão — e por
 * isso o segredo vai no caminho. Sem ele, quem descobrisse a URL escreveria
 * mensagem falsa na caixa de entrada da loja, com o nome e o telefone que
 * quisesse.
 *
 * Responde 200 mesmo para evento que não interessa. Webhook que recebe erro é
 * webhook que a Evolution reentrega em laço, e um evento de tipo desconhecido
 * não melhora na segunda tentativa.
 *
 * Nomes de evento como a Evolution 2.3.7 os manda no corpo: `messages.upsert`,
 * `messages.update`, `connection.update` (`sendDataWebhook` em
 * whatsapp.baileys.service.ts). A forma em maiúsculas com `_` também é aceita,
 * por ser a que se usa para CONFIGURAR o webhook.
 */

const EVENTO_MENSAGEM = 'messages.upsert'
const EVENTO_STATUS = 'messages.update'
const EVENTO_CONEXAO = 'connection.update'

type PayloadEvolution = {
  event?: string
  instance?: string
  data?: unknown
}

/**
 * Compara sem vazar o tamanho da parte que bateu.
 *
 * `===` em segredo permite medir quantos caracteres iniciais estão certos pelo
 * tempo de resposta. Aqui o custo de fazer certo é uma linha.
 */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function ignorado(motivo: string): NextResponse {
  return NextResponse.json({ ok: true, ignorado: motivo })
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const esperado = env.EVOLUTION_WEBHOOK_TOKEN
  if (!esperado) {
    return NextResponse.json({ codigo: 'WEBHOOK_DESLIGADO' }, { status: 404 })
  }

  const { token } = await params
  if (!segredoConfere(token, esperado)) {
    return NextResponse.json({ codigo: 'NAO_AUTORIZADO' }, { status: 401 })
  }

  let corpo: PayloadEvolution
  try {
    corpo = (await request.json()) as PayloadEvolution
  } catch {
    return ignorado('corpo ilegível')
  }

  const evento = corpo.event?.toLowerCase().replace(/_/g, '.')
  if (!corpo.instance) return ignorado('sem instancia')

  const config = await prisma.evolutionConfig.findUnique({
    where: { instancia: corpo.instance },
    select: {
      perfilId: true,
      conectadoEm: true,
      perfil: { select: { nome: true, nomeExibicao: true, whatsappProvedor: true } },
    },
  })
  if (!config) return ignorado('instancia sem loja')

  if (evento === EVENTO_CONEXAO) return tratarConexao(config, corpo.data)
  if (evento === EVENTO_STATUS) return tratarStatus(config.perfilId, corpo.data)
  if (evento === EVENTO_MENSAGEM) return tratarMensagem(config, corpo)
  return ignorado(corpo.event ?? 'sem evento')
}

type ConfigDaInstancia = {
  perfilId: string
  conectadoEm: Date | null
  perfil: { nome: string; nomeExibicao: string | null; whatsappProvedor: 'META' | 'EVOLUTION' }
}

/**
 * Celular pareou (ou voltou): carimba a conexão e importa o histórico.
 *
 * A importação não é esperada — ela leva mais que o timeout do webhook, e a
 * Evolution reentregaria o evento, disparando outra por cima.
 */
async function tratarConexao(config: ConfigDaInstancia, data: unknown): Promise<NextResponse> {
  const dados = (data ?? {}) as { state?: string; wuid?: string }
  if (dados.state !== 'open') return NextResponse.json({ ok: true, conexao: dados.state ?? null })

  const numero = telefoneDoJid(dados.wuid)
  await prisma.evolutionConfig.update({
    where: { perfilId: config.perfilId },
    data: {
      // Só carimba quando abre, e não sobrescreve: a primeira conexão é
      // informação que não se recupera.
      conectadoEm: config.conectadoEm ?? new Date(),
      ultimoErro: null,
      ...(numero ? { numero } : {}),
    },
  })

  dispararSincronizacao(config.perfilId)
  return NextResponse.json({ ok: true, conexao: 'open' })
}

/** Tiques de entregue e lido. Às vezes vêm em lote. */
async function tratarStatus(perfilId: string, data: unknown): Promise<NextResponse> {
  const lista = (Array.isArray(data) ? data : [data]) as Array<{
    keyId?: string
    key?: { id?: string }
    status?: string
  } | null>

  let atualizadas = 0
  for (const item of lista) {
    const idExterno = item?.keyId ?? item?.key?.id
    const status = statusDaEvolution(item?.status)
    if (!idExterno || !status) continue
    atualizadas += await atualizarStatusMensagem(perfilId, idExterno, status)
  }
  return NextResponse.json({ ok: true, atualizadas })
}

async function tratarMensagem(
  config: ConfigDaInstancia,
  corpo: PayloadEvolution,
): Promise<NextResponse> {
  const lida = lerMensagem(corpo.data as RegistroEvolution)
  // Grupo, reação, apagar: não é mensagem da caixa de entrada.
  if (!lida) return ignorado('sem conteudo de conversa')

  const registro = await registrarMensagem({
    perfilId: config.perfilId,
    lida,
    payload: corpo as Prisma.InputJsonValue,
  })

  if (registro.repetida) return NextResponse.json({ ok: true, repetida: true })

  /*
    `fromMe` é a loja respondendo pelo próprio celular. Grava (é parte da
    conversa) e para aqui: o robô respondendo à própria loja seria um laço.
  */
  if (lida.fromMe) return NextResponse.json({ ok: true, autor: 'ATENDENTE' })

  const texto = lida.tipo === 'TEXTO' ? lida.texto : null
  if (!texto) return NextResponse.json({ ok: true, robo: 'sem-texto' })

  /*
    "PARE" antes de qualquer resposta automática.

    Vem primeiro porque é o único pedido que não pode esperar nem ser
    interpretado: quem escreve isso já está incomodado, e responder com robô
    antes de registrar a saída é exatamente o que transforma incômodo em
    denúncia — que, no WhatsApp não oficial, derruba o número.

    A confirmação é enviada mesmo com o bloqueio já gravado, e mesmo em loja
    cujo provedor automático é a Meta: ela é resposta a um pedido dele, não
    mensagem da loja, e sem ela a pessoa não tem como saber se funcionou.
  */
  if (pediuParaParar(texto)) {
    await registrarNaoPerturbe({
      perfilId: config.perfilId,
      // Sem telefone (`@lid`), o jid é o que identifica a pessoa nesta loja.
      contato: registro.telefone ?? lida.jid,
      origem: 'CLIENTE',
      motivo: texto.slice(0, 200),
    })

    await enviarNaConversa({
      perfilId: config.perfilId,
      jid: lida.jid,
      texto:
        'Pronto, não vamos mais te mandar mensagens sobre pedidos. ' +
        'Se mudar de ideia, é só escrever aqui.',
      autor: 'ROBO',
      automatico: false,
    })

    return NextResponse.json({ ok: true, robo: 'nao-perturbe' })
  }

  /*
    O robô é disparo automático, e automático segue o provedor da loja. Uma
    loja marcada META com celular pareado usa a Evolution para ATENDER, não
    para falar sozinha — sem esta trava, cada mensagem recebida gerava uma
    resposta do robô falhada na tela.
  */
  if (config.perfil.whatsappProvedor !== 'EVOLUTION') {
    return NextResponse.json({ ok: true, robo: 'provedor-sem-automacao' })
  }

  /*
    O robô responde depois de gravar, nunca antes.

    Se ele falhar — rede, Evolution fora — a mensagem do comprador já está
    salva e aparece na tela para um humano responder. Na ordem inversa, uma
    falha no robô apagaria o registro de que alguém escreveu.
  */
  if (!(await roboPodeResponder(registro.conversaId))) {
    return NextResponse.json({ ok: true, robo: 'pausado' })
  }

  const nomeLoja = config.perfil.nomeExibicao ?? config.perfil.nome
  const resposta = await responder({
    perfilId: config.perfilId,
    contato: registro.telefone ?? '',
    texto,
    nomeLoja,
  })

  if (resposta.tipo === 'calar') {
    return NextResponse.json({ ok: true, robo: 'calou' })
  }

  await enviarNaConversa({
    perfilId: config.perfilId,
    jid: lida.jid,
    texto: resposta.texto,
    autor: 'ROBO',
  })

  /*
    "Vou chamar alguém" tem que virar conversa esperando humano de verdade.
    Sem pausar o robô aqui, a próxima mensagem do comprador receberia de novo
    a promessa de chamar alguém, em laço.
  */
  if (resposta.tipo === 'chamar-humano') {
    await prisma.conversa.update({
      where: { id: registro.conversaId },
      data: { roboPausadoAte: new Date(Date.now() + 60 * 60 * 1000) },
    })
  }

  return NextResponse.json({ ok: true, robo: resposta.tipo })
}

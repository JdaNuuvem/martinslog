import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { env } from '@/env'
import { enviarNaConversa, registrarEntrada, roboPodeResponder } from '@/server/conversa-service'
import { responder } from '@/server/robo-atendimento'

type Params = { params: Promise<{ token: string }> }

/**
 * Entrada de mensagens da Evolution.
 *
 * Pública por necessidade — o webhook chega de fora de qualquer sessão — e por
 * isso o segredo vai no caminho. Sem ele, quem descobrisse a URL escreveria
 * mensagem falsa na caixa de entrada da loja, com o nome e o telefone que
 * quisesse.
 *
 * Responde 200 mesmo para evento que não interessa. Webhook que recebe erro é
 * webhook que a Evolution reentrega em laço, e um evento de tipo desconhecido
 * não melhora na segunda tentativa.
 */

/** Só o que vira mensagem na caixa de entrada. O resto é ruído de protocolo. */
const EVENTO_MENSAGEM = 'messages.upsert'

type PayloadEvolution = {
  event?: string
  instance?: string
  data?: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean }
    pushName?: string
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
    }
    messageTimestamp?: number | string
  }
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

/** O telefone de quem escreveu, sem o sufixo de rede do WhatsApp. */
function telefoneDe(remoteJid: string | undefined): string | null {
  if (!remoteJid) return null
  const numero = remoteJid.split('@')[0]?.replace(/\D/g, '')
  return numero || null
}

function textoDe(mensagem: PayloadEvolution['data']): string | null {
  return (
    mensagem?.message?.conversation ?? mensagem?.message?.extendedTextMessage?.text ?? null
  )
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
    return NextResponse.json({ ok: true, ignorado: 'corpo ilegível' })
  }

  if (corpo.event?.toLowerCase() !== EVENTO_MENSAGEM) {
    return NextResponse.json({ ok: true, ignorado: corpo.event ?? 'sem evento' })
  }

  /*
    Mensagem que NÓS mandamos volta neste mesmo evento. Gravá-la encheria a
    caixa de entrada com o próprio eco, e a loja veria as próprias mensagens
    como se o cliente as tivesse escrito.
  */
  if (corpo.data?.key?.fromMe) {
    return NextResponse.json({ ok: true, ignorado: 'eco da propria loja' })
  }

  const instancia = corpo.instance
  const idExterno = corpo.data?.key?.id
  const de = telefoneDe(corpo.data?.key?.remoteJid)
  const texto = textoDe(corpo.data)

  if (!instancia || !idExterno || !de || !texto) {
    // Áudio, imagem, figurinha: chegam sem texto. Ignorar é melhor que gravar
    // uma linha vazia que a tela mostraria como mensagem em branco.
    return NextResponse.json({ ok: true, ignorado: 'sem texto ou sem identificacao' })
  }

  const config = await prisma.evolutionConfig.findUnique({
    where: { instancia },
    select: {
      perfilId: true,
      perfil: { select: { nome: true, nomeExibicao: true } },
    },
  })
  if (!config) {
    return NextResponse.json({ ok: true, ignorado: 'instancia sem loja' })
  }

  const carimbo = Number(corpo.data?.messageTimestamp ?? 0)
  const ocorridoEm = carimbo > 0 ? new Date(carimbo * 1000) : new Date()

  const registro = await registrarEntrada({
    perfilId: config.perfilId,
    contato: de,
    nomeContato: corpo.data?.pushName ?? null,
    texto,
    idExterno,
    ocorridoEm,
    payload: corpo as Prisma.InputJsonValue,
  })

  if (!registro || registro.repetida) {
    return NextResponse.json({ ok: true, repetida: true })
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
    contato: de,
    texto,
    nomeLoja,
  })

  if (resposta.tipo === 'calar') {
    return NextResponse.json({ ok: true, robo: 'calou' })
  }

  await enviarNaConversa({
    perfilId: config.perfilId,
    contato: de,
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

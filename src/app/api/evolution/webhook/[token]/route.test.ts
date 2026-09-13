import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { evolutionFalsa, registro } from '@/test/evolution-falsa'

/**
 * O webhook da Evolution, de ponta a ponta, com a Evolution de mentira.
 *
 * O que importa aqui é o que o webhook NÃO faz: responder à própria loja,
 * responder a um áudio, responder por loja que não automatiza pela Evolution.
 */

const TOKEN = vi.hoisted(() => 'token-do-webhook-de-teste-123')

vi.mock('@/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/env')>()
  return { ...original, env: { ...original.env, EVOLUTION_WEBHOOK_TOKEN: TOKEN } }
})

vi.mock('@/infra/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infra/whatsapp')>()),
  credenciaisDoServidor: () => ({ baseUrl: 'http://evolution.teste', apiKey: 'chave-teste' }),
}))

const { POST } = await import('./route')

const usuariosCriados: string[] = []
let falsa = evolutionFalsa()

beforeEach(() => {
  falsa = evolutionFalsa()
  vi.stubGlobal('fetch', falsa.fetch)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function loja(provedor: 'META' | 'EVOLUTION') {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: { userId: user.id, nome: `loja-webhook-${Date.now()}-${Math.random()}`, whatsappProvedor: provedor },
  })
  const instancia = `loja-${perfil.id}`
  await prisma.evolutionConfig.create({
    // Importação "rodando" para o evento de conexão não disparar uma de verdade.
    data: { perfilId: perfil.id, instancia, conectadoEm: new Date(), sincronizandoDesde: new Date() },
  })
  return { perfilId: perfil.id, instancia }
}

function chamar(corpo: unknown, token = TOKEN) {
  return POST(
    new NextRequest(`http://localhost/api/evolution/webhook/${token}`, {
      method: 'POST',
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ token }) },
  )
}

const id = () => `WH-${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('POST /api/evolution/webhook/[token]', () => {
  it('recusa token errado', async () => {
    const resposta = await chamar({ event: 'messages.upsert' }, 'x'.repeat(TOKEN.length))
    expect(resposta.status).toBe(401)
  })

  it('mensagem do cliente no @lid: grava com o jid e o robô responde para o @lid', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const jid = '301234567890123@lid'

    const resposta = await chamar({
      event: 'messages.upsert',
      instance: instancia,
      data: registro({ id: id(), jid, pushName: 'Paula', message: { conversation: 'oi' } }),
    })

    expect(await resposta.json()).toMatchObject({ ok: true, robo: 'responder' })
    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid } },
      include: { mensagens: { orderBy: { criadoEm: 'asc' } } },
    })
    expect(conversa.telefone).toBeNull()
    expect(conversa.mensagens.map((m) => m.autor)).toEqual(['CLIENTE', 'ROBO'])
    expect(falsa.enviadas()[0]?.corpo.number).toBe(jid)
  })

  it('fromMe grava como ATENDENTE e não aciona o robô', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const jid = '5511922223333@s.whatsapp.net'

    const resposta = await chamar({
      event: 'messages.upsert',
      instance: instancia,
      data: registro({ id: id(), jid, fromMe: true, pushName: 'Loja', message: { conversation: 'oi, tudo bem?' } }),
    })

    expect(await resposta.json()).toMatchObject({ ok: true, autor: 'ATENDENTE' })
    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid } },
      include: { mensagens: true },
    })
    expect(conversa.mensagens[0]?.autor).toBe('ATENDENTE')
    expect(conversa.naoLidas).toBe(0)
    expect(conversa.nomeContato).toBeNull()
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('mídia grava tipo e metadados, e o robô não responde áudio', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const jid = '401@lid'

    const resposta = await chamar({
      event: 'MESSAGES_UPSERT',
      instance: instancia,
      data: registro({
        id: id(),
        jid,
        message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 9, fileLength: 3000 } },
      }),
    })

    expect(await resposta.json()).toMatchObject({ robo: 'sem-texto' })
    const mensagem = await prisma.conversaMensagem.findFirstOrThrow({ where: { conversa: { perfilId, jid } } })
    expect(mensagem).toMatchObject({ tipo: 'AUDIO', texto: null, midiaDuracao: 9, midiaTamanho: 3000 })
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('loja META com celular pareado guarda a conversa mas não automatiza', async () => {
    const { instancia } = await loja('META')

    const resposta = await chamar({
      event: 'messages.upsert',
      instance: instancia,
      data: registro({ id: id(), jid: '402@lid', message: { conversation: 'cadê meu pedido?' } }),
    })

    expect(await resposta.json()).toMatchObject({ robo: 'provedor-sem-automacao' })
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('messages.update marca a mensagem como lida', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const idExterno = id()
    await chamar({
      event: 'messages.upsert',
      instance: instancia,
      data: registro({ id: idExterno, jid: '403@lid', fromMe: true, message: { conversation: 'oi' } }),
    })

    await chamar({
      event: 'messages.update',
      instance: instancia,
      data: { keyId: idExterno, remoteJid: '403@lid', fromMe: true, status: 'READ' },
    })

    const mensagem = await prisma.conversaMensagem.findFirstOrThrow({
      where: { idExterno, conversa: { perfilId } },
    })
    expect(mensagem.status).toBe('LIDA')
  })

  it('ignora grupo', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const resposta = await chamar({
      event: 'messages.upsert',
      instance: instancia,
      data: registro({ id: id(), jid: '1203@g.us', message: { conversation: 'oi grupo' } }),
    })
    expect((await resposta.json()).ignorado).toBeDefined()
    expect(await prisma.conversa.count({ where: { perfilId } })).toBe(0)
  })

  it('connection.update aberto carimba o número pareado', async () => {
    const { perfilId, instancia } = await loja('EVOLUTION')
    const resposta = await chamar({
      event: 'connection.update',
      instance: instancia,
      data: { instance: instancia, state: 'open', wuid: '5511900002222@s.whatsapp.net' },
    })
    expect(await resposta.json()).toMatchObject({ conexao: 'open' })
    const config = await prisma.evolutionConfig.findUniqueOrThrow({ where: { perfilId } })
    expect(config.numero).toBe('5511900002222')
  })
})

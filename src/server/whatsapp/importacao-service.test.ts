import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { evolutionFalsa, registro } from '@/test/evolution-falsa'

/**
 * Importação do histórico do celular.
 *
 * O caso que motivou tudo: a Evolution com centenas de conversas e a
 * plataforma mostrando zero. Os registros abaixo reproduzem o que foi medido
 * — quase tudo `@lid`, um grupo no meio, mensagens da própria loja.
 */

vi.mock('@/infra/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infra/whatsapp')>()),
  credenciaisDoServidor: () => ({ baseUrl: 'http://evolution.teste', apiKey: 'chave-teste' }),
}))

vi.mock('@/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/env')>()
  return { ...original, env: { ...original.env, EVOLUTION_WEBHOOK_TOKEN: 'token-de-teste-do-webhook' } }
})

const { sincronizarHistorico, SincronizacaoEmAndamentoError } = await import('./importacao-service')

const usuariosCriados: string[] = []
const s = `${Date.now()}`
const base = Math.floor(Date.now() / 1000) - 3600

async function lojaConectada() {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: { userId: user.id, nome: `loja-importacao-${Date.now()}-${Math.random()}` },
  })
  await prisma.evolutionConfig.create({
    data: { perfilId: perfil.id, instancia: `loja-${perfil.id}`, conectadoEm: new Date() },
  })
  return perfil.id
}

const daLoja = registro({
  id: `${s}-4`,
  jid: '111222333@lid',
  fromMe: true,
  pushName: 'Best Buy Tech',
  message: { conversation: 'respondi pelo celular' },
  segundos: base + 40,
})
const mensagens = [
  daLoja,
  registro({
    id: `${s}-3`,
    jid: '111222333@lid',
    pushName: 'Ana',
    message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto do produto', fileLength: '2048' } },
    segundos: base + 30,
  }),
  registro({
    id: `${s}-2`,
    jid: '5511955556666@s.whatsapp.net',
    pushName: 'Bruno',
    message: { conversation: 'cadê meu pedido?' },
    segundos: base + 20,
  }),
  registro({
    id: `${s}-1`,
    jid: '120363000000@g.us',
    pushName: 'Grupo',
    message: { conversation: 'mensagem de grupo' },
    segundos: base + 10,
  }),
]
const chats = [
  {
    remoteJid: '111222333@lid',
    // O chat traz o nome da loja porque a última mensagem é dela.
    pushName: 'Best Buy Tech',
    unreadCount: 2,
    profilePicUrl: 'https://foto.teste/ana.jpg',
    lastMessage: daLoja,
  },
  { remoteJid: '5511955556666@s.whatsapp.net', pushName: 'Bruno', unreadCount: 0, lastMessage: mensagens[2] },
  { remoteJid: '120363000000@g.us', pushName: 'Grupo', unreadCount: 9, lastMessage: mensagens[3] },
]

let falsa = evolutionFalsa()

beforeEach(() => {
  falsa = evolutionFalsa({ chats, mensagens })
  vi.stubGlobal('fetch', falsa.fetch)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('sincronizarHistorico', () => {
  it('importa conversas e mensagens, e rodar de novo não duplica nada', async () => {
    const perfilId = await lojaConectada()

    // A mensagem da loja já tinha saído pela plataforma, pelo robô.
    const conversaExistente = await prisma.conversa.create({
      data: { perfilId, jid: '111222333@lid' },
    })
    await prisma.conversaMensagem.create({
      data: {
        conversaId: conversaExistente.id,
        autor: 'ROBO',
        texto: 'respondi pelo celular',
        idExterno: `${s}-4`,
        // Mesmo instante do registro na Evolution: é a mesma mensagem.
        ocorridoEm: new Date((base + 40) * 1000),
      },
    })

    const primeira = await sincronizarHistorico(perfilId)
    expect(primeira).toEqual({ conversas: 2, mensagens: 2 })

    const segunda = await sincronizarHistorico(perfilId)
    expect(segunda.mensagens).toBe(0)

    const conversas = await prisma.conversa.findMany({
      where: { perfilId },
      include: { mensagens: { orderBy: { ocorridoEm: 'asc' } } },
      orderBy: { ultimaMensagemEm: 'desc' },
    })
    // O grupo ficou de fora.
    expect(conversas.map((c) => c.jid)).toEqual(['111222333@lid', '5511955556666@s.whatsapp.net'])
    expect(conversas.flatMap((c) => c.mensagens)).toHaveLength(3)

    const [ana, bruno] = conversas
    expect(ana).toMatchObject({
      telefone: null,
      // Nome do cliente, nunca o push name da loja que veio no chat.
      nomeContato: 'Ana',
      naoLidas: 2,
      fotoUrl: 'https://foto.teste/ana.jpg',
      previa: 'respondi pelo celular',
      previaTipo: 'TEXTO',
    })
    expect(ana!.ultimaMensagemEm.getTime()).toBe((base + 40) * 1000)
    expect(ana!.mensagens[0]).toMatchObject({
      autor: 'CLIENTE',
      tipo: 'IMAGEM',
      texto: 'foto do produto',
      midiaMimetype: 'image/jpeg',
      midiaTamanho: 2048,
    })
    // Saiu pela plataforma: o autor gravado antes é preservado.
    expect(ana!.mensagens[1]?.autor).toBe('ROBO')

    expect(bruno).toMatchObject({ telefone: '5511955556666', nomeContato: 'Bruno', naoLidas: 0 })

    const config = await prisma.evolutionConfig.findUniqueOrThrow({ where: { perfilId } })
    expect(config.sincronizadoEm).not.toBeNull()
    expect(config.sincronizandoDesde).toBeNull()
  })

  it('não manda mensagem nenhuma e reconfigura o webhook com MESSAGES_UPDATE', async () => {
    const perfilId = await lojaConectada()
    await sincronizarHistorico(perfilId)

    // Histórico cheio de "cadê meu pedido?" e nenhum envio: o robô não acordou.
    expect(falsa.enviadas()).toHaveLength(0)

    const webhook = falsa.chamadas.find((c) => c.rota === 'set')
    expect(webhook?.instancia).toBe(`loja-${perfilId}`)
    const corpo = webhook?.corpo.webhook as { enabled: boolean; url: string; events: string[] }
    expect(corpo.enabled).toBe(true)
    expect(corpo.url).toContain('/api/evolution/webhook/token-de-teste-do-webhook')
    expect(corpo.events).toEqual(expect.arrayContaining(['MESSAGES_UPSERT', 'MESSAGES_UPDATE']))

    const paginas = falsa.chamadas.filter((c) => c.rota === 'findMessages')
    expect(paginas[0]?.corpo).toMatchObject({ page: 1, offset: 100 })
  })

  it('recusa uma segunda importação enquanto a primeira roda', async () => {
    const perfilId = await lojaConectada()
    await prisma.evolutionConfig.update({
      where: { perfilId },
      data: { sincronizandoDesde: new Date() },
    })

    await expect(sincronizarHistorico(perfilId)).rejects.toBeInstanceOf(SincronizacaoEmAndamentoError)
    expect(falsa.chamadas).toHaveLength(0)
  })
})

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { evolutionFalsa, registro } from '@/test/evolution-falsa'
import { lerMensagem } from '@/domain/whatsapp/mensagem-evolution'

/**
 * Responder numa conversa, com uma Evolution de mentira.
 *
 * O caso real que isto conserta: a loja pareada estava marcada META, e toda
 * resposta do atendente falhava com "não está pareado pela Evolution" — com
 * o celular pareado e aberto.
 */

vi.mock('@/infra/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infra/whatsapp')>()),
  credenciaisDoServidor: () => ({ baseUrl: 'http://evolution.teste', apiKey: 'chave-teste' }),
}))

const { enviarConteudo, ArquivoGrandeDemaisError, LIMITE_ARQUIVO_BYTES } = await import('./envio-service')
const { enviarNaConversa, registrarMensagem } = await import('@/server/conversa-service')

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

async function conversaDeLoja(opcoes: { provedor: 'META' | 'EVOLUTION'; conectada: boolean }) {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: {
      userId: user.id,
      nome: `loja-envio-${Date.now()}-${Math.random()}`,
      whatsappProvedor: opcoes.provedor,
    },
  })
  await prisma.evolutionConfig.create({
    data: {
      perfilId: perfil.id,
      instancia: `loja-${perfil.id}`,
      conectadoEm: opcoes.conectada ? new Date() : null,
    },
  })
  return prisma.conversa.create({ data: { perfilId: perfil.id, jid: '201234567890123@lid' } })
}

describe('enviarConteudo', () => {
  it('responde para o @lid numa loja META com a Evolution conectada', async () => {
    const conversa = await conversaDeLoja({ provedor: 'META', conectada: true })

    const resultado = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'texto', texto: 'Olá! Já verifico seu pedido.' },
      exigirProvedorEvolution: false,
    })

    expect(resultado.ok).toBe(true)
    const [envio] = falsa.enviadas()
    expect(envio?.rota).toBe('sendText')
    expect(envio?.instancia).toBe(`loja-${conversa.perfilId}`)
    expect(envio?.corpo).toMatchObject({ number: '201234567890123@lid', text: 'Olá! Já verifico seu pedido.' })

    const mensagem = await prisma.conversaMensagem.findFirstOrThrow({ where: { conversaId: conversa.id } })
    expect(mensagem.status).toBe('ENVIADA')
    expect(mensagem.idExterno).toMatch(/^SAIDA-/)

    const depois = await prisma.conversa.findUniqueOrThrow({ where: { id: conversa.id } })
    expect(depois.previa).toBe('Olá! Já verifico seu pedido.')
    expect(depois.roboPausadoAte!.getTime()).toBeGreaterThan(Date.now())
  })

  it('disparo automático continua exigindo provedor EVOLUTION', async () => {
    const conversa = await conversaDeLoja({ provedor: 'META', conectada: true })

    const resultado = await enviarNaConversa({
      perfilId: conversa.perfilId,
      jid: conversa.jid,
      texto: 'mensagem do robô',
      autor: 'ROBO',
    })

    expect(resultado.ok).toBe(false)
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('sem celular pareado grava a tentativa com ERRO', async () => {
    const conversa = await conversaDeLoja({ provedor: 'EVOLUTION', conectada: false })

    const resultado = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'texto', texto: 'oi' },
      exigirProvedorEvolution: false,
    })

    expect(resultado).toMatchObject({ ok: false, motivo: 'sem-conexao' })
    expect(resultado.mensagem.status).toBe('ERRO')
    expect(resultado.mensagem.texto).toBe('oi')
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('recusa arquivo acima de 16 MB antes de gravar ou enviar', async () => {
    const conversa = await conversaDeLoja({ provedor: 'EVOLUTION', conectada: true })

    await expect(
      enviarConteudo({
        conversa,
        autor: 'ATENDENTE',
        conteudo: {
          tipo: 'arquivo',
          dados: Buffer.alloc(LIMITE_ARQUIVO_BYTES + 1),
          mimetype: 'application/pdf',
          nome: 'grande.pdf',
        },
        exigirProvedorEvolution: false,
      }),
    ).rejects.toBeInstanceOf(ArquivoGrandeDemaisError)

    expect(await prisma.conversaMensagem.count({ where: { conversaId: conversa.id } })).toBe(0)
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('imagem vai por sendMedia em base64 puro, áudio por sendWhatsAppAudio', async () => {
    const conversa = await conversaDeLoja({ provedor: 'EVOLUTION', conectada: true })
    const imagem = Buffer.from('imagem-falsa')
    const audio = Buffer.from('audio-falso')

    const foto = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'arquivo', dados: imagem, mimetype: 'image/jpeg', nome: 'foto.jpg', legenda: 'olha' },
      exigirProvedorEvolution: false,
    })
    const voz = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'audio', dados: audio, mimetype: 'audio/webm;codecs=opus', duracao: 4 },
      exigirProvedorEvolution: false,
    })

    const [envioFoto, envioVoz] = falsa.enviadas()
    expect(envioFoto?.rota).toBe('sendMedia')
    expect(envioFoto?.corpo).toMatchObject({
      number: conversa.jid,
      mediatype: 'image',
      mimetype: 'image/jpeg',
      media: imagem.toString('base64'),
      fileName: 'foto.jpg',
      caption: 'olha',
    })
    expect(envioVoz?.rota).toBe('sendWhatsAppAudio')
    expect(envioVoz?.corpo).toEqual({ number: conversa.jid, audio: audio.toString('base64') })

    expect(foto.mensagem).toMatchObject({ tipo: 'IMAGEM', texto: 'olha', midiaTamanho: imagem.length })
    expect(voz.mensagem).toMatchObject({ tipo: 'AUDIO', status: 'ENVIADA', midiaDuracao: 4 })
  })

  it('Evolution recusando grava ERRO com o motivo dela', async () => {
    const conversa = await conversaDeLoja({ provedor: 'EVOLUTION', conectada: true })
    falsa = evolutionFalsa({ recusarEnvioCom: 400 })
    vi.stubGlobal('fetch', falsa.fetch)

    const resultado = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'texto', texto: 'oi' },
      exigirProvedorEvolution: false,
    })

    expect(resultado).toMatchObject({ ok: false, motivo: 'recusado', erro: 'número não existe' })
    expect(resultado.mensagem.status).toBe('ERRO')
  })

  /**
   * O WhatsApp devolve a nossa mensagem pelo webhook, às vezes antes da
   * resposta HTTP do envio. Sem tratar, o atendente veria a própria resposta
   * duas vezes.
   */
  it('o eco do webhook que chega antes da resposta não duplica a mensagem', async () => {
    const conversa = await conversaDeLoja({ provedor: 'EVOLUTION', conectada: true })
    const idEco = `ECO-${Date.now()}`

    vi.stubGlobal('fetch', async () => {
      await registrarMensagem({
        perfilId: conversa.perfilId,
        lida: lerMensagem(
          registro({ id: idEco, jid: conversa.jid, fromMe: true, message: { conversation: 'resposta' } }),
        )!,
      })
      return new Response(JSON.stringify({ key: { id: idEco } }), { status: 200 })
    })

    const resultado = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo: { tipo: 'texto', texto: 'resposta' },
      exigirProvedorEvolution: false,
    })

    expect(resultado.ok).toBe(true)
    const todas = await prisma.conversaMensagem.findMany({ where: { conversaId: conversa.id } })
    expect(todas).toHaveLength(1)
    expect(todas[0]).toMatchObject({ id: resultado.mensagem.id, idExterno: idEco, status: 'ENVIADA' })
  })
})

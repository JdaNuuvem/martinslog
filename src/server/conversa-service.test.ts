import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { lerMensagem } from '@/domain/whatsapp/mensagem-evolution'
import { registro } from '@/test/evolution-falsa'
import { atualizarStatusMensagem, registrarMensagem, roboPodeResponder } from './conversa-service'

/**
 * A caixa de entrada da conversa.
 *
 * O envio não entra aqui (tem arquivo próprio, com Evolution falsa). O que se
 * testa é o que acontece do nosso lado — o que é gravado, o que é contado e
 * quando o robô cala a boca.
 */

const usuariosCriados: string[] = []
const sufixo = `${Date.now()}`

async function loja() {
  const user = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: { userId: user.id, nome: `loja-conversa-${Date.now()}-${Math.random()}` },
  })
  return perfil.id
}

function lida(dados: Parameters<typeof registro>[0]) {
  const resultado = lerMensagem(registro(dados))
  if (!resultado) throw new Error('registro de teste não virou mensagem')
  return resultado
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  await prisma.conversa.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.lead.deleteMany({ where: { origens: { some: { perfilId: { in: perfilIds } } } } }).catch(() => null)
  await prisma.perfil.deleteMany({ where: { id: { in: perfilIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('mensagem recebida', () => {
  it('cria a conversa pelo @lid, sem inventar telefone, e conta como não lida', async () => {
    const perfilId = await loja()

    const resultado = await registrarMensagem({
      perfilId,
      lida: lida({
        id: `lid-${sufixo}`,
        jid: '201234567890123@lid',
        pushName: 'Maria',
        message: { conversation: 'oi, chegou meu pedido?' },
      }),
    })

    expect(resultado.repetida).toBe(false)
    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid: '201234567890123@lid' } },
      include: { mensagens: true },
    })
    expect(conversa.telefone).toBeNull()
    expect(conversa.nomeContato).toBe('Maria')
    expect(conversa.naoLidas).toBe(1)
    expect(conversa.previa).toBe('oi, chegou meu pedido?')
    expect(conversa.mensagens[0]?.autor).toBe('CLIENTE')
  })

  /**
   * O webhook reentrega quando não recebe 200 a tempo. Sem esta trava, a mesma
   * mensagem apareceria duas vezes na tela e o contador de não lidas mentiria.
   */
  it('não grava duas vezes o mesmo evento reentregue', async () => {
    const perfilId = await loja()
    const entrada = lida({
      id: `repetida-${sufixo}`,
      jid: '5511911112222@s.whatsapp.net',
      message: { conversation: 'mensagem única' },
    })

    const primeira = await registrarMensagem({ perfilId, lida: entrada })
    const segunda = await registrarMensagem({ perfilId, lida: entrada })

    expect(primeira.repetida).toBe(false)
    expect(segunda.repetida).toBe(true)
    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid: '5511911112222@s.whatsapp.net' } },
      include: { mensagens: true },
    })
    expect(conversa.mensagens).toHaveLength(1)
    expect(conversa.naoLidas).toBe(1)
    expect(conversa.telefone).toBe('5511911112222')
  })

  it('fromMe entra como ATENDENTE, sem contar não lida e sem virar nome da conversa', async () => {
    const perfilId = await loja()
    const jid = '5511933334444@s.whatsapp.net'

    await registrarMensagem({
      perfilId,
      lida: lida({ id: `cli-${sufixo}`, jid, pushName: 'João', message: { conversation: 'oi' } }),
    })
    await registrarMensagem({
      perfilId,
      lida: lida({
        id: `loja-${sufixo}`,
        jid,
        fromMe: true,
        pushName: 'Best Buy Tech',
        message: { conversation: 'olá, João!' },
      }),
    })

    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid } },
      include: { mensagens: { orderBy: { criadoEm: 'asc' } } },
    })
    expect(conversa.nomeContato).toBe('João')
    expect(conversa.naoLidas).toBe(1)
    expect(conversa.mensagens.map((m) => m.autor)).toEqual(['CLIENTE', 'ATENDENTE'])
  })

  it('grava mídia com tipo e metadados, e a prévia diz o que é', async () => {
    const perfilId = await loja()
    const jid = '77@lid'

    await registrarMensagem({
      perfilId,
      lida: lida({
        id: `audio-${sufixo}`,
        jid,
        message: {
          audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: '4096', seconds: 12, ptt: true },
        },
      }),
    })

    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid } },
      include: { mensagens: true },
    })
    expect(conversa.previaTipo).toBe('AUDIO')
    expect(conversa.previa).toBe('Áudio')
    expect(conversa.mensagens[0]).toMatchObject({
      tipo: 'AUDIO',
      texto: null,
      midiaMimetype: 'audio/ogg; codecs=opus',
      midiaTamanho: 4096,
      midiaDuracao: 12,
    })
  })
})

describe('status da mensagem', () => {
  it('avança para lida e não volta para entregue', async () => {
    const perfilId = await loja()
    const idExterno = `status-${sufixo}`
    const { conversaId } = await registrarMensagem({
      perfilId,
      lida: lida({ id: idExterno, jid: '88@lid', fromMe: true, message: { conversation: 'oi' } }),
    })

    expect(await atualizarStatusMensagem(perfilId, idExterno, 'LIDA')).toBe(1)
    expect(await atualizarStatusMensagem(perfilId, idExterno, 'ENTREGUE')).toBe(0)

    const mensagem = await prisma.conversaMensagem.findFirstOrThrow({ where: { conversaId } })
    expect(mensagem.status).toBe('LIDA')
  })

  it('evento de outra loja não mexe na mensagem', async () => {
    const perfilId = await loja()
    const outra = await loja()
    const idExterno = `status-outra-${sufixo}`
    await registrarMensagem({
      perfilId,
      lida: lida({ id: idExterno, jid: '89@lid', fromMe: true, message: { conversation: 'oi' } }),
    })

    expect(await atualizarStatusMensagem(outra, idExterno, 'LIDA')).toBe(0)
  })
})

describe('silêncio do robô', () => {
  async function conversaNova() {
    const perfilId = await loja()
    return registrarMensagem({
      perfilId,
      lida: lida({ id: `robo-${Date.now()}-${Math.random()}`, jid: '90@lid', message: { conversation: 'oi' } }),
    })
  }

  it('deixa o robô responder numa conversa que ninguém assumiu', async () => {
    const registroConversa = await conversaNova()
    expect(await roboPodeResponder(registroConversa.conversaId)).toBe(true)
  })

  it('cala o robô enquanto um humano está com a conversa', async () => {
    const registroConversa = await conversaNova()
    await prisma.conversa.update({
      where: { id: registroConversa.conversaId },
      data: { roboPausadoAte: new Date(Date.now() + 10 * 60 * 1000) },
    })
    expect(await roboPodeResponder(registroConversa.conversaId)).toBe(false)
  })

  /**
   * A pausa precisa expirar sozinha: ninguém lembra de devolver a conversa ao
   * robô, e sem isso toda conversa atendida uma vez ficaria manual para sempre.
   */
  it('devolve a conversa ao robô quando a pausa vence', async () => {
    const registroConversa = await conversaNova()
    await prisma.conversa.update({
      where: { id: registroConversa.conversaId },
      data: { roboPausadoAte: new Date(Date.now() - 60 * 1000) },
    })
    expect(await roboPodeResponder(registroConversa.conversaId)).toBe(true)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { registrarEntrada, roboPodeResponder } from './conversa-service'

/**
 * A caixa de entrada da conversa.
 *
 * O envio não entra aqui: ele fala com a Evolution, e a suíte não manda
 * mensagem de verdade. O que se testa é o que acontece do nosso lado — o que
 * é gravado, o que é contado e quando o robô cala a boca.
 */

const usuariosCriados: string[] = []

async function loja() {
  const user = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: { userId: user.id, nome: `loja-conversa-${Date.now()}-${Math.random()}` },
  })
  return perfil.id
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  const conversas = await prisma.conversa.findMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.conversaMensagem.deleteMany({
    where: { conversaId: { in: conversas.map((c) => c.id) } },
  })
  await prisma.conversa.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfilIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('entrada de mensagem na conversa', () => {
  it('cria a conversa e conta a mensagem como não lida', async () => {
    const perfilId = await loja()

    const resultado = await registrarEntrada({
      perfilId,
      contato: '5511911110000',
      nomeContato: 'Maria',
      texto: 'oi, chegou meu pedido?',
      idExterno: `msg-${Date.now()}-a`,
      ocorridoEm: new Date(),
      payload: { origem: 'teste' },
    })

    expect(resultado?.repetida).toBe(false)

    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_contato: { perfilId, contato: '5511911110000' } },
      include: { mensagens: true },
    })

    expect(conversa.naoLidas).toBe(1)
    expect(conversa.nomeContato).toBe('Maria')
    expect(conversa.mensagens).toHaveLength(1)
    expect(conversa.mensagens[0]?.autor).toBe('CLIENTE')
  })

  /**
   * O webhook reentrega quando não recebe 200 a tempo. Sem esta trava, a mesma
   * mensagem apareceria duas vezes na tela e o contador de não lidas mentiria.
   */
  it('não grava duas vezes o mesmo evento reentregue', async () => {
    const perfilId = await loja()
    const idExterno = `msg-${Date.now()}-repetida`

    const entrada = {
      perfilId,
      contato: '5511911112222',
      texto: 'mensagem única',
      idExterno,
      ocorridoEm: new Date(),
      payload: {},
    }

    const primeira = await registrarEntrada(entrada)
    const segunda = await registrarEntrada(entrada)

    expect(primeira?.repetida).toBe(false)
    expect(segunda?.repetida).toBe(true)

    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_contato: { perfilId, contato: '5511911112222' } },
      include: { mensagens: true },
    })

    expect(conversa.mensagens).toHaveLength(1)
    expect(conversa.naoLidas).toBe(1)
  })

  it('acumula não lidas quando o comprador escreve várias vezes', async () => {
    const perfilId = await loja()
    const base = Date.now()

    for (let i = 0; i < 3; i++) {
      await registrarEntrada({
        perfilId,
        contato: '5511911113333',
        texto: `mensagem ${i}`,
        idExterno: `msg-${base}-${i}`,
        ocorridoEm: new Date(),
        payload: {},
      })
    }

    const conversa = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_contato: { perfilId, contato: '5511911113333' } },
    })
    expect(conversa.naoLidas).toBe(3)
  })
})

describe('silêncio do robô', () => {
  it('deixa o robô responder numa conversa que ninguém assumiu', async () => {
    const perfilId = await loja()
    const registro = await registrarEntrada({
      perfilId,
      contato: '5511911114444',
      texto: 'oi',
      idExterno: `msg-${Date.now()}-livre`,
      ocorridoEm: new Date(),
      payload: {},
    })

    expect(await roboPodeResponder(registro!.conversaId)).toBe(true)
  })

  it('cala o robô enquanto um humano está com a conversa', async () => {
    const perfilId = await loja()
    const registro = await registrarEntrada({
      perfilId,
      contato: '5511911115555',
      texto: 'oi',
      idExterno: `msg-${Date.now()}-assumida`,
      ocorridoEm: new Date(),
      payload: {},
    })

    await prisma.conversa.update({
      where: { id: registro!.conversaId },
      data: { roboPausadoAte: new Date(Date.now() + 10 * 60 * 1000) },
    })

    expect(await roboPodeResponder(registro!.conversaId)).toBe(false)
  })

  /**
   * A pausa precisa expirar sozinha: ninguém lembra de devolver a conversa ao
   * robô, e sem isso toda conversa atendida uma vez ficaria manual para sempre.
   */
  it('devolve a conversa ao robô quando a pausa vence', async () => {
    const perfilId = await loja()
    const registro = await registrarEntrada({
      perfilId,
      contato: '5511911116666',
      texto: 'oi',
      idExterno: `msg-${Date.now()}-vencida`,
      ocorridoEm: new Date(),
      payload: {},
    })

    await prisma.conversa.update({
      where: { id: registro!.conversaId },
      data: { roboPausadoAte: new Date(Date.now() - 60 * 1000) },
    })

    expect(await roboPodeResponder(registro!.conversaId)).toBe(true)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { podeEnviar, registrarNaoPerturbe } from './pode-enviar'

/**
 * A decisão de mandar ou não, contra o banco.
 *
 * A janela em si é testada em `domain/mensagem/silencio`. Aqui o que importa
 * é o que a fila faz com a resposta: quem pediu para parar nunca mais recebe,
 * e quem caiu na madrugada volta depois.
 */

const usuariosCriados: string[] = []

async function loja(silencio?: { ativo: boolean; inicio?: number; fim?: number }) {
  const user = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: {
      userId: user.id,
      nome: `loja-pode-${Date.now()}-${Math.random()}`,
      silencioAtivo: silencio?.ativo ?? false,
      ...(silencio?.inicio !== undefined ? { silencioInicioHora: silencio.inicio } : {}),
      ...(silencio?.fim !== undefined ? { silencioFimHora: silencio.fim } : {}),
    },
  })
  return perfil.id
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  await prisma.naoPerturbe.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfilIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('não perturbe', () => {
  it('deixa passar quem nunca pediu nada', async () => {
    const perfilId = await loja()
    const decisao = await podeEnviar(perfilId, '5511900002000')
    expect(decisao.pode).toBe(true)
  })

  it('barra quem pediu para parar', async () => {
    const perfilId = await loja()
    await registrarNaoPerturbe({ perfilId, contato: '5511900002001' })

    const decisao = await podeEnviar(perfilId, '5511900002001')
    expect(decisao.pode).toBe(false)
    if (decisao.pode) throw new Error('deveria ter barrado')
    expect(decisao.motivo).toBe('nao-perturbe')
  })

  /**
   * O bloqueio é por LOJA. Quem não quer saber da Loja A pode continuar
   * querendo saber da Loja B — decidir por ele seria decidir o que é dele.
   */
  it('o bloqueio numa loja não vale para outra', async () => {
    const lojaA = await loja()
    const lojaB = await loja()
    await registrarNaoPerturbe({ perfilId: lojaA, contato: '5511900002002' })

    expect((await podeEnviar(lojaA, '5511900002002')).pode).toBe(false)
    expect((await podeEnviar(lojaB, '5511900002002')).pode).toBe(true)
  })

  it('pedir duas vezes não dá erro', async () => {
    const perfilId = await loja()
    await registrarNaoPerturbe({ perfilId, contato: '5511900002003' })
    await expect(
      registrarNaoPerturbe({ perfilId, contato: '5511900002003' }),
    ).resolves.not.toThrow()
  })
})

describe('janela de silêncio na fila', () => {
  it('não segura nada quando o silêncio está desligado', async () => {
    const perfilId = await loja({ ativo: false })
    // Três da manhã, horário de Brasília.
    const madrugada = new Date('2026-09-11T06:00:00.000Z')

    const decisao = await podeEnviar(perfilId, '5511900002004', madrugada)
    expect(decisao.pode).toBe(true)
  })

  /**
   * Adiar, e não desistir: desistir faria o comprador nunca saber que o
   * pedido foi postado só porque a postagem caiu de madrugada.
   */
  it('segura a mensagem da madrugada e devolve quando tentar de novo', async () => {
    const perfilId = await loja({ ativo: true, inicio: 22, fim: 8 })
    const madrugada = new Date('2026-09-11T06:00:00.000Z')

    const decisao = await podeEnviar(perfilId, '5511900002005', madrugada)
    expect(decisao.pode).toBe(false)
    if (decisao.pode) throw new Error('deveria ter segurado')
    expect(decisao.motivo).toBe('silencio')
    expect(decisao.tentarEm.getTime()).toBeGreaterThan(madrugada.getTime())
  })

  it('deixa passar no meio da tarde', async () => {
    const perfilId = await loja({ ativo: true, inicio: 22, fim: 8 })
    // Quinze horas, horário de Brasília.
    const tarde = new Date('2026-09-11T18:00:00.000Z')

    expect((await podeEnviar(perfilId, '5511900002006', tarde)).pode).toBe(true)
  })

  /** O bloqueio vence o horário: não adianta esperar, ele nunca vai querer. */
  it('quem pediu para parar é barrado mesmo fora do silêncio', async () => {
    const perfilId = await loja({ ativo: true, inicio: 22, fim: 8 })
    await registrarNaoPerturbe({ perfilId, contato: '5511900002007' })
    const tarde = new Date('2026-09-11T18:00:00.000Z')

    const decisao = await podeEnviar(perfilId, '5511900002007', tarde)
    expect(decisao.pode).toBe(false)
    if (decisao.pode) throw new Error('deveria ter barrado')
    expect(decisao.motivo).toBe('nao-perturbe')
  })
})

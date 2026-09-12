import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import {
  IDADE_MAXIMA_HORAS,
  cancelarCobrancasDePedidoResolvido,
  dispararRecuperacoes,
} from './recuperacao-service'

/**
 * A régua de recuperação, com foco nos dois jeitos de ela dar errado com o
 * comprador do outro lado: cobrar quem já pagou, e cobrar todo mundo de uma vez
 * no dia em que a régua é ligada.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.regraRecuperacao.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.pedido.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function lojaComRegua(nome: string, atrasos: number[]) {
  const usuario = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(usuario.id)
  const perfil = await prisma.perfil.create({ data: { userId: usuario.id, nome } })
  const template = await prisma.mensagemTemplate.create({
    data: {
      perfilId: perfil.id,
      canal: 'WHATSAPP',
      evento: 'PEDIDO_PENDENTE',
      nome: 'pedido_pendente',
      previa: 'Oi {{1}}, finalize sua compra.',
      variaveis: ['cliente'],
    },
  })
  for (const atrasoMinutos of atrasos) {
    await prisma.regraRecuperacao.create({
      data: { perfilId: perfil.id, templateId: template.id, atrasoMinutos },
    })
  }
  return { perfil, template }
}

/**
 * Quantas mensagens ESTE perfil tem na fila.
 *
 * `dispararRecuperacoes` devolve um contador global, porque é um cron que varre
 * a base inteira — e a base de teste é compartilhada entre arquivos. Assertar
 * no global fazia o teste depender do que outro teste deixou para trás.
 */
async function naFilaDe(perfilId: string): Promise<number> {
  return prisma.mensagemEnvio.count({ where: { perfilId } })
}

function horasAtras(horas: number): Date {
  return new Date(Date.now() - horas * 60 * 60 * 1000)
}

async function pedidoPendente(perfilId: string, criadoEm: Date, externalId: string) {
  return prisma.pedido.create({
    data: {
      perfilId,
      externalId,
      status: 'PENDENTE',
      clienteNome: 'Maria',
      clienteFone: '5511988887777',
      valorCentavos: 9790,
      criadoEm,
    },
  })
}

describe('régua de recuperação', () => {
  it('cobra quando o atraso vence, e não antes', async () => {
    const { perfil } = await lojaComRegua('Regua Prazo', [120])

    await pedidoPendente(perfil.id, horasAtras(3), 'vencido')
    await pedidoPendente(perfil.id, horasAtras(1), 'novo-demais')

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(1)

    const fila = await prisma.mensagemEnvio.findMany({
      where: { perfilId: perfil.id },
      include: { pedido: true },
    })
    expect(fila).toHaveLength(1)
    expect(fila[0]!.pedido!.externalId).toBe('vencido')
  })

  it('cada regra da régua cobra uma vez, e a rodada seguinte não repete', async () => {
    const { perfil } = await lojaComRegua('Regua Tres Toques', [15, 120, 1440])

    // Pedido de dois dias: os três atrasos já venceram.
    await pedidoPendente(perfil.id, horasAtras(48), 'antigo')

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(3)

    /*
      A segunda rodada é o teste de verdade. Sem `regraId` na chave única, as
      três viriam como repetição uma da outra; sem a chave endurecida, a
      segunda rodada mandaria tudo de novo.
    */
    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(3)
  })

  it('não alcança o histórico antigo quando a régua é ligada hoje', async () => {
    const { perfil } = await lojaComRegua('Regua Historico', [60])

    /*
      O acidente que este limite existe para impedir: ligar a régua e, na
      primeira rodada, cobrar meses de pedidos abandonados. Para a Meta isso é
      disparo em massa não solicitado, e quem paga é o número da loja.
    */
    await pedidoPendente(perfil.id, horasAtras(IDADE_MAXIMA_HORAS + 24), 'do-mes-passado')
    await pedidoPendente(perfil.id, horasAtras(2), 'de-hoje')

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(1)

    const fila = await prisma.mensagemEnvio.findFirstOrThrow({
      where: { perfilId: perfil.id },
      include: { pedido: true },
    })
    expect(fila.pedido!.externalId).toBe('de-hoje')
  })

  it('não cobra pedido que já foi pago', async () => {
    const { perfil } = await lojaComRegua('Regua Pago', [60])

    const pago = await pedidoPendente(perfil.id, horasAtras(3), 'pago-depois')
    await prisma.pedido.update({
      where: { id: pago.id },
      data: { status: 'PAGO', pagoEm: new Date() },
    })

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(0)
  })

  it('cancela a cobrança que ficou na fila quando o pagamento entra depois', async () => {
    const { perfil } = await lojaComRegua('Regua Pago Na Fila', [60])
    const pedido = await pedidoPendente(perfil.id, horasAtras(3), 'pagou-na-fila')

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(1)

    // O pagamento entra DEPOIS de a cobrança já estar na fila.
    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { status: 'PAGO', pagoEm: new Date() },
    })

    /*
      Sem este passo, o comprador que acabou de pagar recebe "conclua sua
      compra" — e ou paga de novo, ou abre reclamação. Ler os valores frescos
      na hora do envio não resolvia: lia o pedido pago e mandava mesmo assim.
    */
    expect(await cancelarCobrancasDePedidoResolvido()).toBe(1)

    const mensagem = await prisma.mensagemEnvio.findFirstOrThrow({
      where: { perfilId: perfil.id },
    })
    expect(mensagem.status).toBe('DESISTIU')
    expect(mensagem.proximaTentativaEm).toBeNull()
  })

  it('regra desligada não cobra', async () => {
    const { perfil } = await lojaComRegua('Regua Desligada', [60])
    await prisma.regraRecuperacao.updateMany({
      where: { perfilId: perfil.id },
      data: { ativo: false },
    })
    await pedidoPendente(perfil.id, horasAtras(3), 'nao-deve-sair')

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(0)
  })

  it('pedido sem telefone não entra na fila', async () => {
    const { perfil } = await lojaComRegua('Regua Sem Fone', [60])
    await prisma.pedido.create({
      data: {
        perfilId: perfil.id,
        externalId: 'sem-fone',
        status: 'PENDENTE',
        clienteNome: 'Maria',
        clienteFone: '',
        valorCentavos: 9790,
        criadoEm: horasAtras(3),
      },
    })

    await dispararRecuperacoes()
    expect(await naFilaDe(perfil.id)).toBe(0)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { reaplicarTemplateNosEnvios } from './reaplicar-template-service'
import { alternarTemplate, salvarTemplate } from './template-rastreio-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: envios.map((e) => e.id) } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.rastreioTemplate.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

const remetente: EnderecoEnvio = {
  nome: 'Remetente Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Maria Aparecida da Silva',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Rua das Flores',
  numero: '123',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

const PASSOS_TEMPLATE = [
  { id: 'p1', codigo: 'POSTADO', titulo: 'Postado', descricao: 'Saiu da loja', diasAposEmissao: 0 },
  { id: 'p2', codigo: 'TRANSFERENCIA', titulo: 'A caminho', descricao: 'Rodando', diasAposEmissao: 1 },
  { id: 'p3', codigo: 'ENTREGUE', titulo: 'Chegou', descricao: 'Entregue', diasAposEmissao: 2 },
]

/** Usuário com um envio já emitido — timeline gravada pelo roteiro automático. */
async function criarUsuarioComEnvioEmitido(): Promise<{ userId: string; shipmentId: string }> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id, { cepDestino: destinatario.cep })

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })
  await emitirEtiqueta(envio.id)

  return { userId: user.id, shipmentId: envio.id }
}

describe('reaplicarTemplateNosEnvios', () => {
  it('reescreve a timeline dos envios já emitidos com os passos do template', async () => {
    const { userId, shipmentId } = await criarUsuarioComEnvioEmitido()

    const antes = await prisma.trackingEvent.findMany({ where: { shipmentId } })
    expect(antes.length).toBeGreaterThan(0)

    await salvarTemplate(userId, PASSOS_TEMPLATE)
    const reescritos = await reaplicarTemplateNosEnvios(userId)

    expect(reescritos).toBe(1)

    const depois = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
    })
    expect(depois.map((e) => e.codigo)).toEqual(['POSTADO', 'TRANSFERENCIA', 'ENTREGUE'])
    expect(depois.map((e) => e.titulo)).toEqual(['Postado', 'A caminho', 'Chegou'])
  })

  it('mantém a origem do relógio da simulação — não joga o envio para o futuro', async () => {
    const { userId, shipmentId } = await criarUsuarioComEnvioEmitido()
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })

    await salvarTemplate(userId, PASSOS_TEMPLATE)
    await reaplicarTemplateNosEnvios(userId)

    const primeiro = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
    })

    expect(primeiro.ocorridoEm.getTime()).toBe(envio.simulacaoIniciadaEm!.getTime())
  })

  it('recusa quando a conta não tem template ativo', async () => {
    const { userId } = await criarUsuarioComEnvioEmitido()
    await salvarTemplate(userId, PASSOS_TEMPLATE)
    await alternarTemplate(userId, false)

    await expect(reaplicarTemplateNosEnvios(userId)).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('não toca em envio cancelado', async () => {
    const { userId, shipmentId } = await criarUsuarioComEnvioEmitido()
    await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'CANCELLED' } })
    const antes = await prisma.trackingEvent.findMany({ where: { shipmentId } })

    await salvarTemplate(userId, PASSOS_TEMPLATE)
    const reescritos = await reaplicarTemplateNosEnvios(userId)

    expect(reescritos).toBe(0)
    const depois = await prisma.trackingEvent.findMany({ where: { shipmentId } })
    expect(depois.map((e) => e.codigo)).toEqual(antes.map((e) => e.codigo))
  })
})

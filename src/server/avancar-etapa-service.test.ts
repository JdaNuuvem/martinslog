import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { avancarEtapa } from './avancar-etapa-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: envios.map((e) => e.id) } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
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

async function criarEnvioEmitido(): Promise<{ userId: string; shipmentId: string }> {
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

async function eventosVisiveis(shipmentId: string): Promise<number> {
  return prisma.trackingEvent.count({
    where: { shipmentId, ocorridoEm: { lte: new Date() } },
  })
}

describe('avancarEtapa', () => {
  it('traz o próximo evento para agora, revelando mais uma etapa ao cliente', async () => {
    const { userId, shipmentId } = await criarEnvioEmitido()
    const antes = await eventosVisiveis(shipmentId)

    const etapa = await avancarEtapa(userId, shipmentId)

    expect(await eventosVisiveis(shipmentId)).toBe(antes + 1)
    expect(etapa.titulo).toBeTruthy()
  })

  it('desloca os eventos seguintes junto, preservando o intervalo entre etapas', async () => {
    const { userId, shipmentId } = await criarEnvioEmitido()

    const futurosAntes = await prisma.trackingEvent.findMany({
      where: { shipmentId, ocorridoEm: { gt: new Date() } },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true, ocorridoEm: true },
    })

    await avancarEtapa(userId, shipmentId)

    const futurosDepois = await prisma.trackingEvent.findMany({
      where: { shipmentId, sequencia: { in: futurosAntes.map((e) => e.sequencia) } },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true, ocorridoEm: true },
    })

    // Todos andaram para trás pelo mesmo tanto: as distâncias entre eventos
    // consecutivos continuam iguais.
    const distancias = (lista: { ocorridoEm: Date }[]) =>
      lista.slice(1).map((e, i) => e.ocorridoEm.getTime() - lista[i]!.ocorridoEm.getTime())

    expect(distancias(futurosDepois)).toEqual(distancias(futurosAntes))
  })

  it('não avança envio de outro usuário — responde como inexistente', async () => {
    const { shipmentId } = await criarEnvioEmitido()
    const bisbilhoteiro = await criarUsuarioComSaldo(1000)
    usuariosCriados.push(bisbilhoteiro.id)

    await expect(avancarEtapa(bisbilhoteiro.id, shipmentId)).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })

  it('recusa quando o envio já percorreu todas as etapas', async () => {
    const { userId, shipmentId } = await criarEnvioEmitido()

    // Puxa tudo para o passado: não sobra evento futuro para antecipar.
    await prisma.trackingEvent.updateMany({
      where: { shipmentId },
      data: { ocorridoEm: new Date(Date.now() - 60_000) },
    })

    await expect(avancarEtapa(userId, shipmentId)).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('recusa envio cancelado', async () => {
    const { userId, shipmentId } = await criarEnvioEmitido()
    await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'CANCELLED' } })

    await expect(avancarEtapa(userId, shipmentId)).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('deixa rastro em auditoria com a conta que pediu', async () => {
    const { userId, shipmentId } = await criarEnvioEmitido()

    await avancarEtapa(userId, shipmentId)

    const registro = await prisma.auditLog.findFirst({
      where: { entidadeId: shipmentId, acao: 'ENVIO_AVANCAR_ETAPA' },
    })

    expect(registro?.actorUserId).toBe(userId)
  })
})

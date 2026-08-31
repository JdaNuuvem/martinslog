import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, SaldoInsuficienteError } from '@/domain/errors'
import { criarUsuarioComSaldo } from '@/test/factories'
import type { EnderecoEnvio } from '@/server/shipment-service'
import { cancelarEtiquetaComoAdmin, criarEtiquetaParaUsuario, excluirEnvio } from './envios'

const usuariosCriados: string[] = []
const SERVICO_ID = 'admin-envios-eco'

const remetente: EnderecoEnvio = {
  nome: 'Remetente Teste',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Destinatário Teste',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

const entrada = {
  remetente,
  destinatario,
  produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  pesoG: 1000,
  alturaCm: 10,
  larguraCm: 15,
  comprimentoCm: 20,
  formato: 'CAIXA' as const,
  cobrarSaldo: true,
}

/**
 * Catálogo mínimo para que `gerarCotacao` encontre uma opção disponível na
 * rota SP → RJ. É criado aqui, e não pelas fábricas compartilhadas, porque
 * este é o único teste que exercita a cotação de verdade (os demais montam a
 * `Quote` à mão).
 */
async function garantirCatalogo(): Promise<void> {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'admin-envios-teste' },
    update: {},
    create: { nome: 'Transportadora Admin Teste', slug: 'admin-envios-teste' },
  })

  await prisma.service.upsert({
    where: { id: SERVICO_ID },
    update: { ativo: true },
    create: {
      id: SERVICO_ID,
      carrierId: carrier.id,
      codigo: 'admin-eco',
      nome: 'Econômico Admin',
      prazoBase: 5,
      limitePesoG: 30000,
      limiteDimensoes: {},
    },
  })

  const existente = await prisma.priceRule.findFirst({ where: { serviceId: SERVICO_ID } })
  if (!existente) {
    await prisma.priceRule.create({
      data: {
        serviceId: SERVICO_ID,
        cepOrigemIni: 1000000,
        cepOrigemFim: 19999999,
        cepDestinoIni: 20000000,
        cepDestinoFim: 28999999,
        pesoMinG: 1,
        pesoMaxG: 30000,
        precoBalcaoCentavos: 2000,
        precoCustoCentavos: 1000,
        precoVendaCentavos: 1500,
        prazoDias: 5,
      },
    })
  }
}

async function usuario(saldoCentavos: number): Promise<string> {
  const criado = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(criado.id)
  return criado.id
}

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await prisma.priceRule.deleteMany({ where: { serviceId: SERVICO_ID } })
})

describe('criarEtiquetaParaUsuario', () => {
  it('cria o envio no nome do cliente, cobra a carteira e emite o código de rastreio', async () => {
    await garantirCatalogo()
    const admin = await usuario(0)
    const cliente = await usuario(10000)

    const criado = await criarEtiquetaParaUsuario(admin, cliente, entrada, 'Chamado 7')

    expect(criado.cobrado).toBe(true)
    expect(criado.codigoRastreio).toMatch(/\w/)
    expect(criado.precoCobradoCentavos).toBeGreaterThan(0)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: criado.id } })
    expect(envio.userId).toBe(cliente)
    expect(envio.status).toBe('GENERATED')

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    expect(wallet.saldoCentavos).toBe(10000 - criado.precoCobradoCentavos)

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'ENVIO_CRIADO_PELO_ADMIN', entidadeId: criado.id },
    })
    expect(log).not.toBeNull()
  })

  it('com cobrarSaldo=false, libera o envio sem nenhum lançamento no extrato', async () => {
    await garantirCatalogo()
    const admin = await usuario(0)
    const cliente = await usuario(0)

    const criado = await criarEtiquetaParaUsuario(
      admin,
      cliente,
      { ...entrada, cobrarSaldo: false },
      'Cortesia',
    )

    expect(criado.cobrado).toBe(false)
    expect(criado.codigoRastreio).toMatch(/\w/)

    const wallet = await prisma.wallet.findUnique({ where: { userId: cliente } })
    const lancamentos = wallet
      ? await prisma.ledgerEntry.count({ where: { walletId: wallet.id } })
      : 0
    expect(lancamentos).toBe(0)

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'ENVIO_LIBERADO_SEM_COBRANCA', entidadeId: criado.id },
    })
    expect(log).not.toBeNull()
  })

  it('recusa cobrar de quem não tem saldo e deixa o envio PENDING', async () => {
    await garantirCatalogo()
    const admin = await usuario(0)
    const cliente = await usuario(1)

    await expect(
      criarEtiquetaParaUsuario(admin, cliente, entrada, 'Sem saldo'),
    ).rejects.toBeInstanceOf(SaldoInsuficienteError)

    const envios = await prisma.shipment.findMany({ where: { userId: cliente } })
    expect(envios).toHaveLength(1)
    expect(envios[0]?.status).toBe('PENDING')
  })
})

describe('cancelarEtiquetaComoAdmin', () => {
  it('cancela o envio do cliente e registra a decisão administrativa', async () => {
    await garantirCatalogo()
    const admin = await usuario(0)
    const cliente = await usuario(10000)
    const criado = await criarEtiquetaParaUsuario(admin, cliente, entrada, 'Chamado 8')

    await cancelarEtiquetaComoAdmin(admin, criado.id, 'Cliente desistiu')

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: criado.id } })
    expect(envio.status).toBe('CANCELLED')

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'ENVIO_CANCELADO_PELO_ADMIN', entidadeId: criado.id },
    })
    expect(log).not.toBeNull()
  })

  it('lança EnvioNaoEncontradoError para id inexistente', async () => {
    const admin = await usuario(0)
    await expect(
      cancelarEtiquetaComoAdmin(admin, 'nao-existe', 'Motivo'),
    ).rejects.toBeInstanceOf(EnvioNaoEncontradoError)
  })
})

describe('excluirEnvio', () => {
  it('apaga envio e timeline, preserva o lançamento no extrato e guarda o envio na auditoria', async () => {
    await garantirCatalogo()
    const admin = await usuario(0)
    const cliente = await usuario(10000)
    const criado = await criarEtiquetaParaUsuario(admin, cliente, entrada, 'Chamado 9')

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    const lancamentosAntes = await prisma.ledgerEntry.count({ where: { walletId: wallet.id } })

    await excluirEnvio(admin, criado.id, 'Criado por engano')

    expect(await prisma.shipment.findUnique({ where: { id: criado.id } })).toBeNull()
    expect(await prisma.trackingEvent.count({ where: { shipmentId: criado.id } })).toBe(0)
    expect(await prisma.ledgerEntry.count({ where: { walletId: wallet.id } })).toBe(
      lancamentosAntes,
    )

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'ENVIO_EXCLUIDO', entidadeId: criado.id },
    })
    expect(log).not.toBeNull()
    expect((log?.antes as { codigoRastreio?: string } | null)?.codigoRastreio).toBe(
      criado.codigoRastreio,
    )
  })

  it('lança EnvioNaoEncontradoError para id inexistente', async () => {
    const admin = await usuario(0)
    await expect(excluirEnvio(admin, 'nao-existe', 'Motivo')).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })
})

import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Mocka `emitirEtiqueta` com implementação padrão igual à real (`vi.fn(real.emitirEtiqueta)`
 * chama a real por baixo), e só troca o comportamento pontualmente com
 * `mockImplementationOnce` no teste de falha de emissão. Assim os outros
 * testes deste arquivo (retentativa, corrida com quatro pagamentos) exercitam
 * a emissão de verdade, sem duplicar o motor de simulação em um fake.
 */
vi.mock('./emitir-etiqueta-service', async (importOriginal) => {
  const real = await importOriginal<typeof import('./emitir-etiqueta-service')>()
  return {
    ...real,
    emitirEtiqueta: vi.fn(real.emitirEtiqueta),
  }
})

import { prisma } from '@/infra/db/client'
import { TransicaoInvalidaError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { criarEnvio, pagarEnvio, reemitirEtiqueta, type EnderecoEnvio, type EntradaEnvio } from './shipment-service'

const emitirEtiquetaMock = vi.mocked(emitirEtiqueta)

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

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
  nome: 'Destinatário Teste',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

function entradaEnvio(quoteId: string): EntradaEnvio {
  return {
    quoteId,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 2, valorUnitarioCentavos: 5000 }],
  }
}

async function criarUsuarioDeTeste(saldoCentavos: number) {
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  return user
}

describe('pagarEnvio — gancho de emissão pós-pagamento', () => {
  it('falha na emissão não desfaz o pagamento: saldo debitado, envio RELEASED, um único LedgerEntry', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    emitirEtiquetaMock.mockImplementationOnce(async () => {
      throw new Error('Falha simulada de emissão (ex.: banco fora do ar)')
    })

    // `pagarEnvio` nunca deve rejeitar por causa da emissão — a falha é
    // capturada e vira log, o pagamento em si é o que decide o resultado.
    await expect(pagarEnvio(user.id, envio.id)).resolves.toBeUndefined()

    expect(emitirEtiquetaMock).toHaveBeenCalledWith(envio.id)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000 - 1416)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('RELEASED')
    expect(atualizado.pagoEm).not.toBeNull()
    expect(atualizado.codigoRastreio).toBeNull()

    const eventos = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })
    expect(eventos).toBe(0)
  })

  it('retentar a emissão de um envio RELEASED (que ficou para trás) funciona e o leva a GENERATED', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    emitirEtiquetaMock.mockImplementationOnce(async () => {
      throw new Error('Falha simulada de emissão')
    })
    await pagarEnvio(user.id, envio.id)

    const antesDaRetentativa = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(antesDaRetentativa.status).toBe('RELEASED')
    expect(antesDaRetentativa.codigoRastreio).toBeNull()

    // A partir daqui o mock já voltou ao comportamento padrão (chama a
    // implementação real), porque `mockImplementationOnce` só valeu para a
    // chamada consumida dentro de `pagarEnvio`.
    const { codigoRastreio } = await reemitirEtiqueta(envio.id)
    expect(codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(depois.status).toBe('GENERATED')
    expect(depois.codigoRastreio).toBe(codigoRastreio)

    const eventos = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })
    expect(eventos).toBeGreaterThan(1)
  })

  it('retentar em um envio já GENERATED recusa, sem criar segundo código nem duplicar a timeline', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    // Pagamento normal: emissão automática funciona de primeira (mock com
    // implementação padrão = real), envio já sai GENERATED.
    await pagarEnvio(user.id, envio.id)

    const jaEmitido = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(jaEmitido.status).toBe('GENERATED')
    const codigoOriginal = jaEmitido.codigoRastreio
    expect(codigoOriginal).not.toBeNull()

    const eventosAntes = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })

    await expect(reemitirEtiqueta(envio.id)).rejects.toBeInstanceOf(TransicaoInvalidaError)

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(depois.codigoRastreio).toBe(codigoOriginal)

    const eventosDepois = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })
    expect(eventosDepois).toBe(eventosAntes)
  })

  it('quatro participantes pagando envios diferentes da mesma carteira, ao mesmo tempo, todos terminam GENERATED com códigos distintos', async () => {
    // Saldo cobre exatamente os quatro envios — nenhuma disputa de saldo
    // insuficiente aqui, o alvo é a corrida do gancho de emissão pós-commit
    // rodando quatro vezes em paralelo sobre a mesma carteira. Dois
    // participantes não bastam: a primeira transação costuma terminar antes
    // da segunda começar e a corrida não se manifesta — com quatro, a fila
    // do lock (`SELECT ... FOR UPDATE`) fica sob pressão de verdade.
    const precoCentavos = 1416
    const user = await criarUsuarioDeTeste(precoCentavos * 4)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos })
    const envios = await Promise.all(
      Array.from({ length: 4 }, () => criarEnvio(user.id, entradaEnvio(cotacao.id))),
    )

    const resultados = await Promise.allSettled(
      envios.map((envio) => pagarEnvio(user.id, envio.id)),
    )

    expect(resultados.every((r) => r.status === 'fulfilled')).toBe(true)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(0)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(4)

    const atualizados = await prisma.shipment.findMany({
      where: { id: { in: envios.map((e) => e.id) } },
    })
    expect(atualizados).toHaveLength(4)
    for (const envio of atualizados) {
      expect(envio.status).toBe('GENERATED')
      expect(envio.codigoRastreio).not.toBeNull()
    }

    // Nenhum código de rastreio repetido entre os quatro envios.
    const codigos = atualizados.map((e) => e.codigoRastreio)
    expect(new Set(codigos).size).toBe(4)

    for (const envio of atualizados) {
      const eventos = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })
      expect(eventos).toBeGreaterThan(1)
    }
  })
})

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, TransicaoInvalidaError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { ID_CONFIG_SIMULACAO } from './simulacao-config'
import { rastrearEnvio } from './rastreio-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({
    where: { shipmentId: { in: envios.map((e) => e.id) } },
  })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await definirFatorGlobal(1)
})

/**
 * A configuração da simulação é um registro único global e outros testes
 * dependem do fator 1. Cada teste que a mexe devolve ao padrão aqui.
 */
beforeEach(async () => {
  await definirFatorGlobal(1)
})

async function definirFatorGlobal(fatorVelocidade: number): Promise<void> {
  await prisma.simulacaoConfig.upsert({
    where: { id: ID_CONFIG_SIMULACAO },
    update: { fatorVelocidade },
    create: { id: ID_CONFIG_SIMULACAO, fatorVelocidade },
  })
}

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

/**
 * Cria um envio já pago (`RELEASED`), que é o único estado a partir do qual a
 * etiqueta pode ser emitida. Aceita um destinatário alternativo para o caso
 * de origem e destino na mesma cidade.
 */
async function criarEnvioPago(
  destino: EnderecoEnvio = destinatario,
): Promise<{ userId: string; shipmentId: string }> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id, { cepDestino: destino.cep })

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario: destino,
    produtos: [{ nome: 'Camiseta', quantidade: 2, valorUnitarioCentavos: 5000 }],
  })

  // Marca como pago sem passar por `pagarEnvio`: desde que o pagamento
  // ganhou o gancho de emissão automática, chamá-lo aqui já emitiria a
  // etiqueta e não sobraria nada para estes testes exercerem. O que se quer
  // é exatamente o estado anterior à emissão — `RELEASED`, sem código.
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })

  return { userId: user.id, shipmentId: envio.id }
}

async function criarEnvioNaoPago(): Promise<string> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id)

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  return envio.id
}

describe('emitirEtiqueta', () => {
  it('atribui código de rastreio e move o envio de RELEASED para GENERATED', async () => {
    const { shipmentId } = await criarEnvioPago()

    const { codigoRastreio } = await emitirEtiqueta(shipmentId)

    expect(codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
    expect(envio.codigoRastreio).toBe(codigoRastreio)
    expect(envio.geradoEm).not.toBeNull()
    expect(envio.simulacaoIniciadaEm).not.toBeNull()
    // O fator copiado tem de ser um inteiro positivo. Não se afirma qual:
    // `SimulacaoConfig` é uma linha única global e os arquivos de teste
    // rodam em paralelo contra o mesmo banco, então outro arquivo pode ter
    // trocado o fator global entre a criação e a emissão deste envio. O que
    // este teste garante é que o envio saiu com um fator próprio gravado.
    expect(Number.isInteger(envio.fatorSimulacao)).toBe(true)
    expect(envio.fatorSimulacao).toBeGreaterThan(0)
  })

  it('grava a timeline inteira do cenário, com sequência e offsets crescentes', async () => {
    const { shipmentId } = await criarEnvioPago()

    await emitirEtiqueta(shipmentId)

    const eventos = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
    })

    expect(eventos.length).toBeGreaterThan(1)
    expect(eventos.map((e) => e.sequencia)).toEqual(
      Array.from({ length: eventos.length }, (_, i) => i + 1),
    )

    const [primeiro] = eventos
    expect(primeiro?.codigo).toBe('ETIQUETA_EMITIDA')
    expect(primeiro?.offsetMinutos).toBe(0)
    expect(eventos.at(-1)?.codigo).toBe('ENTREGUE')

    // Comparar cada evento com o anterior sem indexação crua: `slice(1)` dá o
    // par (anterior, atual) já tipado, sem `T | undefined`.
    eventos.slice(1).forEach((atual, indice) => {
      const anterior = eventos[indice] as (typeof eventos)[number]
      expect(atual.offsetMinutos).toBeGreaterThan(anterior.offsetMinutos)
      expect(atual.ocorridoEm.getTime()).toBeGreaterThan(anterior.ocorridoEm.getTime())
    })
  })

  it('deixa visível apenas o primeiro evento: o resto nasce no futuro', async () => {
    const { shipmentId } = await criarEnvioPago()

    const { codigoRastreio } = await emitirEtiqueta(shipmentId)
    const rastreio = await rastrearEnvio(codigoRastreio)

    expect(rastreio.eventos).toHaveLength(1)
    expect(rastreio.eventos.at(0)?.codigo).toBe('ETIQUETA_EMITIDA')
    expect(rastreio.status).toBe('GENERATED')
  })

  it('copia o fator de velocidade global para o envio, em vez de referenciá-lo', async () => {
    const { shipmentId } = await criarEnvioPago()
    await emitirEtiqueta(shipmentId)

    const { fatorSimulacao: fatorNaEmissao } = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { fatorSimulacao: true },
    })

    const antes = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true, ocorridoEm: true },
    })

    // Acelerar a simulação global não pode reescrever a linha do tempo de
    // quem já está em trânsito (spec seção 2).
    await definirFatorGlobal(288)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.fatorSimulacao).toBe(fatorNaEmissao)

    const depois = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true, ocorridoEm: true },
    })
    expect(depois).toEqual(antes)
  })

  it('aplica o fator vigente na emissão: fator 1440 comprime um dia em um minuto', async () => {
    await definirFatorGlobal(1440)
    const { shipmentId } = await criarEnvioPago()

    await emitirEtiqueta(shipmentId)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })

    const eventos = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
    })
    const inicio = envio.simulacaoIniciadaEm!.getTime()
    const ultimo = eventos.at(-1)!

    // offsetMinutos é tempo de simulação: com fator 1440, cada dia simulado
    // (1440 min) leva 1 minuto de relógio real. A divisão usa o fator
    // gravado no envio, e não a constante, porque o fator global é
    // compartilhado entre arquivos de teste que rodam em paralelo — o que
    // importa provar é que as datas seguem o fator que o envio copiou.
    const minutosReaisEsperados = ultimo.offsetMinutos / envio.fatorSimulacao
    const minutosReais = (ultimo.ocorridoEm.getTime() - inicio) / 60_000
    expect(minutosReais).toBeCloseTo(minutosReaisEsperados, 3)
  })

  it('recusa a segunda emissão: um código só, uma timeline só', async () => {
    const { shipmentId } = await criarEnvioPago()

    const { codigoRastreio } = await emitirEtiqueta(shipmentId)
    const eventosDepoisDaPrimeira = await prisma.trackingEvent.count({ where: { shipmentId } })

    await expect(emitirEtiqueta(shipmentId)).rejects.toBeInstanceOf(TransicaoInvalidaError)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.codigoRastreio).toBe(codigoRastreio)
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(
      eventosDepoisDaPrimeira,
    )
  })

  it('recusa envio não pago e não consome código de rastreio', async () => {
    const shipmentId = await criarEnvioNaoPago()

    await expect(emitirEtiqueta(shipmentId)).rejects.toBeInstanceOf(TransicaoInvalidaError)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('PENDING')
    expect(envio.codigoRastreio).toBeNull()
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(0)
  })

  it('lança EnvioNaoEncontradoError para envio inexistente', async () => {
    await expect(emitirEtiqueta('nao-existe')).rejects.toBeInstanceOf(EnvioNaoEncontradoError)
  })

  it('não gera duas transferências quando origem e destino são a mesma cidade', async () => {
    const mesmaCidade: EnderecoEnvio = {
      ...destinatario,
      cep: '01310-200',
      cidade: 'São Paulo',
      uf: 'SP',
    }
    const { shipmentId } = await criarEnvioPago(mesmaCidade)

    await emitirEtiqueta(shipmentId)

    const transferencias = await prisma.trackingEvent.count({
      where: { shipmentId, codigo: 'TRANSFERENCIA' },
    })
    expect(transferencias).toBe(1)
  })

  it('não expõe nome nem logradouro do destinatário na timeline gravada', async () => {
    const { shipmentId } = await criarEnvioPago()

    await emitirEtiqueta(shipmentId)

    const eventos = await prisma.trackingEvent.findMany({ where: { shipmentId } })
    const serializado = JSON.stringify(eventos)

    expect(serializado).not.toContain('Maria Aparecida')
    expect(serializado).not.toContain('Rua das Flores')
    expect(serializado).toContain('Rio de Janeiro')
  })
})

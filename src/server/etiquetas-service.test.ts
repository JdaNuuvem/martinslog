import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import {
  CancelamentoNaoPermitidoError,
  EnvioNaoEncontradoError,
} from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { cancelarEtiqueta, listarEtiquetas, obterEtiqueta } from './etiquetas-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const carteiras = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({
    where: { shipmentId: { in: envios.map((e) => e.id) } },
  })
  await prisma.ledgerEntry.deleteMany({
    where: { walletId: { in: carteiras.map((c) => c.id) } },
  })
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

function destinatarioChamado(nome: string): EnderecoEnvio {
  return {
    nome,
    documento: '52998224725',
    cep: '20040-020',
    logradouro: 'Av. Rio Branco',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
  }
}

const PRECO_CENTAVOS = 1416

async function criarCliente(): Promise<string> {
  const user = await criarUsuarioComSaldo(100_000)
  usuariosCriados.push(user.id)
  return user.id
}

/** Cria um envio em `PENDING` (não pago, logo sem código nem timeline). */
async function criarEnvioDe(userId: string, nomeDestinatario = 'Bruno Lima'): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { precoCentavos: PRECO_CENTAVOS })
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario: destinatarioChamado(nomeDestinatario),
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  return envio.id
}

/** Marca como pago e emite, sem passar por `pagarEnvio` (que já emite). */
async function emitirEnvioDe(userId: string, nomeDestinatario = 'Bruno Lima'): Promise<string> {
  const shipmentId = await criarEnvioDe(userId, nomeDestinatario)
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })
  await emitirEtiqueta(shipmentId)
  return shipmentId
}

describe('listarEtiquetas', () => {
  it('devolve apenas os envios do usuário, com valor e permissão de cancelar', async () => {
    const dono = await criarCliente()
    const outro = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)
    await emitirEnvioDe(outro)

    const { etiquetas } = await listarEtiquetas(dono)

    expect(etiquetas).toHaveLength(1)
    const etiqueta = etiquetas[0]
    expect(etiqueta?.id).toBe(shipmentId)
    expect(etiqueta?.valorCentavos).toBe(PRECO_CENTAVOS)
    expect(etiqueta?.codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)
    expect(etiqueta?.podeCancelar).toBe(true)
    expect(etiqueta?.destinatarioNome).toBe('Bruno Lima')
  })

  it('separa as abas por status e conta cada uma', async () => {
    const dono = await criarCliente()
    await criarEnvioDe(dono) // PENDING → aguardando postagem
    const emitido = await emitirEnvioDe(dono) // GENERATED → aguardando postagem
    const entregue = await emitirEnvioDe(dono)
    await prisma.shipment.update({ where: { id: entregue }, data: { status: 'DELIVERED' } })
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: entregue } })

    const { contagem } = await listarEtiquetas(dono)

    expect(contagem.todos).toBe(3)
    expect(contagem.aguardando_postagem).toBe(2)
    expect(contagem.entregues).toBe(1)
    expect(contagem.postados).toBe(0)
    expect(contagem.cancelados).toBe(0)

    const aguardando = await listarEtiquetas(dono, { aba: 'aguardando_postagem' })
    expect(aguardando.etiquetas.map((e) => e.id)).toContain(emitido)

    const entregues = await listarEtiquetas(dono, { aba: 'entregues' })
    expect(entregues.etiquetas.map((e) => e.id)).toEqual([entregue])
  })

  it('busca por código de rastreio e por nome do destinatário, sem diferenciar caixa', async () => {
    const dono = await criarCliente()
    const alvo = await emitirEnvioDe(dono, 'Maria Aparecida')
    await emitirEnvioDe(dono, 'João Pedro')

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: alvo } })

    const porNome = await listarEtiquetas(dono, { busca: 'maria' })
    expect(porNome.etiquetas.map((e) => e.id)).toEqual([alvo])

    const porCodigo = await listarEtiquetas(dono, {
      busca: envio.codigoRastreio!.toLowerCase(),
    })
    expect(porCodigo.etiquetas.map((e) => e.id)).toEqual([alvo])

    const semResultado = await listarEtiquetas(dono, { busca: 'ninguém com esse nome' })
    expect(semResultado.etiquetas).toHaveLength(0)
    // A contagem das abas ignora a busca: os números das abas descrevem a
    // conta inteira, não o resultado do filtro de texto.
    expect(semResultado.contagem.todos).toBe(2)
  })
})

describe('obterEtiqueta', () => {
  it('devolve o envio com a timeline visível', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    const etiqueta = await obterEtiqueta(dono, shipmentId)

    expect(etiqueta.id).toBe(shipmentId)
    expect(etiqueta.eventos.length).toBeGreaterThan(0)
    expect(etiqueta.produtos.length).toBeGreaterThan(0)
    expect(etiqueta.destinatario.nome).toBe('Bruno Lima')
  })

  it('devolve EnvioNaoEncontradoError para envio de outro usuário', async () => {
    const dono = await criarCliente()
    const intruso = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    await expect(obterEtiqueta(intruso, shipmentId)).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })
})

describe('cancelarEtiqueta', () => {
  it('cancela o envio, descarta os eventos futuros e preserva os passados', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    const passadosAntes = await prisma.trackingEvent.findMany({
      where: { shipmentId, ocorridoEm: { lte: new Date() } },
    })
    expect(passadosAntes.length).toBeGreaterThan(0)
    const futurosAntes = await prisma.trackingEvent.count({
      where: { shipmentId, ocorridoEm: { gt: new Date() } },
    })
    expect(futurosAntes).toBeGreaterThan(0)

    await cancelarEtiqueta(dono, shipmentId)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('CANCELLED')
    expect(envio.canceladoEm).not.toBeNull()

    // O que o cliente já viu continua lá; o que não aconteceria foi descartado.
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(
      passadosAntes.length,
    )
  })

  it('não devolve dinheiro: o saldo e o ledger ficam intactos', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)
    const carteiraAntes = await prisma.wallet.findUniqueOrThrow({ where: { userId: dono } })

    await cancelarEtiqueta(dono, shipmentId)

    // Decisão de produto de 31/08/2026: nenhum caso estorna. Este teste é a
    // trava contra a regra voltar por descuido.
    const carteiraDepois = await prisma.wallet.findUniqueOrThrow({ where: { userId: dono } })
    expect(carteiraDepois.saldoCentavos).toBe(carteiraAntes.saldoCentavos)
    expect(
      await prisma.ledgerEntry.count({
        where: { walletId: carteiraDepois.id, tipo: 'CREDITO', refId: shipmentId },
      }),
    ).toBe(0)
  })

  it('registra a auditoria do cancelamento com o ator e o valor perdido', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    await cancelarEtiqueta(dono, shipmentId)

    const log = await prisma.auditLog.findFirst({
      where: { acao: 'ENVIO_CANCELADO', entidadeId: shipmentId },
    })
    expect(log?.actorUserId).toBe(dono)
    expect(log?.depois).toMatchObject({ status: 'CANCELLED' })
  })

  it('recusa cancelar envio já postado', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)
    await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'POSTED' } })

    await expect(cancelarEtiqueta(dono, shipmentId)).rejects.toBeInstanceOf(
      CancelamentoNaoPermitidoError,
    )

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('POSTED')
  })

  it('recusa cancelar duas vezes', async () => {
    const dono = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    await cancelarEtiqueta(dono, shipmentId)

    await expect(cancelarEtiqueta(dono, shipmentId)).rejects.toBeInstanceOf(
      CancelamentoNaoPermitidoError,
    )
    expect(
      await prisma.auditLog.count({ where: { acao: 'ENVIO_CANCELADO', entidadeId: shipmentId } }),
    ).toBe(1)
  })

  it('devolve 404 — não 403 — ao cancelar envio de outro usuário, e não o altera', async () => {
    const dono = await criarCliente()
    const intruso = await criarCliente()
    const shipmentId = await emitirEnvioDe(dono)

    await expect(cancelarEtiqueta(intruso, shipmentId)).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })
})

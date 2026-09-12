import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { alternarTemplate, salvarTemplate } from './template-rastreio-service'

/**
 * A pergunta que estes testes respondem é simples e não estava coberta: uma
 * etiqueta emitida por uma conta com fluxo personalizado ativo segue esse
 * fluxo, e não o roteiro automático?
 */

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

const PASSOS = [
  { id: 'a', codigo: 'POSTADO', titulo: 'Saiu da nossa loja', descricao: 'x', diasAposAnterior: 0 },
  { id: 'b', codigo: 'TRANSFERENCIA', titulo: 'Viajando', descricao: 'x', diasAposAnterior: 1 },
  { id: 'c', codigo: 'ENTREGUE', titulo: 'Na sua mão', descricao: 'x', diasAposAnterior: 2 },
]

async function emitirParaUsuario(userId: string): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { cepDestino: destinatario.cep })
  const envio = await criarEnvio(userId, {
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

  return envio.id
}

async function novoUsuario(): Promise<string> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  return user.id
}

describe('emissão com fluxo personalizado', () => {
  it('gera a timeline com os passos do template, e não com o roteiro automático', async () => {
    const userId = await novoUsuario()
    await salvarTemplate(userId, PASSOS)

    const shipmentId = await emitirParaUsuario(userId)

    const eventos = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
    })

    expect(eventos.map((e) => e.codigo)).toEqual(['POSTADO', 'TRANSFERENCIA', 'ENTREGUE'])
    expect(eventos.map((e) => e.titulo)).toEqual(['Saiu da nossa loja', 'Viajando', 'Na sua mão'])
  })

  it('respeita os intervalos do fluxo: cada etapa cai o seu tanto depois da anterior', async () => {
    const userId = await novoUsuario()
    await salvarTemplate(userId, PASSOS)

    const shipmentId = await emitirParaUsuario(userId)

    const eventos = await prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { sequencia: 'asc' },
      select: { offsetMinutos: true },
    })

    // 0, depois +1 dia, depois +2 dias.
    expect(eventos.map((e) => e.offsetMinutos)).toEqual([0, 1440, 4320])
  })

  it('volta ao roteiro automático quando o fluxo está salvo mas desligado', async () => {
    const userId = await novoUsuario()
    await salvarTemplate(userId, PASSOS)
    await alternarTemplate(userId, false)

    const shipmentId = await emitirParaUsuario(userId)

    const codigos = (
      await prisma.trackingEvent.findMany({
        where: { shipmentId },
        orderBy: { sequencia: 'asc' },
        select: { codigo: true },
      })
    ).map((e) => e.codigo)

    expect(codigos).toContain('ETIQUETA_EMITIDA')
    expect(codigos.length).toBeGreaterThan(PASSOS.length)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { reenviarAvisoDoStatus } from './reenvio-aviso-service'

/**
 * O reenvio manual do aviso ao comprador.
 *
 * O que se protege aqui é o caso que motivou o botão: o comprador diz que não
 * recebeu o código, e o aviso automático — que sai uma vez só, de propósito —
 * já foi dado como enviado. Sem o reenvio, a única saída era alterar o banco
 * à mão.
 */

const usuariosCriados: string[] = []
const perfisCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const ids = envios.map((envio) => envio.id)
  const carteiras = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId: { in: perfisCriados } } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId: { in: perfisCriados } } })
  await prisma.emailDelivery.deleteMany({ where: { shipmentId: { in: ids } } })
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: ids } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfisCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: carteiras.map((c) => c.id) } } })
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

function destinatario(extras: Partial<EnderecoEnvio> = {}): EnderecoEnvio {
  return {
    nome: 'Bruno Lima',
    documento: '52998224725',
    cep: '20040-020',
    logradouro: 'Av. Rio Branco',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    ...extras,
  }
}

let userId = ''
let perfilId = ''

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(500_000)
  userId = user.id
  usuariosCriados.push(userId)
  const perfil = await prisma.perfil.create({
    data: { userId, nome: 'Loja do teste de reenvio', nomeExibicao: 'Loja' },
  })
  perfilId = perfil.id
  perfisCriados.push(perfilId)
})

/** Cria e emite um envio, que é quando a timeline passa a existir. */
async function envioEmitido(extras: Partial<EnderecoEnvio> = {}): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { precoCentavos: 1416 })
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    perfilId,
    remetente,
    destinatario: destinatario(extras),
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })
  await emitirEtiqueta(envio.id)
  return envio.id
}

describe('reenviarAvisoDoStatus', () => {
  it('enfileira o aviso do evento atual para quem tem telefone', async () => {
    const shipmentId = await envioEmitido({ telefone: '21999990001' })

    const reenvio = await reenviarAvisoDoStatus(userId, shipmentId)

    expect(reenvio.evento).toBe('ETIQUETA_EMITIDA')

    const sms = await prisma.mensagemEnvio.findFirst({
      where: { shipmentId, canal: 'SMS' },
    })
    expect(sms?.status).toBe('PENDENTE')
    expect(sms?.evento).toBe('ETIQUETA_EMITIDA')
  })

  it('a segunda vez devolve a MESMA mensagem para a fila, sem duplicar a linha', async () => {
    const shipmentId = await envioEmitido({ telefone: '21999990002' })

    await reenviarAvisoDoStatus(userId, shipmentId)

    // Simula a mensagem já tendo saído: é esse o estado de quem clica no
    // botão porque "o cliente não recebeu".
    await prisma.mensagemEnvio.updateMany({
      where: { shipmentId, canal: 'SMS' },
      data: { status: 'ENVIADA', tentativas: 2, enviadaEm: new Date() },
    })

    const segundo = await reenviarAvisoDoStatus(userId, shipmentId)
    expect(segundo.canais).toContainEqual({ canal: 'SMS', resultado: 'reenfileirada' })

    const mensagens = await prisma.mensagemEnvio.findMany({ where: { shipmentId, canal: 'SMS' } })
    /*
      Uma linha só. A trava contra duplicata no banco continua valendo — o
      reenvio ressuscita a mensagem que existe em vez de criar outra, e é isso
      que impede o histórico de virar uma pilha de cópias do mesmo aviso.
    */
    expect(mensagens).toHaveLength(1)
    expect(mensagens[0]?.status).toBe('PENDENTE')
    expect(mensagens[0]?.tentativas).toBe(0)
  })

  it('sem telefone e sem e-mail, diz que não reenviou nada em vez de falhar', async () => {
    const shipmentId = await envioEmitido()

    const reenvio = await reenviarAvisoDoStatus(userId, shipmentId)

    expect(reenvio.canais.every((canal) => canal.resultado === 'sem-destino')).toBe(true)
    expect(await prisma.mensagemEnvio.count({ where: { shipmentId } })).toBe(0)
  })

  it('registra o reenvio na auditoria, porque ele toca o comprador', async () => {
    const shipmentId = await envioEmitido({ telefone: '21999990003' })

    await reenviarAvisoDoStatus(userId, shipmentId)

    const registro = await prisma.auditLog.findFirst({
      where: { entidadeId: shipmentId, acao: 'AVISO_REENVIADO' },
    })
    expect(registro?.actorUserId).toBe(userId)
  })

  it('recusa o envio de outro usuário com o mesmo erro de envio inexistente', async () => {
    const shipmentId = await envioEmitido({ telefone: '21999990004' })
    const outro = await criarUsuarioComSaldo(0)
    usuariosCriados.push(outro.id)

    await expect(reenviarAvisoDoStatus(outro.id, shipmentId)).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })

  it('recusa o envio que ainda não tem movimentação nenhuma', async () => {
    const cotacao = await criarCotacaoValida(userId, { precoCentavos: 1416 })
    const envio = await criarEnvio(userId, {
      quoteId: cotacao.id,
      servicoId: 'eco',
      perfilId,
      remetente,
      destinatario: destinatario({ telefone: '21999990005' }),
      produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
    })

    await expect(reenviarAvisoDoStatus(userId, envio.id)).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})

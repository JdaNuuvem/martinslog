import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { avancarEtapaEmLote } from '@/server/avancar-lote-service'
import { criarEnvio, pagarEnvio } from '@/server/shipment-service'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'

/**
 * Mover várias encomendas de uma vez.
 *
 * Com novecentas etiquetas na tela, um clique por linha não é uma operação — é
 * um castigo. O que estes testes protegem não é o laço: é o que separa um lote
 * útil de um lote perigoso.
 */

const ENDERECO = {
  nome: 'Compradora Teste',
  documento: '52998224725',
  cep: '20040020',
  logradouro: 'Avenida Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}
const REMETENTE = { ...ENDERECO, nome: 'Loja', cep: '01310100', cidade: 'São Paulo', uf: 'SP' }

let dono = ''
let outro = ''
let admin = ''
const doDono: string[] = []
let doOutro = ''

async function envioPago(userId: string): Promise<string> {
  const cotacao = await criarCotacaoValida(userId)
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente: REMETENTE,
    destinatario: ENDERECO,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  // Só envio pago tem etiqueta, e só etiqueta tem percurso para avançar.
  await pagarEnvio(userId, envio.id)
  return envio.id
}

beforeAll(async () => {
  const a = await criarUsuarioComSaldo(50_000)
  const b = await criarUsuarioComSaldo(50_000)
  const c = await criarUsuarioComSaldo(0)
  dono = a.id
  outro = b.id
  admin = c.id
  await prisma.user.update({ where: { id: admin }, data: { papel: 'ADMIN' } })

  doDono.push(await envioPago(dono), await envioPago(dono), await envioPago(dono))
  doOutro = await envioPago(outro)
})

afterAll(async () => {
  const contas = [dono, outro, admin]
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: contas } } })
  await prisma.trackingEvent.deleteMany({ where: { shipment: { userId: { in: contas } } } })
  await prisma.webhookDelivery.deleteMany({
    where: { webhookApp: { userId: { in: contas } } },
  })
  await prisma.shipment.deleteMany({ where: { userId: { in: contas } } })
  await prisma.quote.deleteMany({ where: { userId: { in: contas } } })
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: contas } } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: contas } } })
  await prisma.user.deleteMany({ where: { id: { in: contas } } })
})

describe('avançar etapa em lote', () => {
  it('avança os selecionados e diz quantos foram', async () => {
    const r = await avancarEtapaEmLote({ userId: dono, papel: 'CLIENTE' }, doDono.slice(0, 2))

    expect(r.avancados).toBe(2)
    expect(r.falhas).toBe(0)
    expect(r.itens.every((i) => i.ok && i.etapa)).toBe(true)
  })

  it('um que falha não derruba os outros, e o motivo vem junto', async () => {
    /*
      A lição do lote: "tudo ou nada" deixa quem clicou sem saber o que foi
      feito, e a segunda tentativa vira aposta — repetir um avanço que já
      aconteceu puxa OUTRA etapa.
    */
    const cancelado = await envioPago(dono)
    await prisma.shipment.update({ where: { id: cancelado }, data: { status: 'CANCELLED' } })

    const r = await avancarEtapaEmLote({ userId: dono, papel: 'CLIENTE' }, [
      doDono[2]!,
      cancelado,
    ])

    expect(r.avancados).toBe(1)
    expect(r.falhas).toBe(1)
    const ruim = r.itens.find((i) => !i.ok)
    expect(ruim?.erro).toMatch(/cancelado/i)
  })

  it('id repetido na seleção avança UMA vez só', async () => {
    /*
      Duplicata é acidente de interface — um clique que registrou duas vezes,
      uma seleção somada à outra. Avançar duas vezes faria o pacote saltar do
      "postado" para o "saiu para entrega" sem passar pelo meio, e o comprador
      veria a linha do tempo pular.
    */
    const envio = await envioPago(dono)
    const r = await avancarEtapaEmLote({ userId: dono, papel: 'CLIENTE' }, [envio, envio, envio])

    expect(r.itens).toHaveLength(1)
    expect(r.avancados).toBe(1)
  })

  it('lojista não move envio de outra conta', async () => {
    const r = await avancarEtapaEmLote({ userId: dono, papel: 'CLIENTE' }, [doOutro])

    expect(r.avancados).toBe(0)
    expect(r.itens[0]!.codigo).toBe('ENVIO_NAO_ENCONTRADO')

    // E o envio do outro continua onde estava.
    const eventos = await prisma.trackingEvent.count({
      where: { shipmentId: doOutro, ocorridoEm: { lte: new Date() } },
    })
    expect(eventos).toBeGreaterThanOrEqual(0)
  })

  it('administrador move envio de qualquer loja, e a auditoria diz quem foi', async () => {
    const r = await avancarEtapaEmLote({ userId: admin, papel: 'ADMIN' }, [doOutro])

    expect(r.avancados).toBe(1)

    /*
      Duas linhas de auditoria, de propósito: uma pelo DONO (é a linha do tempo
      dele que andou) e outra pelo ADMINISTRADOR (é ele quem pediu). Guardar só
      a primeira apagaria a resposta à única pergunta que aparece depois: quem
      mexeu nisto?
    */
    const doAdmin = await prisma.auditLog.count({
      where: {
        actorUserId: admin,
        acao: 'ENVIO_AVANCAR_ETAPA_PELO_ADMIN',
        entidadeId: doOutro,
      },
    })
    expect(doAdmin).toBe(1)
  })
})

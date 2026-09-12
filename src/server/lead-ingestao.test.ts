import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { registrarPedido } from './pedido-service'

const usuariosCriados: string[] = []
let userId = ''
let perfilId = ''

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

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(500_000)
  userId = user.id
  usuariosCriados.push(userId)
  const perfil = await prisma.perfil.create({
    data: { userId, nome: 'Loja do teste de leads' },
  })
  perfilId = perfil.id
})

/*
  Limpa ANTES de cada teste, e não depois.

  Outros arquivos da suíte criam leads como efeito colateral — todo teste que
  registra pedido ou emite etiqueta passa a alimentar a base — e nenhum deles
  os apaga, porque `LeadOrigem` não tem chave estrangeira para usuário, envio
  ou pedido e a limpeza deles não cascateia até aqui. Limpando só no fim, o
  primeiro teste deste arquivo herdaria os leads do arquivo que rodou antes, e
  a contagem exata que ele afirma dependeria da ordem da suíte.

  Apagar sem filtro é seguro porque `vitest.config.ts` roda um arquivo por vez
  (`fileParallelism: false`).
*/
beforeEach(async () => {
  await prisma.lead.deleteMany({})
})

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const ids = envios.map((e) => e.id)
  const carteiras = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: ids } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.pedido.deleteMany({ where: { perfilId } })
  await prisma.perfil.deleteMany({ where: { id: perfilId } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: carteiras.map((c) => c.id) } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function emitir(destinatario: EnderecoEnvio, sandbox = false): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { precoCentavos: 1416 })
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    perfilId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date(), sandbox },
  })
  await emitirEtiqueta(envio.id)
  return envio.id
}

const compradora: EnderecoEnvio = {
  nome: 'Maria Aparecida',
  documento: '111.444.777-35',
  email: 'maria@exemplo.com',
  telefone: '21999990001',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

describe('ingestão de leads', () => {
  it('pedido registrado vira lead', async () => {
    await registrarPedido(perfilId, {
      externalId: `ped-${Date.now()}`,
      status: 'PAGO',
      clienteNome: 'Maria Aparecida',
      clienteFone: '21999990001',
      clienteEmail: 'maria@exemplo.com',
      valorCentavos: 9990,
    })

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.telefoneNormalizado).toBe('21999990001')
    expect(lead.totalPedidos).toBe(1)
    expect(lead.valorTotalCentavos).toBe(9990)
  })

  it('pedido pendente também vira lead', async () => {
    /*
      O caso que um `registrarLead` posto no fim de `registrarPedido` perderia:
      a função sai cedo para todo pedido que não é PAGO. Pedido não finalizado
      é o lead no sentido literal — quem se interessou e não fechou —, e é uma
      das origens que o spec exige.
    */
    await registrarPedido(perfilId, {
      externalId: `pend-${Date.now()}`,
      status: 'PENDENTE',
      clienteNome: 'Carla Pendente',
      clienteFone: '21999990066',
      valorCentavos: 4500,
    })

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.telefoneNormalizado).toBe('21999990066')
    expect(lead.totalPedidos).toBe(1)
    // Pedido não pago não soma valor: o dinheiro não entrou.
    expect(lead.valorTotalCentavos).toBe(0)
  })

  it('etiqueta emitida vira lead e traz o CPF', async () => {
    await emitir(compradora)

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.cpfHash).not.toBeNull()
    expect(lead.totalEnvios).toBe(1)
  })

  it('envio sandbox não vira lead', async () => {
    /*
      O comprador de um pedido de teste não existe. Sem esta regra a base
      fica poluída com os dados fictícios de quem está integrando.
    */
    await emitir({ ...compradora, documento: '529.982.247-25' }, true)

    expect(await prisma.lead.count()).toBe(0)
  })

  it('falha ao registrar lead não derruba a emissão da etiqueta', async () => {
    /*
      A falha é provocada de VERDADE, não por substituição da função: sem o
      segredo da impressão digital, `registrarLead` lança ao processar um CPF.
      Um teste que troca a função por outra prova que o mock foi chamado; este
      prova que o caminho de erro real não derruba a emissão.

      (Mock de módulo ESM também é frágil aqui — o namespace é congelado e o
      spy falha de forma intermitente conforme o bundler.)
    */
    const segredo = process.env.LEAD_FINGERPRINT_KEY
    delete process.env.LEAD_FINGERPRINT_KEY

    try {
      // A etiqueta é o produto; o lead é subproduto. Uma falha no subproduto
      // não pode desfazer uma emissão que já aconteceu.
      const shipmentId = await emitir(compradora)

      const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
      expect(envio.codigoRastreio).not.toBeNull()
      expect(await prisma.lead.count()).toBe(0)
    } finally {
      // `undefined` atribuído a `process.env` vira o texto "undefined" em vez
      // de apagar a variável — e vazaria para os arquivos seguintes da suíte.
      if (segredo === undefined) delete process.env.LEAD_FINGERPRINT_KEY
      else process.env.LEAD_FINGERPRINT_KEY = segredo
    }
  })
})

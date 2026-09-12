import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { impressaoDigitalCpf } from '@/domain/lead/identidade'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { carregarLeads } from './carga-leads'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { registrarPedido } from './pedido-service'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'

/**
 * A carga inicial reconstrói a base a partir do histórico.
 *
 * Os dados são semeados pelos fluxos normais — que, depois da Task 4, já
 * alimentam a base ao vivo — e a base é apagada em seguida. Isso reproduz o
 * cenário real: pedidos, envios e conversas que existiam antes de a base de
 * leads existir.
 *
 * As asserções procuram o lead pelo telefone único de cada teste, e não pela
 * contagem total da tabela: a carga varre o banco inteiro, e outros arquivos da
 * suíte podem ter deixado pedidos ou envios para trás.
 */

const usuariosCriados: string[] = []
let userId = ''
let perfilId = ''
let sequencia = 0

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

/**
 * CPF com dígitos verificadores válidos a partir de nove dígitos de base.
 *
 * Cada teste precisa de um CPF que nenhum outro arquivo use: com um CPF fixo, um
 * envio deixado para trás por outro teste seria fundido no mesmo lead e os
 * totais afirmados aqui deixariam de ser verdade.
 */
function cpfValido(base9: string): string {
  const digito = (lista: number[]): number => {
    const soma = lista.reduce((acc, d, i) => acc + d * (lista.length + 1 - i), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const base = base9.split('').map(Number)
  const d1 = digito(base)
  const d2 = digito([...base, d1])
  return `${base9}${d1}${d2}`
}

function pessoaUnica(): { telefone: string; cpf: string } {
  sequencia += 1
  const sufixo = String(Date.now() + sequencia).slice(-8)
  return { telefone: `219${sufixo}`, cpf: cpfValido(`3${sufixo}`) }
}

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(500_000)
  userId = user.id
  usuariosCriados.push(userId)
  const perfil = await prisma.perfil.create({ data: { userId, nome: 'Loja do teste de carga' } })
  perfilId = perfil.id
})

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

  await prisma.lead.deleteMany({})
  await prisma.conversa.deleteMany({ where: { perfilId } })
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: ids } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId } })
  await prisma.pedido.deleteMany({ where: { perfilId } })
  await prisma.perfil.deleteMany({ where: { id: perfilId } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: carteiras.map((c) => c.id) } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function emitirPara(pessoa: { telefone: string; cpf: string }, sandbox = false): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { precoCentavos: 1416 })
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    perfilId,
    remetente,
    destinatario: {
      nome: 'Pessoa da Carga',
      documento: pessoa.cpf,
      telefone: pessoa.telefone,
      cep: '20040-020',
      logradouro: 'Av. Rio Branco',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
    },
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date(), sandbox },
  })
  await emitirEtiqueta(envio.id)
  return envio.id
}

describe('carregarLeads', () => {
  it(
    'reconstrói um lead só a partir de pedido, envio e conversa da mesma pessoa',
    async () => {
      const pessoa = pessoaUnica()
      await registrarPedido(perfilId, {
        externalId: `carga-${pessoa.telefone}`,
        status: 'PAGO',
        clienteNome: 'Pessoa da Carga',
        clienteFone: pessoa.telefone,
        valorCentavos: 9990,
      })
      await emitirPara(pessoa)
      await prisma.conversa.create({
        data: { perfilId, contato: pessoa.telefone, nomeContato: 'pessoa' },
      })

      // O fluxo ao vivo já alimentou a base; apagá-la simula o histórico que
      // existia antes de ela existir.
      await prisma.lead.deleteMany({})

      const resultado = await carregarLeads()

      expect(resultado.falhas).toBe(0)
      const leads = await prisma.lead.findMany({ where: { telefoneNormalizado: pessoa.telefone } })
      expect(leads).toHaveLength(1)
      const lead = leads[0]!
      expect(lead.cpfHash).toBe(impressaoDigitalCpf(pessoa.cpf))
      expect(lead.totalPedidos).toBe(1)
      expect(lead.totalEnvios).toBe(1)
      expect(lead.valorTotalCentavos).toBe(9990)
      expect(await prisma.leadOrigem.count({ where: { leadId: lead.id } })).toBe(3)
    },
    30_000,
  )

  it(
    'rodar a carga duas vezes produz exatamente o mesmo estado',
    async () => {
      const pessoa = pessoaUnica()
      await registrarPedido(perfilId, {
        externalId: `carga-dupla-${pessoa.telefone}`,
        status: 'PAGO',
        clienteNome: 'Pessoa Dupla',
        clienteFone: pessoa.telefone,
        valorCentavos: 5000,
      })
      await emitirPara(pessoa)
      await prisma.lead.deleteMany({})

      await carregarLeads()
      const leadsAntes = await prisma.lead.count()
      const origensAntes = await prisma.leadOrigem.count()
      const antes = await prisma.lead.findFirstOrThrow({
        where: { telefoneNormalizado: pessoa.telefone },
      })

      const segunda = await carregarLeads()

      // A trava de duplicata em LeadOrigem recusa a aparição já registrada:
      // nenhuma linha nova, nenhum total somado de novo.
      expect(segunda.falhas).toBe(0)
      expect(await prisma.lead.count()).toBe(leadsAntes)
      expect(await prisma.leadOrigem.count()).toBe(origensAntes)
      const depois = await prisma.lead.findFirstOrThrow({
        where: { telefoneNormalizado: pessoa.telefone },
      })
      expect(depois.id).toBe(antes.id)
      expect(depois.totalPedidos).toBe(antes.totalPedidos)
      expect(depois.totalEnvios).toBe(antes.totalEnvios)
      expect(depois.valorTotalCentavos).toBe(antes.valorTotalCentavos)
    },
    30_000,
  )

  it(
    'pedido pago e depois cancelado: carga e fluxo ao vivo chegam ao mesmo lead',
    async () => {
      const pessoa = pessoaUnica()
      const externalId = `carga-cancelado-${pessoa.telefone}`
      const pedido = {
        externalId,
        clienteNome: 'Pessoa Cancelada',
        clienteFone: pessoa.telefone,
        valorCentavos: 7700,
      }
      await registrarPedido(perfilId, { ...pedido, status: 'PAGO' })
      await registrarPedido(perfilId, { ...pedido, status: 'CANCELADO' })

      const aoVivo = await prisma.lead.findFirstOrThrow({
        where: { telefoneNormalizado: pessoa.telefone },
      })

      await prisma.lead.deleteMany({})
      const resultado = await carregarLeads()
      expect(resultado.falhas).toBe(0)

      const carga = await prisma.lead.findFirstOrThrow({
        where: { telefoneNormalizado: pessoa.telefone },
      })
      expect(carga.valorTotalCentavos).toBe(aoVivo.valorTotalCentavos)
      expect(carga.totalPedidos).toBe(aoVivo.totalPedidos)
      expect(carga.ultimoContatoEm.toISOString()).toBe(aoVivo.ultimoContatoEm.toISOString())
    },
    30_000,
  )

  it(
    'não cria lead a partir de envio sandbox',
    async () => {
      const pessoa = pessoaUnica()
      await emitirPara(pessoa, true)
      await prisma.lead.deleteMany({})

      await carregarLeads()

      expect(await prisma.lead.count({ where: { telefoneNormalizado: pessoa.telefone } })).toBe(0)
    },
    30_000,
  )

  it(
    'conta as falhas em vez de engoli-las quando falta o segredo da impressão digital',
    async () => {
      /*
        O defeito que motivou reescrever esta tarefa: sem o segredo, cada
        aparição com CPF falhava e era pulada, e a carga terminava parecendo
        completa. Quem opera precisa saber que ela ficou incompleta.
      */
      const pessoa = pessoaUnica()
      await emitirPara(pessoa)
      await prisma.lead.deleteMany({})

      const segredo = process.env.LEAD_FINGERPRINT_KEY
      delete process.env.LEAD_FINGERPRINT_KEY

      try {
        const resultado = await carregarLeads()
        expect(resultado.falhas).toBeGreaterThan(0)
      } finally {
        if (segredo === undefined) delete process.env.LEAD_FINGERPRINT_KEY
        else process.env.LEAD_FINGERPRINT_KEY = segredo
      }
    },
    30_000,
  )
})

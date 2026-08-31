import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { listarEnviosAdmin, listarServicosParaFiltro } from './consulta-envios'

const usuariosCriados: string[] = []
const enviosCriados: string[] = []

const remetente: EnderecoEnvio = {
  nome: 'Remetente Consulta',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Ana Destinatária',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

let clienteId = ''
let clienteEmail = ''
let envioPendente = ''
let envioCancelado = ''

beforeAll(async () => {
  const cliente = await criarUsuarioComSaldo(0)
  usuariosCriados.push(cliente.id)
  clienteId = cliente.id
  clienteEmail = cliente.email

  const cotacao = await criarCotacaoValida(cliente.id)

  const criar = async () => {
    const envio = await criarEnvio(cliente.id, {
      quoteId: cotacao.id,
      servicoId: 'eco',
      remetente,
      destinatario,
      produtos: [{ nome: 'Caneca', quantidade: 1, valorUnitarioCentavos: 3000 }],
    })
    enviosCriados.push(envio.id)
    return envio.id
  }

  envioPendente = await criar()
  envioCancelado = await criar()

  await prisma.shipment.update({
    where: { id: envioCancelado },
    data: { status: 'CANCELLED', canceladoEm: new Date(), codigoRastreio: 'AA123456789BR' },
  })
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { id: { in: enviosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('listarEnviosAdmin', () => {
  it('encontra o envio pelo e-mail do dono, com nome do cliente e destino resolvidos', async () => {
    const lista = await listarEnviosAdmin({ busca: clienteEmail })

    expect(lista.total).toBe(2)
    const item = lista.itens.find((envio) => envio.id === envioPendente)
    expect(item).toMatchObject({
      clienteId,
      destinatarioNome: 'Ana Destinatária',
      destinoCidadeUf: 'Rio de Janeiro/RJ',
      status: 'PENDING',
    })
    expect(item?.servicoNome).toBeTruthy()
  })

  it('encontra o envio pelo código de rastreio', async () => {
    const lista = await listarEnviosAdmin({ busca: 'AA123456789BR' })

    expect(lista.itens.map((envio) => envio.id)).toEqual([envioCancelado])
  })

  it('filtra por status sem alterar as contagens das outras situações', async () => {
    const lista = await listarEnviosAdmin({ busca: clienteEmail, status: 'CANCELLED' })

    expect(lista.itens.map((envio) => envio.id)).toEqual([envioCancelado])
    // O recorte tem 1 pendente e 1 cancelado, e ambos continuam contados
    // mesmo com a aba "cancelados" aberta.
    expect(lista.porStatus.CANCELLED).toBe(1)
    expect(lista.porStatus.PENDING).toBe(1)
  })

  it('filtra por período, excluindo o que está fora da janela', async () => {
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const depoisDeAmanha = new Date(Date.now() + 48 * 60 * 60 * 1000)

    const vazia = await listarEnviosAdmin({ busca: clienteEmail, de: amanha, ate: depoisDeAmanha })
    expect(vazia.total).toBe(0)

    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const cheia = await listarEnviosAdmin({ busca: clienteEmail, de: ontem })
    expect(cheia.total).toBe(2)
  })

  it('pagina do mais recente para o mais antigo', async () => {
    const primeira = await listarEnviosAdmin({ busca: clienteEmail, pagina: 1 })
    expect(primeira.pagina).toBe(1)
    expect(primeira.totalPaginas).toBe(1)

    const datas = primeira.itens.map((envio) => envio.criadoEm.getTime())
    expect([...datas].sort((a, b) => b - a)).toEqual(datas)
  })
})

describe('listarServicosParaFiltro', () => {
  it('devolve apenas serviços ativos', async () => {
    const servicos = await listarServicosParaFiltro()
    expect(servicos.length).toBeGreaterThan(0)

    const inativos = await prisma.service.count({
      where: { ativo: false, id: { in: servicos.map((servico) => servico.id) } },
    })
    expect(inativos).toBe(0)
  })
})

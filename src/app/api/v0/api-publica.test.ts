import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarToken } from '@/server/api-token-service'
import { limparCotas } from '@/server/rate-limit'
import { POST as CALCULATOR } from './calculator/route'
import { POST as CART } from './cart/route'
import { POST as CHECKOUT } from './checkout/route'
import { GET as ORDER_INFO } from './order/info/[id]/route'

const usuariosCriados: string[] = []

afterEach(() => {
  limparCotas()
})

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.webhookDelivery.deleteMany({ where: { webhookApp: { userId: { in: usuariosCriados } } } })
  await prisma.webhookApp.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.apiToken.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

let catalogoSeedado = false

async function garantirCatalogo(): Promise<void> {
  if (catalogoSeedado) return
  // Garante que o catálogo ('eco') existe para a cotação real do
  // calculator, independente da ordem de execução dos arquivos de teste.
  // Usa uma conta própria e descartável — não a do teste — para não sujar
  // a contagem de `Quote` do usuário que o teste está verificando.
  const semeador = await criarUsuarioComSaldo(0)
  usuariosCriados.push(semeador.id)
  await criarCotacaoValida(semeador.id)
  catalogoSeedado = true
}

async function criarUsuarioDeTeste(saldoCentavos: number) {
  await garantirCatalogo()
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  return user
}

function req(url: string, token: string | null, body?: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function reqGet(url: string, token: string | null): NextRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${url}`, { method: 'GET', headers })
}

const corpoCotacao = {
  cepOrigem: '01310-100',
  cepDestino: '20040-020',
  formato: 'CAIXA' as const,
  pesoRealG: 1000,
  alturaCm: 10,
  larguraCm: 10,
  comprimentoCm: 10,
}

const remetente = {
  nome: 'Fulano de Tal',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario = {
  nome: 'Ciclano de Tal',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

const produtos = [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 3000 }]

async function cotarEMontarCarrinho(tokenClaro: string, extra?: Record<string, unknown>) {
  const respCalc = await CALCULATOR(req('/api/v0/calculator', tokenClaro, corpoCotacao))
  expect(respCalc.status).toBe(200)
  const opcoes = (await respCalc.json()) as { id: string; price: string }[]
  expect(opcoes.length).toBeGreaterThan(0)
  const primeiraOpcao = opcoes[0]
  if (!primeiraOpcao) {
    throw new Error('Nenhuma opção de cotação disponível para o teste.')
  }

  const respCart = await CART(
    req('/api/v0/cart', tokenClaro, {
      service: primeiraOpcao.id,
      remetente,
      destinatario,
      produtos,
      ...extra,
    }),
  )
  return { respCart, precoQuotado: primeiraOpcao.price }
}

describe('API pública /api/v0', () => {
  it('token de produção: cota, cria e paga o envio, debitando o saldo exatamente o valor da cotação', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const { tokenClaro } = await criarToken(user.id, 'Loja prod', 'PRODUCAO')

    const { respCart } = await cotarEMontarCarrinho(tokenClaro)
    expect(respCart.status).toBe(201)
    const carrinho = (await respCart.json()) as {
      id: string
      price: string
      label_fee: string
      status: string
    }

    // O que sai da carteira é a taxa por etiqueta, não o frete. São dois
    // números com donos diferentes: o frete é o que o comprador do lojista
    // paga a ele; a taxa é o que o lojista paga à plataforma.
    expect(carrinho.label_fee).toBe('1.00')
    expect(Number(carrinho.price)).toBeGreaterThan(Number(carrinho.label_fee))

    const walletAntes = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })

    const respCheckout = await CHECKOUT(
      req('/api/v0/checkout', tokenClaro, { orders: [carrinho.id] }),
    )
    expect(respCheckout.status).toBe(200)

    const walletDepois = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    const taxaCentavos = Math.round(Number(carrinho.label_fee) * 100)

    expect(walletAntes.saldoCentavos - walletDepois.saldoCentavos).toBe(taxaCentavos)

    const info = await ORDER_INFO(
      reqGet(`/api/v0/order/info/${carrinho.id}`, tokenClaro),
      { params: Promise.resolve({ id: carrinho.id }) },
    )
    expect(info.status).toBe(200)
    const corpoInfo = (await info.json()) as {
      status: string
      tracking: string | null
      price: string
      label_fee: string
    }

    // O detalhe do envio precisa carregar os dois: sem o frete, quem integra
    // não tem o valor do transporte para mostrar ao comprador dele.
    expect(corpoInfo.price).toBe(carrinho.price)
    expect(corpoInfo.label_fee).toBe('1.00')
    expect(['RELEASED', 'GENERATED']).toContain(corpoInfo.status)
  })

  it('token de sandbox: cria e paga sem debitar nada da carteira real', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const { tokenClaro } = await criarToken(user.id, 'Loja sandbox', 'SANDBOX')

    const walletAntes = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })

    const { respCart } = await cotarEMontarCarrinho(tokenClaro)
    expect(respCart.status).toBe(201)
    const carrinho = (await respCart.json()) as { id: string }

    const respCheckout = await CHECKOUT(
      req('/api/v0/checkout', tokenClaro, { orders: [carrinho.id] }),
    )
    expect(respCheckout.status).toBe(200)

    const walletDepois = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(walletDepois.saldoCentavos).toBe(walletAntes.saldoCentavos)

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: carrinho.id } })
    expect(shipment.sandbox).toBe(true)
    expect(shipment.status).toBe('RELEASED')
    expect(shipment.codigoRastreio).toMatch(/^SANDBOX/)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { refTipo: 'SHIPMENT', refId: carrinho.id },
    })
    expect(lancamentos).toBe(0)
  })

  it('token revogado: 401 e nada é criado', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const criado = await criarToken(user.id, 'Loja revogada', 'PRODUCAO')
    await prisma.apiToken.update({ where: { id: criado.id }, data: { revogadoEm: new Date() } })

    const resposta = await CALCULATOR(req('/api/v0/calculator', criado.tokenClaro, corpoCotacao))
    expect(resposta.status).toBe(401)

    const quotes = await prisma.quote.count({ where: { userId: user.id } })
    expect(quotes).toBe(0)
  })

  it('token de outro lojista não enxerga envio alheio: 404', async () => {
    const dono = await criarUsuarioDeTeste(5000)
    const { tokenClaro: tokenDono } = await criarToken(dono.id, 'Loja dona', 'PRODUCAO')
    const { respCart } = await cotarEMontarCarrinho(tokenDono)
    const carrinho = (await respCart.json()) as { id: string }

    const invasor = await criarUsuarioDeTeste(5000)
    const { tokenClaro: tokenInvasor } = await criarToken(invasor.id, 'Loja invasora', 'PRODUCAO')

    const info = await ORDER_INFO(
      reqGet(`/api/v0/order/info/${carrinho.id}`, tokenInvasor),
      { params: Promise.resolve({ id: carrinho.id }) },
    )
    expect(info.status).toBe(404)

    const checkoutAlheio = await CHECKOUT(
      req('/api/v0/checkout', tokenInvasor, { orders: [carrinho.id] }),
    )
    expect(checkoutAlheio.status).toBe(404)
  })

  it('ignora price enviado no corpo — nem o frete nem a taxa vêm do cliente', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const { tokenClaro } = await criarToken(user.id, 'Loja preço', 'PRODUCAO')

    const { respCart } = await cotarEMontarCarrinho(tokenClaro, { price: 1 })
    expect(respCart.status).toBe(201)
    const carrinho = (await respCart.json()) as { id: string; price: string; label_fee: string }

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: carrinho.id } })

    // O frete vem da tabela de preços, não do corpo da requisição.
    expect(salvo.precoFreteCentavos).not.toBe(1)
    expect(salvo.precoFreteCentavos).toBe(Math.round(Number(carrinho.price) * 100))

    // E o que é debitado é a taxa por etiqueta, fixa e definida por nós —
    // um cliente que manda price: 1 no corpo não muda nenhum dos dois.
    expect(salvo.precoCobradoCentavos).toBe(Math.round(Number(carrinho.label_fee) * 100))
  })

  it('devolve 429 quando o token excede o limite de requisições', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const { tokenClaro } = await criarToken(user.id, 'Loja ocupada', 'PRODUCAO')

    let ultimaResposta = 200
    for (let i = 0; i < 65; i += 1) {
      const resposta = await CALCULATOR(req('/api/v0/calculator', tokenClaro, corpoCotacao))
      ultimaResposta = resposta.status
    }

    expect(ultimaResposta).toBe(429)
  }, 20_000)
})

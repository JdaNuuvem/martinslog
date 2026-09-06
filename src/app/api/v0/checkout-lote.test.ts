import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarToken } from '@/server/api-token-service'
import { criarUsuarioComSaldo } from '@/test/factories'
import { POST as CALCULATOR } from './calculator/route'
import { POST as CART } from './cart/route'
import { POST as CHECKOUT } from './checkout/route'

/**
 * O que acontece com um LOTE de envios quando um deles não pode ser pago.
 *
 * Antes, o primeiro erro derrubava a chamada inteira: com `orders: [A, B]`, A
 * era debitado e ganhava etiqueta, B faltava saldo, e a resposta era um 402
 * sem `orders` nenhum — o integrador não tinha como saber que A foi pago.
 * Repetir o mesmo corpo era pior ainda: A já estava `RELEASED`, a transição
 * era recusada, e o lote inteiro voltava 422. B nunca era pago, e A ficava
 * pago em segredo.
 *
 * O que estes testes fixam é a resposta a três perguntas: o que aconteceu com
 * CADA envio, repetir é seguro, e quem lia a resposta antiga continua lendo
 * certo.
 */

const criados: string[] = []

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: criados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: criados } } })
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: criados } } } })
  await prisma.apiToken.deleteMany({ where: { userId: { in: criados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: criados } } })
  await prisma.user.deleteMany({ where: { id: { in: criados } } })
})

function req(url: string, token: string, corpo: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(corpo),
  })
}

const ENDERECO = {
  nome: 'Compradora Teste',
  cep: '20040002',
  logradouro: 'Avenida Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

const REMETENTE = { ...ENDERECO, nome: 'Loja Teste', cep: '01001000', cidade: 'São Paulo', uf: 'SP' }

async function criarCarrinho(token: string): Promise<string> {
  const respCota = await CALCULATOR(
    req('/api/v0/calculator', token, {
      cepOrigem: '01001000',
      cepDestino: '20040002',
      formato: 'CAIXA',
      pesoRealG: 500,
      alturaCm: 5,
      larguraCm: 15,
      comprimentoCm: 20,
    }),
  )
  const opcoes = (await respCota.json()) as { id: string }[]

  const respCart = await CART(
    req('/api/v0/cart', token, {
      service: opcoes[0]!.id,
      remetente: REMETENTE,
      destinatario: ENDERECO,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 5000 }],
    }),
  )
  return ((await respCart.json()) as { id: string }).id
}

describe('POST /api/v0/checkout — lote', () => {
  it('paga o que dá e diz, envio por envio, o que aconteceu com o resto', async () => {
    /*
      Saldo para UMA etiqueta e dois envios no lote. O desfecho certo não é
      "tudo ou nada": é pagar o primeiro e dizer com todas as letras que o
      segundo ficou de fora, e por quê.
    */
    const user = await criarUsuarioComSaldo(100)
    criados.push(user.id)
    const { tokenClaro } = await criarToken(user.id, 'Loja lote', 'PRODUCAO')

    const a = await criarCarrinho(tokenClaro)
    const b = await criarCarrinho(tokenClaro)

    const resposta = await CHECKOUT(req('/api/v0/checkout', tokenClaro, { orders: [a, b] }))
    expect(resposta.status).toBe(200)

    const corpo = (await resposta.json()) as {
      purchase: {
        status: string
        orders: { id: string; result: string; error_code?: string }[]
      }
    }

    expect(corpo.purchase.status).toBe('partial')
    const porId = new Map(corpo.purchase.orders.map((o) => [o.id, o]))
    expect(porId.get(a)?.result).toBe('paid')
    expect(porId.get(b)?.result).toBe('failed')
    // O motivo vem junto: sem ele, o integrador sabe que falhou e não sabe o
    // que fazer a respeito.
    expect(porId.get(b)?.error_code).toBe('SALDO_INSUFICIENTE')
  })

  it('repetir a mesma chamada é seguro: já pago responde `already_paid`, não erro', async () => {
    const user = await criarUsuarioComSaldo(5000)
    criados.push(user.id)
    const { tokenClaro } = await criarToken(user.id, 'Loja repetida', 'PRODUCAO')
    const envio = await criarCarrinho(tokenClaro)

    const primeira = await CHECKOUT(req('/api/v0/checkout', tokenClaro, { orders: [envio] }))
    expect(primeira.status).toBe(200)

    const segunda = await CHECKOUT(req('/api/v0/checkout', tokenClaro, { orders: [envio] }))
    expect(segunda.status).toBe(200)

    const corpo = (await segunda.json()) as {
      purchase: { status: string; orders: { result: string }[] }
    }
    expect(corpo.purchase.status).toBe('approved')
    expect(corpo.purchase.orders[0]!.result).toBe('already_paid')

    // E a repetição não cobra de novo: um débito, um lançamento.
    const lancamentos = await prisma.ledgerEntry.count({
      where: { refTipo: 'SHIPMENT', refId: envio, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)
  })

  it('quando NENHUM passa, o erro continua vindo como erro', async () => {
    /*
      Compatibilidade com quem manda um envio por chamada — o caso comum, e o
      que a loja do Montador faz. Se um lote inteiramente fracassado passasse a
      responder 200, esse integrador leria sucesso e seguiria procurando uma
      etiqueta que nunca foi emitida.
    */
    const user = await criarUsuarioComSaldo(0)
    criados.push(user.id)
    const { tokenClaro } = await criarToken(user.id, 'Loja sem saldo', 'PRODUCAO')
    const envio = await criarCarrinho(tokenClaro)

    const resposta = await CHECKOUT(req('/api/v0/checkout', tokenClaro, { orders: [envio] }))
    expect(resposta.status).toBe(402)

    const corpo = (await resposta.json()) as {
      codigo: string
      purchase: { orders: { result: string }[] }
    }
    expect(corpo.codigo).toBe('SALDO_INSUFICIENTE')
    // O detalhe por envio vem junto mesmo no erro: num lote, saber QUAL falhou
    // é a diferença entre corrigir e adivinhar.
    expect(corpo.purchase.orders[0]!.result).toBe('failed')
  })

  it('envio de outra conta não vaza: responde igual a inexistente', async () => {
    const dono = await criarUsuarioComSaldo(5000)
    const invasor = await criarUsuarioComSaldo(5000)
    criados.push(dono.id, invasor.id)
    const { tokenClaro: tokenDono } = await criarToken(dono.id, 'Dono', 'PRODUCAO')
    const { tokenClaro: tokenInvasor } = await criarToken(invasor.id, 'Invasor', 'PRODUCAO')

    const envio = await criarCarrinho(tokenDono)

    const resposta = await CHECKOUT(req('/api/v0/checkout', tokenInvasor, { orders: [envio] }))
    // Nenhum passou → o erro sobe, e com o mesmo código de "não existe":
    // distinguir "não é seu" de "não existe" deixaria um token descobrir quais
    // ids existem na plataforma.
    expect(resposta.status).toBe(404)

    const corpo = (await resposta.json()) as { codigo: string }
    expect(corpo.codigo).toBe('ENVIO_NAO_ENCONTRADO')

    // E o envio do dono continua intocado.
    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: envio } })
    expect(depois.status).toBe('PENDING')
  })
})

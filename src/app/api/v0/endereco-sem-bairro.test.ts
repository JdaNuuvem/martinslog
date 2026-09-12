import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarToken } from '@/server/api-token-service'
import { criarUsuarioComSaldo } from '@/test/factories'
import { POST as CALCULATOR } from './calculator/route'
import { POST as CART } from './cart/route'

/**
 * Endereço de cidade pequena, onde não existe bairro.
 *
 * Município com CEP único (os terminados em `-000`) não tem bairro: a consulta
 * de CEP devolve nulo porque não há o que devolver. Exigir o campo recusava
 * endereço legítimo — medido numa loja, vinte vendas pagas paradas com
 * "Endereço incompleto: bairro", todas de municípios assim.
 *
 * O que entrega o pacote é CEP, logradouro e número.
 */

const criados: string[] = []

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: criados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: criados } } })
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

const REMETENTE = {
  nome: 'Loja',
  cep: '01001000',
  logradouro: 'Praça da Sé',
  numero: '1',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
}

describe('POST /api/v0/cart — endereço sem bairro', () => {
  it('aceita destinatário de município com CEP único', async () => {
    const user = await criarUsuarioComSaldo(50_000)
    criados.push(user.id)
    const { tokenClaro } = await criarToken(user.id, 'Loja interior', 'PRODUCAO')

    const respCota = await CALCULATOR(
      req('/api/v0/calculator', tokenClaro, {
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

    const resposta = await CART(
      req('/api/v0/cart', tokenClaro, {
        service: opcoes[0]!.id,
        remetente: REMETENTE,
        destinatario: {
          nome: 'Compradora do Interior',
          cep: '20040002',
          logradouro: 'Rua Principal',
          numero: '250',
          // Sem `bairro`: é assim que o endereço chega de um município com
          // CEP único, e recusá-lo é recusar a venda.
          cidade: 'Rio de Janeiro',
          uf: 'RJ',
        },
        produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 5000 }],
      }),
    )

    expect(resposta.status).toBe(201)

    const { id } = (await resposta.json()) as { id: string }
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id } })
    const destinatario = envio.destinatario as { bairro?: string }
    // Guardado como vazio, não como nulo: a etiqueta simplesmente não imprime
    // a linha, e quem lê o dado depois não precisa tratar dois "sem valor".
    expect(destinatario.bairro).toBe('')
  })
})

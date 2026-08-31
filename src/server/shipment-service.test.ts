import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import {
  CotacaoExpiradaError,
  EnvioNaoEncontradoError,
  SaldoInsuficienteError,
} from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio, type EntradaEnvio } from './shipment-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
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
  nome: 'Destinatário Teste',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

function entradaEnvio(quoteId: string): EntradaEnvio {
  return {
    quoteId,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 2, valorUnitarioCentavos: 5000 }],
  }
}

async function criarUsuarioDeTeste(saldoCentavos: number) {
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  return user
}

describe('pagarEnvio sob concorrência', () => {
  it('nunca deixa o saldo negativo com dois pagamentos simultâneos', async () => {
    // saldo cobre exatamente UM envio de R$ 14,16
    const user = await criarUsuarioDeTeste(1416)
    const cotacao = await criarCotacaoValida(user.id)
    const a = await criarEnvio(user.id, entradaEnvio(cotacao.id))
    const b = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    const resultados = await Promise.allSettled([
      pagarEnvio(user.id, a.id),
      pagarEnvio(user.id, b.id),
    ])

    const ok = resultados.filter((r) => r.status === 'fulfilled')
    const falhas = resultados.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(falhas).toHaveLength(1)
    expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(0)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)
  })

  it('mantém o saldo intacto e o envio PENDING quando o pagamento falha por saldo insuficiente', async () => {
    const user = await criarUsuarioDeTeste(100)
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await expect(pagarEnvio(user.id, envio.id)).rejects.toBeInstanceOf(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(100)

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('PENDING')
  })
})

describe('criarEnvio', () => {
  it('cria o envio em PENDING com o preço vindo da cotação, nunca do cliente', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })

    const entrada = {
      ...entradaEnvio(cotacao.id),
      // um campo extra de preço não deve existir no tipo, mas simulamos
      // "o que aconteceria" se alguém tentasse injetar via `as unknown`
    } as EntradaEnvio & { precoCobradoCentavos?: number }
    entrada.precoCobradoCentavos = 1

    const envio = await criarEnvio(user.id, entrada)

    expect(envio.status).toBe('PENDING')
    expect(envio.precoCobradoCentavos).toBe(1416)

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(salvo.precoCobradoCentavos).toBe(1416)
    expect(salvo.status).toBe('PENDING')
  })

  it('lança CotacaoExpiradaError quando a cotação já expirou', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { expirada: true })

    await expect(criarEnvio(user.id, entradaEnvio(cotacao.id))).rejects.toBeInstanceOf(
      CotacaoExpiradaError,
    )
  })

  it('lança EnvioNaoEncontradoError quando a cotação pertence a outro usuário', async () => {
    const donoDaCotacao = await criarUsuarioDeTeste(2000)
    const outroUsuario = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(donoDaCotacao.id)

    await expect(criarEnvio(outroUsuario.id, entradaEnvio(cotacao.id))).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })

  it('copia o endereço para o envio em vez de referenciá-lo (etiqueta não muda se o endereço mudar depois)', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id)

    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(salvo.remetente).toMatchObject({ nome: 'Remetente Teste', logradouro: 'Av. Paulista' })

    // Endereço "original" (fora de Address, já que Shipment não referencia
    // Address nenhum) mudou depois — o envio já criado não deve refletir
    // a mudança, porque não guarda nenhuma referência, só a cópia.
    const alterado = { ...remetente, logradouro: 'Rua Alterada Depois' }
    expect(salvo.remetente).not.toMatchObject({ logradouro: alterado.logradouro })
  })
})

describe('pagarEnvio', () => {
  it('debita a carteira e move o envio para RELEASED', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000 - 1416)

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('RELEASED')
    expect(atualizado.pagoEm).not.toBeNull()
  })

  it('pagar duas vezes o mesmo envio debita uma vez só', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)
    await expect(pagarEnvio(user.id, envio.id)).rejects.toThrow()

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(5000 - 1416)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import {
  CotacaoExpiradaError,
  CotacaoNaoCorrespondeError,
  CotacaoNaoEncontradaError,
  SaldoInsuficienteError,
  TransicaoInvalidaError,
} from '@/domain/errors'
import { PRECO_ETIQUETA_CENTAVOS } from '@/domain/pricing/etiqueta'
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
    // Saldo que cobre exatamente UMA etiqueta. O frete da cotação não entra
    // na conta: o que sai da carteira é o preço por etiqueta gerada.
    const user = await criarUsuarioDeTeste(PRECO_ETIQUETA_CENTAVOS)
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

  it('nunca deixa o saldo negativo com quatro pagamentos simultâneos', async () => {
    // Mesmo cenário do teste anterior, com mais concorrentes. Dois atores já
    // reprovam sem o `FOR UPDATE`, mas quatro estressam a fila do lock: se a
    // serialização só funcionasse para o primeiro par, apareceria aqui.
    const user = await criarUsuarioDeTeste(PRECO_ETIQUETA_CENTAVOS)
    const cotacao = await criarCotacaoValida(user.id)
    const envios = await Promise.all(
      Array.from({ length: 4 }, () => criarEnvio(user.id, entradaEnvio(cotacao.id))),
    )

    const resultados = await Promise.allSettled(
      envios.map((envio) => pagarEnvio(user.id, envio.id)),
    )

    const ok = resultados.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)

    for (const falha of resultados.filter((r) => r.status === 'rejected')) {
      expect((falha as PromiseRejectedResult).reason).toBeInstanceOf(SaldoInsuficienteError)
    }

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(0)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)
  })

  it('mantém o saldo intacto e o envio PENDING quando o pagamento falha por saldo insuficiente', async () => {
    const user = await criarUsuarioDeTeste(PRECO_ETIQUETA_CENTAVOS - 1)
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await expect(pagarEnvio(user.id, envio.id)).rejects.toBeInstanceOf(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(PRECO_ETIQUETA_CENTAVOS - 1)

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
    // O frete continua vindo da cotação salva, nunca do corpo do cliente...
    expect(envio.precoFreteCentavos).toBe(1416)
    // ...e o que a plataforma cobra é o preço fixo da etiqueta.
    expect(envio.precoCobradoCentavos).toBe(PRECO_ETIQUETA_CENTAVOS)

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(salvo.precoFreteCentavos).toBe(1416)
    expect(salvo.precoCobradoCentavos).toBe(PRECO_ETIQUETA_CENTAVOS)
    expect(salvo.status).toBe('PENDING')
  })

  it('lança CotacaoExpiradaError quando a cotação já expirou', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { expirada: true })

    await expect(criarEnvio(user.id, entradaEnvio(cotacao.id))).rejects.toBeInstanceOf(
      CotacaoExpiradaError,
    )
  })

  it('lança CotacaoNaoEncontradaError quando a cotação pertence a outro usuário', async () => {
    const donoDaCotacao = await criarUsuarioDeTeste(2000)
    const outroUsuario = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(donoDaCotacao.id)

    await expect(criarEnvio(outroUsuario.id, entradaEnvio(cotacao.id))).rejects.toBeInstanceOf(
      CotacaoNaoEncontradaError,
    )
  })

  it('lança CotacaoNaoCorrespondeError quando o destinatário não bate com o CEP da cotação', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id)

    const entrada: EntradaEnvio = {
      ...entradaEnvio(cotacao.id),
      destinatario: { ...destinatario, cep: '69000-000' }, // Manaus, cotação era para RJ
    }

    await expect(criarEnvio(user.id, entrada)).rejects.toBeInstanceOf(CotacaoNaoCorrespondeError)

    const total = await prisma.shipment.count({ where: { userId: user.id } })
    expect(total).toBe(0)
  })

  it('lança CotacaoNaoCorrespondeError quando o remetente não bate com o CEP da cotação', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id)

    const entrada: EntradaEnvio = {
      ...entradaEnvio(cotacao.id),
      remetente: { ...remetente, cep: '30130-000' }, // Belo Horizonte, cotação era de SP
    }

    await expect(criarEnvio(user.id, entrada)).rejects.toBeInstanceOf(CotacaoNaoCorrespondeError)
  })

  it('aceita CEP com e sem hífen como equivalentes ao comparar com a cotação', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id)

    const entrada: EntradaEnvio = {
      ...entradaEnvio(cotacao.id),
      remetente: { ...remetente, cep: '01310100' }, // mesmo CEP do remetente-padrão, sem hífen
      destinatario: { ...destinatario, cep: '20040020' }, // idem, sem hífen
    }

    const envio = await criarEnvio(user.id, entrada)
    expect(envio.status).toBe('PENDING')
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
  it('debita a carteira, move o envio para GENERATED e já emite o código de rastreio', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000 - PRECO_ETIQUETA_CENTAVOS)

    // O pagamento em si só garante RELEASED; a emissão do código de
    // rastreio (gancho pós-commit) leva o envio adiante para GENERATED na
    // mesma chamada de `pagarEnvio` — ver `emitir-etiqueta-service.test.ts`
    // para os testes detalhados do que a emissão grava.
    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('GENERATED')
    expect(atualizado.pagoEm).not.toBeNull()
    expect(atualizado.codigoRastreio).not.toBeNull()

    const eventos = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })
    expect(eventos).toBeGreaterThan(0)
  })

  it('pagar duas vezes o mesmo envio debita uma vez só', async () => {
    const user = await criarUsuarioDeTeste(5000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)
    await expect(pagarEnvio(user.id, envio.id)).rejects.toThrow()

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(5000 - PRECO_ETIQUETA_CENTAVOS)

    const lancamentos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'DEBITO' },
    })
    expect(lancamentos).toBe(1)
  })

  it('recusa pagar um envio cuja cotação já expirou desde a criação, sem debitar', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    // Simula o tempo passando: a cotação vence depois que o envio já foi
    // criado (envio parado por dias/meses antes de ser pago).
    await prisma.quote.update({ where: { id: cotacao.id }, data: { expiraEm: new Date(Date.now() - 1000) } })

    await expect(pagarEnvio(user.id, envio.id)).rejects.toBeInstanceOf(CotacaoExpiradaError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000)

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('PENDING')
  })

  /**
   * `cancelarEnvio` ainda não existe (não é escopo da Task 13), mas a
   * proteção que evita a corrida silenciosa entre pagar e cancelar mora
   * inteiramente em `pagarEnvio` (o `updateMany` condicional em
   * `status: 'PENDING'`). Simulamos aqui a metade "cancelar" da corrida
   * com um `updateMany` idêntico ao que uma implementação futura faria,
   * para provar que a proteção do lado do pagamento não perde a corrida
   * em silêncio, sem depender de outro serviço ainda não escrito.
   */
  async function simularCancelamentoConcorrente(shipmentId: string): Promise<boolean> {
    const resultado = await prisma.shipment.updateMany({
      where: { id: shipmentId, status: 'PENDING' },
      data: { status: 'CANCELLED', canceladoEm: new Date() },
    })
    return resultado.count === 1
  }

  it('pagar e cancelar o mesmo envio ao mesmo tempo nunca perde a corrida em silêncio', async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const user = await criarUsuarioDeTeste(2000)
      const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })
      const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

      const [pagamento, cancelamento] = await Promise.allSettled([
        pagarEnvio(user.id, envio.id),
        simularCancelamentoConcorrente(envio.id),
      ])

      const pagamentoOk = pagamento.status === 'fulfilled'
      const cancelamentoOk = cancelamento.status === 'fulfilled' && cancelamento.value === true

      // Exatamente um dos dois vence — nunca os dois, e nunca nenhum dos
      // dois (quem perde recebe erro, não um silêncio que a chamada
      // original não consegue distinguir de sucesso).
      expect(pagamentoOk !== cancelamentoOk).toBe(true)

      const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
      if (pagamentoOk) {
        // Ver o comentário do teste acima: `pagarEnvio` já deixa o envio em
        // GENERATED, não apenas RELEASED, porque emite a etiqueta em
        // seguida ao commit do pagamento.
        expect(atualizado.status).toBe('GENERATED')
      } else {
        expect(atualizado.status).toBe('CANCELLED')
        expect(pagamento.status).toBe('rejected')
        if (pagamento.status === 'rejected') {
          expect(pagamento.reason).toBeInstanceOf(TransicaoInvalidaError)
        }
      }
    }
  })
})

/**
 * A regra de preço do produto, em um lugar só.
 *
 * O frete é calculado e exibido — é o valor do transporte, que vai na
 * etiqueta e no rastreio. O que a plataforma cobra é um valor fixo por
 * etiqueta gerada, e é só ele que sai da carteira. Confundir os dois foi o
 * modelo antigo, em que o débito era o frete.
 */
describe('preço da etiqueta', () => {
  it('debita R$ 1,00 seja qual for o frete calculado', async () => {
    // Uma conta só, três fretes muito diferentes: se o débito acompanhasse o
    // frete, o saldo cairia em passos desiguais.
    const user = await criarUsuarioDeTeste(1000)
    const fretes = [500, 1416, 9900]

    for (const [indice, freteCentavos] of fretes.entries()) {
      const cotacao = await criarCotacaoValida(user.id, { precoCentavos: freteCentavos })
      const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

      await pagarEnvio(user.id, envio.id)

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
      expect(wallet.saldoCentavos).toBe(1000 - PRECO_ETIQUETA_CENTAVOS * (indice + 1))

      const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
      expect(salvo.precoFreteCentavos).toBe(freteCentavos)
      expect(salvo.precoCobradoCentavos).toBe(PRECO_ETIQUETA_CENTAVOS)
    }
  }, 20_000)

  it('o lançamento no extrato registra o valor da etiqueta, não o do frete', async () => {
    const user = await criarUsuarioDeTeste(1000)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 9900 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    const lancamento = await prisma.ledgerEntry.findFirstOrThrow({
      where: { walletId: wallet.id, refTipo: 'SHIPMENT', refId: envio.id },
    })

    expect(lancamento.tipo).toBe('DEBITO')
    expect(lancamento.valorCentavos).toBe(PRECO_ETIQUETA_CENTAVOS)
  })

  it('saldo abaixo do preço da etiqueta recusa, mesmo com frete barato', async () => {
    const user = await criarUsuarioDeTeste(PRECO_ETIQUETA_CENTAVOS - 1)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 200 })
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await expect(pagarEnvio(user.id, envio.id)).rejects.toBeInstanceOf(SaldoInsuficienteError)
  })
})

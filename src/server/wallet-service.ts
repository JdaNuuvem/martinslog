import { Prisma, type LedgerEntry } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { paymentProvider } from '@/infra/payments'
import { aplicarCredito, aplicarDebito } from '@/domain/wallet/ledger'
import { PagamentoNaoEncontradoError } from '@/domain/errors'

type ReferenciaLancamento = { tipo: string; id: string }

const DESCRICAO_RECARGA = 'Recarga via Pix (simulado)'

function isViolacaoUnicidade(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Garante que o usuário tem uma `Wallet` (cria com saldo zero se ainda não
 * existir) e devolve a linha bloqueada (`SELECT ... FOR UPDATE`) dentro da
 * transação corrente. O lock serializa créditos/débitos concorrentes da
 * mesma carteira, o que evita "lost update" no saldo materializado.
 */
async function obterCarteiraBloqueada(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; saldoCentavos: number }> {
  const wallet = await tx.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  })

  const linhas = await tx.$queryRaw<{ id: string; saldoCentavos: number }[]>`
    SELECT id, "saldoCentavos" FROM wallets WHERE id = ${wallet.id} FOR UPDATE
  `

  const linha = linhas[0]
  if (!linha) {
    throw new Error(`Carteira não encontrada após upsert: ${wallet.id}`)
  }
  return linha
}

/**
 * Credita a carteira do usuário de forma atômica: o `LedgerEntry` e o
 * `Wallet.saldoCentavos` são gravados na mesma transação, com
 * `saldoAposCentavos` calculado pela função pura `aplicarCredito`.
 *
 * Idempotência: `(refTipo, refId, tipo)` tem índice único no banco.
 * Creditar duas vezes a mesma referência (ex.: confirmar o mesmo
 * `PaymentIntent` duas vezes, inclusive concorrentemente) grava o
 * `LedgerEntry` uma única vez — a segunda tentativa esbarra na violação de
 * unicidade, o que aborta a transação inteira (revertendo também a
 * atualização de saldo feita nela) e é tratado aqui como sucesso silencioso,
 * sem vazar o erro do Prisma para quem chamou.
 */
export async function creditarCarteira(
  userId: string,
  valorCentavos: number,
  ref: ReferenciaLancamento,
  descricao: string,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const carteira = await obterCarteiraBloqueada(tx, userId)
      const lancamento = aplicarCredito(carteira.saldoCentavos, valorCentavos)

      await tx.wallet.update({
        where: { id: carteira.id },
        data: { saldoCentavos: lancamento.saldoAposCentavos },
      })

      await tx.ledgerEntry.create({
        data: {
          walletId: carteira.id,
          tipo: lancamento.tipo,
          valorCentavos: lancamento.valorCentavos,
          saldoAposCentavos: lancamento.saldoAposCentavos,
          refTipo: ref.tipo,
          refId: ref.id,
          descricao,
        },
      })
    })
  } catch (error) {
    if (isViolacaoUnicidade(error)) {
      return
    }
    throw error
  }
}

/**
 * Debita a carteira do usuário de forma atômica, com as mesmas garantias de
 * atomicidade e idempotência de `creditarCarteira`. Lança
 * `SaldoInsuficienteError` (propagado, nunca engolido) quando o saldo é
 * menor que o valor a debitar.
 */
export async function debitarCarteira(
  userId: string,
  valorCentavos: number,
  ref: ReferenciaLancamento,
  descricao: string,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const carteira = await obterCarteiraBloqueada(tx, userId)
      const lancamento = aplicarDebito(carteira.saldoCentavos, valorCentavos)

      await tx.wallet.update({
        where: { id: carteira.id },
        data: { saldoCentavos: lancamento.saldoAposCentavos },
      })

      await tx.ledgerEntry.create({
        data: {
          walletId: carteira.id,
          tipo: lancamento.tipo,
          valorCentavos: lancamento.valorCentavos,
          saldoAposCentavos: lancamento.saldoAposCentavos,
          refTipo: ref.tipo,
          refId: ref.id,
          descricao,
        },
      })
    })
  } catch (error) {
    if (isViolacaoUnicidade(error)) {
      return
    }
    throw error
  }
}

/**
 * Devolve a carteira do usuário, criando-a com saldo zero se for a
 * primeira vez que ele é visto.
 */
export async function obterCarteira(userId: string): Promise<{ saldoCentavos: number }> {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  })

  return { saldoCentavos: wallet.saldoCentavos }
}

export type ExtratoPaginado = {
  itens: LedgerEntry[]
  pagina: number
  tamanhoPagina: number
  total: number
  totalPaginas: number
}

/**
 * Lista o extrato (lançamentos) da carteira do usuário, paginado e do mais
 * recente para o mais antigo.
 */
export async function listarExtrato(
  userId: string,
  pagina = 1,
  tamanhoPagina = 20,
): Promise<ExtratoPaginado> {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  })

  const paginaValida = Math.max(1, pagina)

  const [itens, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { criadoEm: 'desc' },
      skip: (paginaValida - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.ledgerEntry.count({ where: { walletId: wallet.id } }),
  ])

  return {
    itens,
    pagina: paginaValida,
    tamanhoPagina,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / tamanhoPagina)),
  }
}

export type RecargaCriada = {
  paymentIntentId: string
  qrCode: string
  expiraEm: Date
  valorCentavos: number
}

/**
 * Cria uma cobrança Pix simulada para recarregar a carteira do usuário. O
 * `PaymentIntent` fica `PENDENTE` até ser confirmado — o que NUNCA acontece
 * nesta função nem por uma rota que o próprio cliente possa chamar (ver
 * `confirmarRecarga`).
 */
export async function criarRecarga(userId: string, valorCentavos: number): Promise<RecargaCriada> {
  // Valida o valor com a mesma regra de domínio usada para creditar,
  // sem persistir nada — só para falhar cedo com `ValorInvalidoError` em
  // vez de criar uma cobrança para um valor que jamais poderia ser
  // creditado depois.
  aplicarCredito(0, valorCentavos)

  // Garante a carteira já criada antes de existir qualquer cobrança
  // pendente para ela. Isso evita que duas confirmações concorrentes do
  // mesmo intent corram para *criar* a linha de `Wallet` ao mesmo tempo
  // (INSERT×INSERT) — elas só disputam o lock de uma linha que já existe,
  // o que é rápido e não arrisca estourar o timeout da transação.
  await prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } })

  const cobranca = await paymentProvider.criarCobranca(valorCentavos)

  const intent = await prisma.paymentIntent.create({
    data: {
      userId,
      valorCentavos,
      metodo: 'PIX',
      status: 'PENDENTE',
      qrCode: cobranca.qrCode,
      expiraEm: cobranca.expiraEm,
    },
  })

  return {
    paymentIntentId: intent.id,
    qrCode: cobranca.qrCode,
    expiraEm: intent.expiraEm,
    valorCentavos,
  }
}

/**
 * Confirma uma cobrança Pix e credita a carteira do usuário dono do
 * `PaymentIntent`. Esta é a ÚNICA porta de entrada para dinheiro simulado
 * virar saldo — e propositalmente não pode ser chamada pelo cliente:
 * quem expõe esta função por HTTP (`/api/carteira/confirmar`) exige papel
 * `ADMIN` na sessão, nunca aceita o `userId` do corpo da requisição (usa
 * sempre `intent.userId`) e não existe nenhuma rota pública equivalente.
 * Sem essa trava, o próprio cliente confirmaria o próprio pagamento e
 * teria saldo grátis.
 *
 * Idempotente: confirmar o mesmo intent mais de uma vez (inclusive
 * concorrentemente) credita a carteira uma única vez, porque
 * `creditarCarteira` usa `(refTipo='PAYMENT_INTENT', refId=intent.id)`
 * como chave de idempotência.
 */
export async function confirmarRecarga(paymentIntentId: string): Promise<void> {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } })
  if (!intent) {
    throw new PagamentoNaoEncontradoError(`Cobrança não encontrada: ${paymentIntentId}`)
  }

  await creditarCarteira(
    intent.userId,
    intent.valorCentavos,
    { tipo: 'PAYMENT_INTENT', id: intent.id },
    DESCRICAO_RECARGA,
  )

  await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: 'PENDENTE' },
    data: { status: 'CONFIRMADO', confirmadoEm: new Date() },
  })
}

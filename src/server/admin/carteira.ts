import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { aplicarCredito, aplicarDebito } from '@/domain/wallet/ledger'
import { ValorInvalidoError } from '@/domain/errors'
import { obterCarteiraBloqueada } from '@/server/wallet-service'

/**
 * Ajuste manual de saldo pelo painel administrativo.
 *
 * Existe porque nem todo dinheiro entra ou sai pelo Pix simulado: cortesia,
 * estorno de um envio que deu errado, correção de um crédito indevido. Sem
 * este caminho, a alternativa seria mexer no banco à mão — sem lançamento,
 * sem histórico e sem responsável.
 *
 * Três decisões que atravessam o módulo:
 *
 * 1. **Passa pelo ledger, nunca por `UPDATE wallets SET saldo`.** O saldo é
 *    materializado a partir dos lançamentos; escrever nele por fora deixaria
 *    extrato e saldo divergentes para sempre.
 * 2. **Motivo é obrigatório.** Um lançamento "AJUSTE_ADMIN R$ 200,00" sem
 *    texto é indistinguível de erro seis meses depois, e é o cliente quem lê
 *    a descrição no próprio extrato.
 * 3. **Débito respeita o saldo.** `aplicarDebito` recusa deixar a carteira
 *    negativa, e o ajuste administrativo não abre exceção: uma carteira
 *    negativa quebraria a premissa de todo o resto do sistema (pagamento de
 *    envio só acontece com saldo).
 */

export type TipoAjuste = 'CREDITO' | 'DEBITO'

export type AjusteSaldo = {
  tipo: TipoAjuste
  valorCentavos: number
  motivo: string
}

export type ResultadoAjuste = {
  saldoAnteriorCentavos: number
  saldoAtualCentavos: number
  lancamentoId: string
}

/** Curto demais não é motivo, é ruído no extrato de quem recebeu o ajuste. */
const MOTIVO_MINIMO = 3

/**
 * Credita ou debita a carteira de um usuário por decisão administrativa.
 *
 * O `refId` é um UUID novo a cada chamada, não uma chave de idempotência:
 * dois ajustes iguais no mesmo dia são dois ajustes de verdade (duas
 * cortesias, dois estornos) e precisam aparecer os dois no extrato. Quem
 * dispara em duplicidade por engano corrige com o ajuste inverso — que
 * também fica registrado, e é isso que se quer de um livro-caixa.
 *
 * Lança `SaldoInsuficienteError` no débito acima do saldo e
 * `ValorInvalidoError` para valor não inteiro/positivo ou motivo vazio.
 */
export async function ajustarSaldo(
  actorUserId: string,
  userId: string,
  ajuste: AjusteSaldo,
): Promise<ResultadoAjuste> {
  const motivo = ajuste.motivo.trim()
  if (motivo.length < MOTIVO_MINIMO) {
    throw new ValorInvalidoError('Informe o motivo do ajuste de saldo.')
  }

  return prisma.$transaction(async (tx) => {
    const carteira = await obterCarteiraBloqueada(tx, userId)

    const lancamento =
      ajuste.tipo === 'CREDITO'
        ? aplicarCredito(carteira.saldoCentavos, ajuste.valorCentavos)
        : aplicarDebito(carteira.saldoCentavos, ajuste.valorCentavos)

    await tx.wallet.update({
      where: { id: carteira.id },
      data: { saldoCentavos: lancamento.saldoAposCentavos },
    })

    const entrada = await tx.ledgerEntry.create({
      data: {
        walletId: carteira.id,
        tipo: lancamento.tipo,
        valorCentavos: lancamento.valorCentavos,
        saldoAposCentavos: lancamento.saldoAposCentavos,
        refTipo: 'AJUSTE_ADMIN',
        refId: randomUUID(),
        // O cliente lê esta linha no próprio extrato: o texto diz que a
        // origem é a plataforma, e o motivo digitado vem junto.
        descricao: `Ajuste administrativo — ${motivo}`,
      },
    })

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: ajuste.tipo === 'CREDITO' ? 'SALDO_CREDITADO' : 'SALDO_DEBITADO',
        entidade: 'Wallet',
        entidadeId: carteira.id,
        antes: { saldoCentavos: carteira.saldoCentavos } as Prisma.InputJsonValue,
        depois: {
          saldoCentavos: lancamento.saldoAposCentavos,
          valorCentavos: lancamento.valorCentavos,
          userId,
          motivo,
          ledgerEntryId: entrada.id,
        } as Prisma.InputJsonValue,
      },
    })

    return {
      saldoAnteriorCentavos: carteira.saldoCentavos,
      saldoAtualCentavos: lancamento.saldoAposCentavos,
      lancamentoId: entrada.id,
    }
  })
}

import { randomUUID } from 'crypto'
import type { CobrancaPix, PaymentProvider } from './provider'

const EXPIRACAO_MS = 30 * 60 * 1000 // 30 minutos

/**
 * Provedor Pix simulado: nenhum dinheiro real é movimentado. O
 * `qrCode` gerado carrega um marcador textual explícito de simulação
 * (`SIMULADO-NAO-PAGAR`) para que nunca seja confundido com um QR Pix
 * real por quem o vir — um QR falso indistinguível de um verdadeiro é
 * uma armadilha (alguém tentaria escaneá-lo e pagar de verdade).
 *
 * A confirmação do pagamento NÃO acontece aqui: este provedor só cria a
 * cobrança. A confirmação é uma ação administrativa separada, feita pelo
 * `wallet-service` — nunca pelo próprio cliente.
 */
export class SimulatedPixProvider implements PaymentProvider {
  async criarCobranca(valorCentavos: number): Promise<CobrancaPix> {
    const id = randomUUID()
    const valorReais = (valorCentavos / 100).toFixed(2)
    const qrCode = `SIMULADO-NAO-PAGAR|id=${id}|valor=${valorReais}|ambiente=teste`

    return {
      id,
      qrCode,
      expiraEm: new Date(Date.now() + EXPIRACAO_MS),
    }
  }
}

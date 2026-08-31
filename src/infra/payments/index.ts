import { SimulatedPixProvider } from './simulado'
import type { PaymentProvider } from './provider'

/**
 * Composição do provedor de pagamento ativo — hoje sempre o simulado
 * (Task 11 só entrega recarga simulada). Quando um provedor Pix real
 * existir, a escolha entra aqui, no mesmo padrão de `src/infra/geo/index.ts`.
 */
const paymentProvider: PaymentProvider = new SimulatedPixProvider()

export type { PaymentProvider, CobrancaPix } from './provider'
export { SimulatedPixProvider } from './simulado'
export { paymentProvider }

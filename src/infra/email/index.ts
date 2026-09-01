import { FakeEmailProvider } from './fake'
import type { EmailProvider } from './provider'
import { ResendProvider } from './resend'

/**
 * Provedor ativo. Em teste é sempre o falso — nenhuma suíte deve mandar
 * e-mail de verdade nem depender de rede.
 */
export const emailProvider: EmailProvider =
  process.env.NODE_ENV === 'test' ? new FakeEmailProvider() : new ResendProvider()

export type { EmailProvider, EmailParaEnviar, ResultadoEnvio } from './provider'
export { ResendProvider } from './resend'
export { FakeEmailProvider } from './fake'

import type { ProvedorWhatsapp } from '@prisma/client'
import { env } from '@/env'
import { EvolutionProvider } from './evolution'
import { MetaProvider } from './meta'
import type { WhatsappProvider } from './provider'

/**
 * Quem fala com o WhatsApp, por provedor.
 *
 * Instâncias únicas: nenhum dos dois guarda estado entre chamadas — as
 * credenciais chegam a cada envio, porque são da loja, não do processo.
 */
const PROVEDORES: Record<ProvedorWhatsapp, WhatsappProvider> = {
  META: new MetaProvider(),
  EVOLUTION: new EvolutionProvider(),
}

export function whatsappProvider(provedor: ProvedorWhatsapp): WhatsappProvider {
  return PROVEDORES[provedor]
}

/**
 * A Evolution está instalada neste servidor?
 *
 * Sem URL ou sem chave o canal não existe, e é melhor a tela dizer isso do que
 * a loja parear um celular para as mensagens morrerem na fila — que foi
 * exatamente o que aconteceu com o SMS antes de `SMS_PROVEDOR` existir.
 */
export function evolutionDisponivel(): boolean {
  return Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY)
}

/** URL e chave da Evolution, ou nulo quando ela não está configurada. */
export function credenciaisDoServidor(): { baseUrl: string; apiKey: string } | null {
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) return null
  return { baseUrl: env.EVOLUTION_API_URL, apiKey: env.EVOLUTION_API_KEY }
}

export { EvolutionProvider } from './evolution'
export { MetaProvider } from './meta'
export type {
  CredenciaisWhatsapp,
  MensagemWhatsapp,
  WhatsappProvider,
  ResultadoEnvio,
  ParametroTemplate,
} from './provider'

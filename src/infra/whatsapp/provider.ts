import type { ParametroTemplate, ResultadoEnvio } from './cloud-api'

/**
 * Contrato comum aos provedores de WhatsApp.
 *
 * Existe porque a oficial da Meta e a Evolution resolvem o mesmo problema com
 * compromissos opostos, e a loja escolhe qual quer pagar:
 *
 * - META cobra por conversa, exige verificação da empresa e só deixa INICIAR
 *   conversa com template aprovado por eles. Em troca, o número não é banido
 *   por mandar mensagem.
 * - EVOLUTION fala o protocolo do WhatsApp Web de um celular pareado. Não tem
 *   template, verificação nem custo por mensagem — e por isso mesmo a Meta
 *   pode banir o número, que é o risco que vem junto.
 *
 * O resto do sistema não sabe qual está ativo. É para isso que a interface
 * existe: a fila, o histórico e a régua de recuperação continuam iguais.
 */

export type CredenciaisWhatsapp =
  | { tipo: 'META'; phoneNumberId: string; token: string }
  | { tipo: 'EVOLUTION'; baseUrl: string; apiKey: string; instancia: string }

/**
 * Uma mensagem, nas duas formas que os provedores sabem ler.
 *
 * Carrega texto E template de propósito. A Meta não aceita texto livre para
 * iniciar conversa; a Evolution não tem template nenhum. Deixar cada provedor
 * escolher o que usar é mais honesto que uma abstração que finge que os dois
 * falam a mesma língua — e evita compor o texto duas vezes em lugares
 * diferentes, que é como as duas versões acabam divergindo.
 */
export type MensagemWhatsapp = {
  /** Destinatário em E.164 só com dígitos: 5511999999999. */
  para: string
  /** Texto final, já composto. É o que a Evolution manda. */
  texto: string
  /** Template aprovado na Meta. Nulo quando a loja não usa a oficial. */
  template: {
    nome: string
    idioma: string
    parametros: ParametroTemplate[]
  } | null
}

export interface WhatsappProvider {
  /** Vai para `MensagemEnvio.provedor`, no histórico. */
  readonly nome: string
  enviar(credenciais: CredenciaisWhatsapp, mensagem: MensagemWhatsapp): Promise<ResultadoEnvio>
}

export type { ResultadoEnvio, ParametroTemplate }

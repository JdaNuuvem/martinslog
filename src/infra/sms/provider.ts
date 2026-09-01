/** Uma mensagem de texto pronta para envio. */
export type SmsParaEnviar = {
  /** Destinatário em E.164 só com dígitos: 5511999999999. */
  para: string
  texto: string
  /**
   * Nossa referência da mensagem, devolvida pelo provedor no aviso de
   * situação.
   *
   * É o que permite casar "entregue no aparelho" com a linha certa do
   * histórico. Sem ela, o aviso chega com um identificador que só existe do
   * lado do fornecedor, e a conciliação vira busca por telefone e horário.
   */
  referencia?: string | null
}

export type ResultadoSms =
  | { ok: true; idExterno: string }
  | {
      ok: false
      mensagem: string
      /** Se repetir tem chance de funcionar. */
      retentavel: boolean
      /** Código do provedor, quando houver. É o que explica a recusa. */
      codigo?: string | null
    }

/**
 * Contrato de qualquer provedor de SMS.
 *
 * As credenciais vêm por parâmetro, e não do ambiente do processo, pelo mesmo
 * motivo do e-mail: cada conta usa a própria. A mensagem sai com o remetente
 * do cliente e consome o saldo dele — a plataforma não intermedia envio nem
 * empresta reputação de número.
 *
 * `enviar` **nunca lança** por recusa do provedor: devolve o motivo
 * classificado. Quem chama precisa gravar a falha no histórico e decidir sobre
 * a retentativa, e uma exceção viraria um `catch` genérico que perde o código
 * — que é a única coisa capaz de explicar por que a mensagem não chegou.
 */
export interface SmsProvider {
  /** Nome curto, para o histórico dizer por onde a mensagem saiu. */
  readonly nome: string

  enviar(credenciais: CredenciaisSms, sms: SmsParaEnviar): Promise<ResultadoSms>
}

/**
 * O que um provedor precisa para autenticar.
 *
 * Deliberadamente genérico: cada serviço nomeia seus campos de um jeito
 * (`accountSid`/`authToken` no Twilio, `X-API-TOKEN` na Zenvia, chave e
 * segredo em outros). Modelar os campos de um deles aqui obrigaria a mudar o
 * contrato ao trocar de fornecedor — que é justamente o que esta interface
 * existe para evitar.
 */
export type CredenciaisSms = {
  /** Identificador da conta, quando o provedor exigir. */
  identificador?: string | null
  /** Chave, token ou segredo. */
  chave: string
  /** Número ou nome que aparece como remetente, quando o provedor permitir. */
  remetente?: string | null
}

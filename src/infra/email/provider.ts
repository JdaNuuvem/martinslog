/** Um e-mail pronto para envio. */
export type EmailParaEnviar = {
  para: string
  assunto: string
  html: string
  texto: string
}

export type ResultadoEnvio = { id: string }

/**
 * Contrato de qualquer provedor de e-mail.
 *
 * A chave vem por parâmetro, e não de configuração do processo, porque cada
 * conta usa a própria: o e-mail sai do domínio do cliente, com a reputação de
 * envio dele, e nós não intermediamos remetente.
 */
export interface EmailProvider {
  enviar(chaveApi: string, remetente: string, email: EmailParaEnviar): Promise<ResultadoEnvio>
}

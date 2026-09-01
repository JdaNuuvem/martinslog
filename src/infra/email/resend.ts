import { ServicoIndisponivelError, ValorInvalidoError } from '@/domain/errors'
import type { EmailParaEnviar, EmailProvider, ResultadoEnvio } from './provider'

const URL_ENVIO = 'https://api.resend.com/emails'

/**
 * Tempo limite de cada envio. O disparo percorre a fila em sequência, e um
 * provedor lento sem teto prenderia a requisição inteira.
 */
const TIMEOUT_MS = 8_000

/**
 * Envio via Resend, usando a chave de API da própria conta do cliente.
 *
 * Distingue dois tipos de falha, porque a resposta certa é oposta em cada
 * uma: chave inválida ou remetente não verificado são erro de configuração e
 * não adianta repetir — o cliente precisa corrigir. Indisponibilidade e
 * limite de taxa são transitórios e a entrega deve voltar para a fila.
 */
export class ResendProvider implements EmailProvider {
  constructor(private fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async enviar(
    chaveApi: string,
    remetente: string,
    email: EmailParaEnviar,
  ): Promise<ResultadoEnvio> {
    let resposta: Response
    try {
      resposta = await this.fetch(URL_ENVIO, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${chaveApi}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: remetente,
          to: [email.para],
          subject: email.assunto,
          html: email.html,
          text: email.texto,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new ServicoIndisponivelError('Não foi possível falar com o Resend.', { cause: error })
    }

    if (resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as { id?: string }
      return { id: corpo.id ?? 'sem-id' }
    }

    const detalhe = await resposta.text().catch(() => '')

    // 401/403: chave errada. 422: remetente não verificado ou destinatário
    // inválido. Nenhum melhora com nova tentativa.
    if ([401, 403, 422].includes(resposta.status)) {
      throw new ValorInvalidoError(
        `Resend recusou o envio (HTTP ${resposta.status}). Verifique a chave de API e se o remetente está verificado no domínio.`,
        { cause: new Error(detalhe.slice(0, 500)) },
      )
    }

    throw new ServicoIndisponivelError(
      `Resend indisponível no momento (HTTP ${resposta.status}).`,
      { cause: new Error(detalhe.slice(0, 500)) },
    )
  }
}

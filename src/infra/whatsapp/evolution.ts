import type { ResultadoEnvio } from './cloud-api'
import type { CredenciaisWhatsapp, MensagemWhatsapp, WhatsappProvider } from './provider'

/**
 * Evolution API (evolutionfoundation.com.br), v2.
 *
 * Conversa com um celular pareado por QR, falando o protocolo do WhatsApp Web.
 * Não há template nem verificação de empresa: manda texto livre para qualquer
 * número. O preço disso é que o número PODE SER BANIDO pela Meta se o volume
 * ou o conteúdo parecer disparo em massa — não é hipótese distante, é o modo
 * como a Meta protege a rede.
 *
 * A `apikey` autentica o servidor inteiro, não uma loja. O que separa uma loja
 * da outra é a instância, e é por isso que ela entra em toda rota.
 */

/** Uma tentativa lenta não pode segurar a fila inteira. */
const TIMEOUT_MS = 20_000

/**
 * Erros que não adianta repetir.
 *
 * Instância inexistente ou desconectada não melhora com insistência: falta
 * alguém parear o celular de novo. Número inválido nunca vai existir. Repetir
 * nesses casos só gasta a janela da fila e atrasa quem tem conserto.
 */
const PERMANENTES = new Set([400, 401, 403, 404])

type RespostaEvolution = {
  key?: { id?: string }
  status?: string
  message?: string
  error?: string
  response?: { message?: string | string[] }
}

function mensagemDeErro(corpo: RespostaEvolution | null, statusHttp: number): string {
  const daResposta = corpo?.response?.message
  if (Array.isArray(daResposta) && daResposta.length > 0) return daResposta.join('; ')
  if (typeof daResposta === 'string' && daResposta) return daResposta
  if (corpo?.message) return corpo.message
  if (corpo?.error) return corpo.error
  return `A Evolution recusou com HTTP ${statusHttp}.`
}

export class EvolutionProvider implements WhatsappProvider {
  readonly nome = 'evolution'

  async enviar(
    credenciais: CredenciaisWhatsapp,
    mensagem: MensagemWhatsapp,
  ): Promise<ResultadoEnvio> {
    if (credenciais.tipo !== 'EVOLUTION') {
      return {
        ok: false,
        codigo: null,
        mensagem: 'Credencial da Evolution esperada, veio outra.',
        retentavel: false,
        statusHttp: null,
      }
    }

    const controle = new AbortController()
    const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

    let resposta: Response
    try {
      resposta = await fetch(
        `${credenciais.baseUrl}/message/sendText/${encodeURIComponent(credenciais.instancia)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: credenciais.apiKey },
          /*
            `linkPreview: false` porque toda mensagem nossa carrega o link de
            rastreio: com prévia, o WhatsApp busca a página e o comprador
            recebe um cartão que ocupa a tela inteira, escondendo o texto que
            importa.
          */
          body: JSON.stringify({
            number: mensagem.para,
            textMessage: { text: mensagem.texto },
            linkPreview: false,
          }),
          signal: controle.signal,
        },
      )
    } catch (erro) {
      clearTimeout(alarme)
      // Rede fora, DNS, timeout: tudo isso melhora sozinho. Vale repetir.
      return {
        ok: false,
        codigo: null,
        mensagem: erro instanceof Error ? erro.message : 'Falha de rede ao falar com a Evolution.',
        retentavel: true,
        statusHttp: null,
      }
    }
    clearTimeout(alarme)

    const corpo = (await resposta.json().catch(() => null)) as RespostaEvolution | null

    if (!resposta.ok) {
      return {
        ok: false,
        codigo: resposta.status,
        mensagem: mensagemDeErro(corpo, resposta.status),
        retentavel: !PERMANENTES.has(resposta.status),
        statusHttp: resposta.status,
      }
    }

    const idExterno = corpo?.key?.id
    if (!idExterno) {
      /*
        200 sem id é resposta que não dá para conferir depois. Tratar como
        sucesso marcaria ENVIADA uma mensagem que ninguém consegue rastrear no
        provedor — e o histórico existe justamente para responder "saiu?".
      */
      return {
        ok: false,
        codigo: null,
        mensagem: 'A Evolution respondeu sem id da mensagem.',
        retentavel: true,
        statusHttp: resposta.status,
      }
    }

    return { ok: true, idExterno }
  }
}

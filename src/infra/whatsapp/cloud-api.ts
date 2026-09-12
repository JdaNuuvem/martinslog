/**
 * Cliente da Cloud API do WhatsApp (Meta Graph API).
 *
 * É o caminho oficial, e ele impõe três regras que mudam o produto inteiro:
 *
 * 1. **Mensagem iniciada por nós só sai por template aprovado.** Fora da
 *    janela de 24 horas desde a última mensagem do comprador, texto livre é
 *    recusado. "Seu pedido foi enviado" é sempre template.
 * 2. **O template é referenciado por nome**, e o texto vive na Meta, não aqui.
 *    O que guardamos é a amarração nome → evento e a ordem das variáveis.
 * 3. **As credenciais são do lojista.** Cada perfil tem seu `phone_number_id`
 *    e seu token, porque quem fala com o comprador é a marca onde ele comprou.
 *
 * A alternativa que circula por aí — parear por QR e falar pelo WhatsApp Web
 * (Baileys, Evolution) — dispensa aprovação e custo por mensagem, mas viola os
 * termos: o número do cliente é banido sem aviso e sem recurso. Não é uma
 * escolha de arquitetura, é uma escolha de risco, e ela não é nossa para
 * tomar em nome de quem confiou o número da loja à plataforma.
 */

/**
 * Versão da Graph API fixada, não "a mais recente".
 *
 * A Meta muda o formato entre versões e aposenta as antigas com aviso prévio.
 * Apontar para a mais nova faria o envio quebrar num dia que ninguém escolheu;
 * fixada, a atualização é uma decisão com data.
 */
const VERSAO_GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0'

const BASE = 'https://graph.facebook.com'

/** Uma tentativa lenta não pode segurar a fila inteira. */
const TIMEOUT_MS = 10_000

export type ParametroTemplate = { tipo: 'texto'; valor: string }

export type EnvioTemplate = {
  phoneNumberId: string
  token: string
  /** Destinatário em E.164 só com dígitos: 5511999999999. */
  para: string
  nomeTemplate: string
  idioma: string
  /** Entram em ordem nos `{{1}}`, `{{2}}` do corpo do template. */
  parametros: ParametroTemplate[]
}

export type ResultadoEnvio =
  | { ok: true; idExterno: string }
  | {
      ok: false
      /** Código numérico da Meta, quando houver. É o que identifica a causa. */
      codigo: number | null
      mensagem: string
      /** Se repetir tem chance de dar certo. */
      retentavel: boolean
      statusHttp: number | null
    }

/**
 * Erros que não adianta repetir.
 *
 * A distinção importa mais aqui do que num webhook comum: insistir num
 * template inexistente ou num token vencido gasta a cota da conta do lojista
 * e, no caso do destinatário inválido, marca a qualidade do número dele
 * perante a Meta — que é o ativo que faz as mensagens continuarem sendo
 * entregues.
 */
const PERMANENTES = new Set([
  /** Token inválido, expirado ou revogado. */
  190,
  /** Template não existe, ou não está aprovado no idioma pedido. */
  132001,
  /** Parâmetros não batem com o formato do template. */
  132000,
  /** Template pausado ou desabilitado por qualidade. */
  132015,
  132016,
  /** Número do destinatário não existe no WhatsApp. */
  131026,
  /** Conta sem permissão para o número informado. */
  131009,
  /** Requisição malformada. */
  100,
])

/**
 * Erros que são só "agora não".
 *
 * `80007` e `131056` são limite de vazão — o segundo é por par
 * remetente/destinatário, e aparece justamente quando a régua de recuperação
 * dispara várias mensagens seguidas para a mesma pessoa.
 */
const TRANSITORIOS = new Set([80007, 131056, 131048, 133016, 2])

function classificar(codigo: number | null, statusHttp: number): boolean {
  if (codigo !== null) {
    if (PERMANENTES.has(codigo)) return false
    if (TRANSITORIOS.has(codigo)) return true
  }
  if (statusHttp === 429) return true
  return statusHttp >= 500
}

/**
 * Normaliza o destinatário para o formato que a Cloud API espera.
 *
 * Ela quer só dígitos, com código do país e sem `+`. O que chega da loja vem
 * de campo livre: `(11) 99999-9999`, `+55 11 99999-9999`, `011999999999`.
 *
 * Limite conhecido e deixado de fora de propósito: o nono dígito dos celulares
 * brasileiros. Um número antigo gravado sem ele existe no WhatsApp com ele, e
 * vice-versa — mas adivinhar qual das duas formas está registrada é
 * exatamente o tipo de correção que manda a mensagem para outra pessoa. Quando
 * o número não existe, a Meta responde 131026 e o histórico registra o motivo,
 * que é o caminho honesto.
 */
export function normalizarTelefone(bruto: string): string | null {
  const digitos = String(bruto ?? '').replace(/\D/g, '')
  if (!digitos) return null

  // Já veio com código do país.
  if (digitos.length >= 12 && digitos.startsWith('55')) return digitos

  // 10 ou 11 dígitos é número nacional com DDD: falta só o país.
  if (digitos.length === 10 || digitos.length === 11) return '55' + digitos

  // `0` de operadora antes do DDD.
  if (digitos.length === 12 && digitos.startsWith('0')) return '55' + digitos.slice(1)

  // Estrangeiro já em E.164.
  if (digitos.length >= 11 && digitos.length <= 15) return digitos

  return null
}

type RespostaMeta = {
  messages?: { id?: string }[]
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } }
}

/**
 * Manda uma mensagem de template.
 *
 * Nunca lança por falha da Meta: devolve o motivo classificado, porque quem
 * chama precisa gravar o erro no histórico e decidir sobre a retentativa —
 * uma exceção aqui viraria um `catch` genérico que perde o código, que é a
 * única coisa que explica por que a mensagem não chegou.
 */
export async function enviarTemplate(entrada: EnvioTemplate): Promise<ResultadoEnvio> {
  const url = `${BASE}/${VERSAO_GRAPH}/${encodeURIComponent(entrada.phoneNumberId)}/messages`

  const corpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: entrada.para,
    type: 'template',
    template: {
      name: entrada.nomeTemplate,
      language: { code: entrada.idioma },
      // `components` só vai quando há variáveis: mandar um corpo vazio num
      // template sem parâmetros é recusado com 132000.
      ...(entrada.parametros.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: entrada.parametros.map((p) => ({ type: 'text', text: p.valor })),
              },
            ],
          }
        : {}),
    },
  }

  const controle = new AbortController()
  const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${entrada.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    })
  } catch (erro) {
    // Rede fora, DNS, tempo esgotado: sempre vale repetir.
    return {
      ok: false,
      codigo: null,
      mensagem: erro instanceof Error ? erro.message : 'Falha de rede ao falar com a Meta.',
      retentavel: true,
      statusHttp: null,
    }
  } finally {
    clearTimeout(alarme)
  }

  let json: RespostaMeta = {}
  try {
    json = (await resposta.json()) as RespostaMeta
  } catch {
    // Resposta sem JSON só acontece em erro de infraestrutura da Meta.
    return {
      ok: false,
      codigo: null,
      mensagem: `Resposta ilegível da Meta (HTTP ${resposta.status}).`,
      retentavel: resposta.status >= 500,
      statusHttp: resposta.status,
    }
  }

  if (resposta.ok && json.messages?.[0]?.id) {
    return { ok: true, idExterno: json.messages[0].id }
  }

  const codigo = typeof json.error?.code === 'number' ? json.error.code : null
  const detalhe = json.error?.error_data?.details
  const mensagem = [json.error?.message, detalhe].filter(Boolean).join(' — ') ||
    `Envio recusado pela Meta (HTTP ${resposta.status}).`

  return {
    ok: false,
    codigo,
    mensagem,
    retentavel: classificar(codigo, resposta.status),
    statusHttp: resposta.status,
  }
}

export type ResultadoVerificacao =
  | { ok: true; numeroExibicao: string | null; nomeVerificado: string | null }
  | { ok: false; mensagem: string }

/**
 * Confere a credencial antes de o lojista sair achando que está tudo certo.
 *
 * Lê o próprio número na Graph API: é a chamada mais barata que prova, de uma
 * vez, que o token vale, que ele enxerga aquele `phone_number_id` e que o
 * número existe. Sem isto, o primeiro sinal de credencial errada seria uma
 * venda real sem aviso ao comprador.
 */
export async function verificarCredencial(
  phoneNumberId: string,
  token: string,
): Promise<ResultadoVerificacao> {
  const url =
    `${BASE}/${VERSAO_GRAPH}/${encodeURIComponent(phoneNumberId)}` +
    `?fields=display_phone_number,verified_name,quality_rating`

  const controle = new AbortController()
  const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

  try {
    const resposta = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controle.signal,
    })
    const json = (await resposta.json()) as {
      display_phone_number?: string
      verified_name?: string
      error?: { message?: string }
    }

    if (!resposta.ok) {
      return { ok: false, mensagem: json.error?.message ?? `HTTP ${resposta.status}` }
    }

    return {
      ok: true,
      numeroExibicao: json.display_phone_number ?? null,
      nomeVerificado: json.verified_name ?? null,
    }
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro instanceof Error ? erro.message : 'Falha ao falar com a Meta.',
    }
  } finally {
    clearTimeout(alarme)
  }
}

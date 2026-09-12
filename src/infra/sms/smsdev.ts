import type { CredenciaisSms, ResultadoSms, SmsParaEnviar, SmsProvider } from './provider'

/**
 * Provedor SMS Dev (smsdev.com.br).
 *
 * Brasileira, pré-paga, sem contrato — foi escolhida por subir no mesmo dia,
 * que é o que importa no volume atual. Trocar depois é acrescentar outra
 * classe como esta e apontá-la em `index.ts`; nada fora desta pasta sabe qual
 * está ativo.
 */

const ENDPOINT = 'https://api.smsdev.com.br/v1/send'

/** `type: 9` é SMS no catálogo deles. Não há outro que nos interesse. */
const TIPO_SMS = 9

/** Uma tentativa lenta não pode segurar a fila. */
const TIMEOUT_MS = 15_000

/**
 * Palavras que indicam recusa temporária.
 *
 * A documentação remete a uma "tabela de código de erros" que não veio junto,
 * então a classificação parte da descrição em vez do código. É aproximação
 * consciente, e o código numérico fica gravado no histórico justamente para
 * que a tabela real possa substituir isto quando alguém a tiver em mãos.
 *
 * O padrão para erro desconhecido é NÃO repetir. Repetir contra número
 * inválido não entrega nada e ainda martela a API; já saldo acabado é a
 * exceção que vale esperar, porque uma recarga no meio do caminho resolve.
 */
const SINAIS_TEMPORARIOS = ['saldo', 'credito', 'crédito', 'indisponivel', 'indisponível', 'tente novamente']

type RespostaSmsDev = {
  situacao?: string
  codigo?: string | number
  id?: string | number
  descricao?: string
}

/**
 * A API responde objeto para um envio e lista para vários. Mandamos um por
 * vez, mas ler as duas formas custa três linhas e evita que uma mudança de
 * comportamento do fornecedor vire "resposta ilegível" no histórico.
 */
function primeiraResposta(json: unknown): RespostaSmsDev | null {
  if (Array.isArray(json)) return (json[0] as RespostaSmsDev) ?? null
  if (json && typeof json === 'object') return json as RespostaSmsDev
  return null
}

function ehTemporario(descricao: string): boolean {
  const texto = descricao.toLowerCase()
  return SINAIS_TEMPORARIOS.some((sinal) => texto.includes(sinal))
}

export class SmsDevProvider implements SmsProvider {
  readonly nome = 'smsdev'

  async enviar(credenciais: CredenciaisSms, sms: SmsParaEnviar): Promise<ResultadoSms> {
    const controle = new AbortController()
    const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

    let resposta: Response
    try {
      resposta = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: credenciais.chave,
          type: TIPO_SMS,
          number: sms.para,
          msg: sms.texto,
          /*
            `refer` volta no retorno de situação. Guardar aqui o id da nossa
            linha de histórico é o que permite casar o "entregue no aparelho"
            com a mensagem certa — sem isso, o retorno chega com um id que só
            existe do lado deles.
          */
          ...(sms.referencia ? { refer: sms.referencia.slice(0, 100) } : {}),
        }),
        signal: controle.signal,
      })
    } catch (erro) {
      return {
        ok: false,
        mensagem: erro instanceof Error ? erro.message : 'Falha de rede ao falar com a SMS Dev.',
        retentavel: true,
        codigo: null,
      }
    } finally {
      clearTimeout(alarme)
    }

    let json: unknown
    try {
      json = await resposta.json()
    } catch {
      return {
        ok: false,
        mensagem: `Resposta ilegível da SMS Dev (HTTP ${resposta.status}).`,
        retentavel: resposta.status >= 500,
        codigo: null,
      }
    }

    const corpo = primeiraResposta(json)
    if (!corpo) {
      return {
        ok: false,
        mensagem: `Resposta inesperada da SMS Dev (HTTP ${resposta.status}).`,
        retentavel: resposta.status >= 500,
        codigo: null,
      }
    }

    const codigo = corpo.codigo != null ? String(corpo.codigo) : null

    /*
      A API responde HTTP 200 mesmo recusando: quem decide é o campo
      `situacao`. Olhar só o código HTTP daria sucesso para toda mensagem
      recusada, e o histórico registraria entrega onde não houve nenhuma.
    */
    if (corpo.situacao?.toUpperCase() === 'OK' && corpo.id != null) {
      return { ok: true, idExterno: String(corpo.id) }
    }

    const descricao = corpo.descricao ?? `Envio recusado (HTTP ${resposta.status}).`
    return {
      ok: false,
      mensagem: descricao,
      retentavel: ehTemporario(descricao) || resposta.status >= 500,
      codigo,
    }
  }
}

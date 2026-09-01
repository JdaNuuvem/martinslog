/**
 * Composição do texto de uma mensagem de SMS.
 *
 * No WhatsApp o texto vive aprovado na Meta e só as variáveis viajam, em
 * ordem. No SMS não há aprovação: o texto é nosso, e as variáveis entram por
 * nome entre chaves duplas — `{{cliente}}`, `{{codigo_rastreio}}`.
 *
 * Por nome, e não por posição, de propósito. A ordem posicional do WhatsApp é
 * imposta pela Meta e já é fonte de erro conhecida (trocar `{{1}}` com `{{2}}`
 * manda o código de rastreio no lugar do nome, e a Meta aceita, porque para
 * ela são só textos em sequência). Onde a escolha é nossa, o nome torna o erro
 * impossível.
 */

/** Limite de um SMS antes de a operadora cobrar como duas mensagens. */
export const LIMITE_UM_SMS = 160

/**
 * Limite quando o texto tem acento ou cedilha.
 *
 * A codificação de 7 bits do GSM não cobre acentuação do português. Com um
 * único "ã" a mensagem inteira vira UCS-2 e o limite cai de 160 para 70
 * caracteres — o texto passa a custar o dobro sem nada avisar.
 */
export const LIMITE_UM_SMS_COM_ACENTO = 70

/**
 * Diz se o texto tem algum caractere fora do ASCII de 7 bits.
 *
 * É uma aproximação do alfabeto GSM, não a tabela exata — mas acerta o caso
 * que importa em português: acento e cedilha caem aqui, e são eles que
 * derrubam o limite de 160 para 70.
 *
 * Sem expressão regular de propósito. O intervalo escrito à mão vira um
 * caractere de controle literal no arquivo, invisível na revisão e quebrado
 * no primeiro editor que normalizar a codificação. Comparar o ponto de código
 * não tem esse risco.
 */
function temForaDoAscii(texto: string): boolean {
  for (const caractere of texto) {
    if ((caractere.codePointAt(0) ?? 0) > 127) return true
  }
  return false
}


/**
 * Troca `{{chave}}` pelo valor.
 *
 * Variável sem valor vira string vazia, e não some nem estoura: um aviso com
 * um espaço a mais é melhor do que um aviso não enviado, e melhor ainda do que
 * um texto anunciando `{{codigo_rastreio}}` para o comprador.
 */
export function compor(modelo: string, valores: Record<string, string | null | undefined>): string {
  return (
    modelo
      .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_todo, chave: string) => valores[chave.toLowerCase()] ?? '')
      .replace(/[ \t]{2,}/g, ' ')
      /*
        Remove pontuação que ficou pendurada quando a variável do fim veio
        vazia.

        Sem isto, um texto que termina em "...do seu pedido: {{link_rastreio}}"
        sai como "...do seu pedido:" — uma frase que promete algo e não
        entrega, e que o comprador lê como mensagem quebrada ou como golpe
        malfeito. Acontece quando a emissão da etiqueta falha e o código ainda
        não existe: raro, e exatamente por isso ninguém testaria.
      */
      .replace(/[\s]*[:\-–—,]\s*$/, '')
      .trim()
  )
}

export type CustoTexto = {
  caracteres: number
  /** Quantos SMS a operadora vai cobrar por este texto. */
  partes: number
  /** `true` quando acento derrubou o limite de 160 para 70. */
  temAcento: boolean
}

/**
 * Quanto este texto vai custar, em número de mensagens.
 *
 * Serve para a tela avisar o lojista antes de ele salvar. Sem isso, a conta
 * dobra silenciosamente: ninguém escreve um texto contando caracteres, e
 * ninguém desconfia que um "ã" reduz o limite a menos da metade.
 */
export function custoDoTexto(texto: string): CustoTexto {
  const temAcento = temForaDoAscii(texto)
  const limite = temAcento ? LIMITE_UM_SMS_COM_ACENTO : LIMITE_UM_SMS
  return {
    caracteres: texto.length,
    partes: Math.max(1, Math.ceil(texto.length / limite)),
    temAcento,
  }
}

/**
 * Textos de partida, um por evento.
 *
 * Escritos para caber em uma mensagem e **sem acento**, o que não é descuido
 * de português: com acento o limite cai para 70 caracteres e o mesmo aviso
 * passa a custar duas mensagens. A loja pode reescrever à vontade — a tela
 * mostra quantas mensagens o texto dela vai custar.
 *
 * O nome da loja aparece no começo porque no Brasil o remetente do SMS é um
 * número curto, não um nome: sem ele escrito aqui, o comprador não tem como
 * saber quem mandou.
 */
export const TEXTOS_PADRAO_SMS: Record<string, string> = {
  PEDIDO_PAGO:
    '{{loja}}: pagamento confirmado, {{cliente}}! Segue o link de rastreio do seu pedido: {{link_rastreio}}',
  ETIQUETA_EMITIDA: '{{loja}}: seu pedido foi postado! Rastreie em {{link_rastreio}}',
  POSTADO: '{{loja}}: seu pedido saiu para a transportadora. Acompanhe em {{link_rastreio}}',
  SAIU_PARA_ENTREGA: '{{loja}}: seu pedido sai para entrega hoje! {{link_rastreio}}',
  TENTATIVA_FRUSTRADA:
    '{{loja}}: tentamos entregar e nao encontramos ninguem. Nova tentativa no proximo dia util. {{link_rastreio}}',
  AGUARDANDO_RETIRADA:
    '{{loja}}: seu pedido aguarda retirada. Leve um documento com foto. Detalhes em {{link_rastreio}}',
  ENTREGUE: '{{loja}}: seu pedido foi entregue! Obrigado pela compra.',
}

/**
 * O que pode disparar uma mensagem, e o que cada disparo tem para contar.
 *
 * Existe como catálogo, e não como enum solto, porque a tela precisa das duas
 * coisas ao mesmo tempo: a lista de eventos para o lojista escolher, e a lista
 * de variáveis daquele evento para ele montar o template na Meta na ordem
 * certa. Separá-los faria a tela oferecer `{{codigo_rastreio}}` num evento que
 * acontece antes de o código existir.
 */

export type Variavel = {
  chave: string
  /** Como aparece na tela, para o lojista escolher. */
  rotulo: string
  exemplo: string
}

export type EventoMensagem = {
  codigo: string
  rotulo: string
  descricao: string
  /**
   * Categoria que a Meta exige no cadastro do template. Errar aqui faz a
   * aprovação ser recusada, e é a dúvida número um de quem cadastra o
   * primeiro template.
   */
  categoria: 'UTILITY' | 'MARKETING'
  variaveis: Variavel[]
}

const CLIENTE: Variavel = { chave: 'cliente', rotulo: 'Nome do cliente', exemplo: 'Maria' }
const LOJA: Variavel = { chave: 'loja', rotulo: 'Nome do perfil', exemplo: 'Best Buy Tech' }
const RASTREIO: Variavel = {
  chave: 'codigo_rastreio',
  rotulo: 'Código de rastreio',
  exemplo: 'EC000000014BR',
}
const LINK_RASTREIO: Variavel = {
  chave: 'link_rastreio',
  rotulo: 'Link de rastreio',
  exemplo: 'https://app.martinslog.net/r/EC000000014BR',
}
const VALOR: Variavel = { chave: 'valor', rotulo: 'Valor do pedido', exemplo: 'R$ 97,90' }
const LINK_CHECKOUT: Variavel = {
  chave: 'link_checkout',
  rotulo: 'Link para concluir a compra',
  exemplo: 'https://loja.com/checkout/abc',
}

/**
 * Eventos de pedido, que vêm da loja pela API.
 *
 * `PEDIDO_PENDENTE` é MARKETING, e não UTILITY, porque convencer alguém a
 * terminar uma compra é promoção — classificar como utilidade para pagar menos
 * é o caminho mais rápido para a conta do lojista ser penalizada pela Meta.
 */
const EVENTOS_PEDIDO: EventoMensagem[] = [
  {
    codigo: 'PEDIDO_PENDENTE',
    rotulo: 'Pedido não finalizado',
    descricao:
      'A loja registrou o pedido mas o pagamento não veio. Base da recuperação de vendas.',
    categoria: 'MARKETING',
    variaveis: [CLIENTE, LOJA, VALOR, LINK_CHECKOUT],
  },
  {
    codigo: 'PEDIDO_PAGO',
    rotulo: 'Pagamento confirmado',
    descricao: 'Confirmação para o comprador logo após o pagamento.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, VALOR],
  },
]

/**
 * Eventos de transporte, que vêm dos nossos próprios status de rastreio.
 *
 * Os códigos são os mesmos do catálogo de rastreio: assim, ligar mensagem a um
 * status é uma amarração por código, e um status que o cliente criou por conta
 * própria também pode disparar mensagem, sem precisar entrar nesta lista.
 */
const EVENTOS_ENVIO: EventoMensagem[] = [
  {
    codigo: 'ETIQUETA_EMITIDA',
    rotulo: 'Etiqueta emitida',
    descricao: 'O código de rastreio nasceu. É aqui que o comprador quer recebê-lo.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
  {
    codigo: 'POSTADO',
    rotulo: 'Pedido postado',
    descricao: 'A carga foi coletada e entrou em trânsito.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
  {
    codigo: 'SAIU_PARA_ENTREGA',
    rotulo: 'Saiu para entrega',
    descricao: 'Chega hoje. É a mensagem que mais reduz tentativa frustrada.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
  {
    codigo: 'TENTATIVA_FRUSTRADA',
    rotulo: 'Tentativa de entrega sem sucesso',
    descricao: 'Ninguém no endereço. Avisar evita a segunda tentativa perdida.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
  {
    codigo: 'AGUARDANDO_RETIRADA',
    rotulo: 'Aguardando retirada',
    descricao: 'O pacote espera na unidade e tem prazo para voltar à loja.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
  {
    codigo: 'ENTREGUE',
    rotulo: 'Entregue',
    descricao: 'Confirmação de entrega.',
    categoria: 'UTILITY',
    variaveis: [CLIENTE, LOJA, RASTREIO, LINK_RASTREIO],
  },
]

export const EVENTOS_MENSAGEM: EventoMensagem[] = [...EVENTOS_PEDIDO, ...EVENTOS_ENVIO]

export function acharEvento(codigo: string): EventoMensagem | undefined {
  return EVENTOS_MENSAGEM.find((e) => e.codigo === codigo)
}

/**
 * Monta os parâmetros na ordem que o template espera.
 *
 * A ordem é do template, não nossa: `variaveis` guarda quais campos o lojista
 * pôs em `{{1}}`, `{{2}}` quando cadastrou na Meta. Errar a ordem manda o
 * código de rastreio no lugar do nome do cliente — e a Meta aceita, porque
 * para ela são apenas textos na sequência.
 *
 * Variável sem valor vira string vazia em vez de sumir: a Cloud API recusa a
 * mensagem inteira (132000) quando a quantidade de parâmetros não bate com o
 * template, e perder a notificação por causa de um sobrenome ausente seria
 * pior do que entregá-la com um espaço a menos.
 */
export function montarParametros(
  ordem: string[],
  valores: Record<string, string | null | undefined>,
): { tipo: 'texto'; valor: string }[] {
  return ordem.map((chave) => ({ tipo: 'texto' as const, valor: valores[chave] ?? '' }))
}

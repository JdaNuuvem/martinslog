/**
 * Quem passa e quem não passa no bloqueio por país.
 *
 * A regra de negócio é simples — a Martins Log só atende o Brasil — mas as
 * EXCEÇÕES são o que separa um bloqueio útil de um que derruba a operação. Cada
 * uma abaixo existe por um caso concreto, não por precaução.
 */

/**
 * Caminhos que nunca são bloqueados por país.
 *
 * `/api` é o mais importante: o servidor do integrador que fatura as lojas está
 * em Nova Jersey. Bloqueá-lo pararia toda cotação, todo carrinho e todo
 * checkout no mesmo instante — as vendas deixariam de gerar etiqueta e a causa
 * seria invisível, porque nada quebra, só para de responder.
 *
 * `/r/` é o rastreio que o comprador abre pelo link do SMS. Ele pode estar
 * viajando, e negar o rastreio de uma compra já paga é punir quem já pagou.
 *
 * Os caminhos de saúde e de arquivo estático precisam responder ao próprio
 * servidor e ao navegador antes de qualquer decisão de país.
 */
const CAMINHOS_LIVRES = [
  '/api/',
  '/r/',
  '/rastrear',
  '/_next/',
  '/favicon',
  '/robots.txt',
  '/sitemap.xml',
  '/fora-do-brasil',
] as const

/**
 * Robôs de busca, que rastreiam de fora do Brasil.
 *
 * Bloqueá-los tira o site do Google em poucos dias — e o dono raramente liga o
 * bloqueio esperando perder a indexação.
 *
 * A verificação é pelo texto do navegador, que qualquer um pode imitar. É
 * suficiente aqui de propósito: quem se disfarça de robô ganha acesso a páginas
 * PÚBLICAS, não a dado nenhum. Confirmar por DNS reverso custaria uma consulta
 * de rede em toda requisição para impedir algo que não causa dano.
 */
const ROBOS = [
  'googlebot',
  'bingbot',
  'duckduckbot',
  'yandexbot',
  'baiduspider',
  'applebot',
  'facebookexternalhit',
  'whatsapp',
  'twitterbot',
  'linkedinbot',
  'telegrambot',
  'slackbot',
  'uptimerobot',
] as const

export type Decisao = 'passa' | 'bloqueia'

export type Pedido = {
  caminho: string
  /** IP do visitante, já resolvido a partir dos cabeçalhos do proxy. */
  ip: string | null
  navegador: string | null
}

export type Dependencias = {
  ehBrasileiro: (ip: string) => boolean
  ehPrivado: (ip: string) => boolean
}

/**
 * Decide o destino de um pedido.
 *
 * Recebe as verificações por parâmetro para que o teste possa exercitar a
 * ORDEM das exceções sem depender da lista de faixas — a ordem é onde os
 * defeitos moram, e ela precisa ser verificável isoladamente.
 */
export function decidir(pedido: Pedido, deps: Dependencias): Decisao {
  const caminho = pedido.caminho.toLowerCase()
  if (CAMINHOS_LIVRES.some((livre) => caminho.startsWith(livre))) return 'passa'

  const navegador = (pedido.navegador ?? '').toLowerCase()
  if (ROBOS.some((robo) => navegador.includes(robo))) return 'passa'

  /*
    Sem IP, PASSA.

    É a decisão mais importante do arquivo, e é contraintuitiva. Um proxy mal
    configurado, uma mudança de infraestrutura ou um cabeçalho ausente fariam o
    IP chegar nulo — e bloquear nesse caso fecharia o site para o Brasil
    inteiro, com o log dizendo apenas "bloqueado por país".

    Falhar abrindo é o certo aqui porque isto reduz tráfego indesejado, não
    protege segredo. O que protege é senha, e ela continua no lugar.
  */
  if (!pedido.ip) return 'passa'

  // Rede interna e laço local não têm país: é por eles que a verificação de
  // saúde chega, e derrubá-la derruba a aplicação achando que a protege.
  if (deps.ehPrivado(pedido.ip)) return 'passa'

  return deps.ehBrasileiro(pedido.ip) ? 'passa' : 'bloqueia'
}

/**
 * Resolve o IP do visitante a partir dos cabeçalhos do proxy.
 *
 * `x-forwarded-for` pode trazer uma cadeia (`cliente, proxy1, proxy2`). O
 * primeiro é o cliente — os seguintes são os proxies pelos quais passou.
 */
export function ipDoPedido(cabecalhos: {
  get: (nome: string) => string | null
}): string | null {
  const encadeado = cabecalhos.get('x-forwarded-for')
  if (encadeado) {
    const primeiro = encadeado.split(',')[0]?.trim()
    if (primeiro) return primeiro
  }

  return cabecalhos.get('x-real-ip') ?? cabecalhos.get('cf-connecting-ip') ?? null
}

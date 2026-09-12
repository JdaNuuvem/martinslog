/**
 * A janela de silêncio, em funções puras.
 *
 * Separadas de `pode-enviar` porque a TELA também precisa delas — para dizer
 * "agora são 19h, está liberado" — e aquele módulo carrega o Prisma. Importá-lo
 * de um componente cliente levaria o banco inteiro para o navegador.
 */

/**
 * O fuso da operação.
 *
 * Fixo, e não o do servidor: o container roda em UTC, e "não mandar depois das
 * 22h" quer dizer 22h de quem recebe. Sem isto, a janela ficaria três horas
 * deslocada e mandaria exatamente na hora que deveria evitar.
 */
const FUSO = 'America/Sao_Paulo'

/** A hora local agora, de 0 a 23. */
export function horaLocal(agora = new Date()): number {
  const texto = agora.toLocaleString('pt-BR', { timeZone: FUSO, hour: '2-digit', hour12: false })
  return Number(texto.slice(0, 2))
}

/**
 * A hora está dentro da janela de silêncio?
 *
 * A janela atravessa a meia-noite no caso normal (22h às 8h), então não dá
 * para comparar com um simples `>= inicio && < fim` — isso só valeria para
 * janelas dentro do mesmo dia.
 */
export function dentroDoSilencio(hora: number, inicio: number, fim: number): boolean {
  if (inicio === fim) return false
  if (inicio < fim) return hora >= inicio && hora < fim
  return hora >= inicio || hora < fim
}

/**
 * Quando a janela de silêncio abre.
 *
 * Calculado sobre a hora local e devolvido em UTC, que é como a fila guarda
 * `proximaTentativaEm`. Sem somar o dia quando a hora já passou, a mensagem
 * das 23h seria reagendada para as 8h do MESMO dia — um horário no passado,
 * que a fila trataria como "pode agora".
 */
export function proximaJanela(agora: Date, fimHora: number): Date {
  const alvo = new Date(agora)
  const horaAgora = horaLocal(agora)
  const horasAteAbrir = horaAgora < fimHora ? fimHora - horaAgora : 24 - horaAgora + fimHora

  alvo.setUTCHours(alvo.getUTCHours() + horasAteAbrir, 0, 0, 0)
  return alvo
}

/**
 * O comprador está pedindo para parar?
 *
 * Compara sem acento e sem maiúscula, e só contra a mensagem quase inteira:
 * "pare" dentro de "não pare de me avisar" não é pedido de descadastro, e
 * tratar como se fosse silenciaria justamente quem quer receber.
 */
const PEDIDOS_DE_PARADA = [
  'pare',
  'parar',
  'sair',
  'stop',
  'cancelar',
  'descadastrar',
  'nao quero mais',
  'não quero mais',
  'me tira',
  'remover',
]

export function pediuParaParar(texto: string): boolean {
  const limpo = texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.!?]+$/, '')

  // Mensagem longa não é comando: quem escreve um parágrafo está conversando.
  if (limpo.length > 30) return false

  return PEDIDOS_DE_PARADA.some((p) => {
    const alvo = p.normalize('NFD').replace(/[̀-ͯ]/g, '')
    return limpo === alvo || limpo.startsWith(`${alvo} `)
  })
}

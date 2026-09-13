import type { DadosTemplate } from '../api'

/**
 * Variáveis que o backend resolve em `aplicar-template`.
 *
 * A lista mora aqui e não é digitada à mão pelo atendente porque um
 * `{{codigo-rastreio}}` com hífen no lugar do sublinhado não quebra nada: sai
 * literalmente na mensagem do cliente. Botão que insere a variável certa é o
 * jeito de esse erro não existir.
 */
export const VARIAVEIS = [
  { chave: 'cliente', rotulo: 'Cliente', exemplo: 'Maria' },
  { chave: 'loja', rotulo: 'Loja', exemplo: 'Loja Exemplo' },
  { chave: 'pedido', rotulo: 'Pedido', exemplo: '#10482' },
  { chave: 'codigo_rastreio', rotulo: 'Código de rastreio', exemplo: 'ML123456789BR' },
  { chave: 'link_rastreio', rotulo: 'Link de rastreio', exemplo: 'https://martinslog.net/r/ML123456789BR' },
] as const

export function marcadorDaVariavel(chave: string): string {
  return `{{${chave}}}`
}

/** O texto com as variáveis trocadas pelos valores de exemplo, para a prévia. */
export function previaComExemplos(texto: string): string {
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (inteiro, chave: string) => {
    const variavel = VARIAVEIS.find((v) => v.chave === chave.toLowerCase())
    return variavel ? variavel.exemplo : inteiro
  })
}

/** Variáveis escritas no texto que o backend não conhece. */
export function variaveisDesconhecidas(texto: string): string[] {
  const achadas = [...texto.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1] ?? '')
  const conhecidas = new Set<string>(VARIAVEIS.map((v) => v.chave))
  return [...new Set(achadas.filter((chave) => !conhecidas.has(chave)))]
}

/** Atalho sem a barra, sem espaço e em minúsculas; vazio vira `null`. */
export function normalizarAtalho(atalho: string): string | null {
  const limpo = atalho.trim().replace(/^\/+/, '').toLowerCase()
  return limpo || null
}

export type ErrosTemplate = Partial<Record<'titulo' | 'atalho' | 'texto', string>>

export function validarTemplate(
  dados: Pick<DadosTemplate, 'titulo' | 'texto'> & { atalho: string },
  atalhosEmUso: Array<string | null> = [],
): ErrosTemplate {
  const erros: ErrosTemplate = {}
  if (!dados.titulo.trim()) erros.titulo = 'Dê um título para achar o template depois.'
  else if (dados.titulo.trim().length > 60) erros.titulo = 'Use até 60 caracteres.'

  const atalho = normalizarAtalho(dados.atalho)
  if (atalho !== null) {
    if (!/^[a-z0-9_-]+$/.test(atalho)) {
      erros.atalho = 'Só letras sem acento, números, "-" e "_", sem espaços.'
    } else if (atalhosEmUso.includes(atalho)) {
      erros.atalho = 'Já existe um template com este atalho.'
    }
  }

  if (!dados.texto.trim()) erros.texto = 'Escreva o texto da mensagem.'
  else {
    const desconhecidas = variaveisDesconhecidas(dados.texto)
    if (desconhecidas.length > 0) {
      erros.texto = `Variável desconhecida: ${desconhecidas.map(marcadorDaVariavel).join(', ')}.`
    }
  }
  return erros
}

/**
 * Troca um template de posição com o vizinho e devolve a nova ordem de todos.
 *
 * Renumera a lista inteira (0, 1, 2…) em vez de só trocar os dois valores:
 * templates antigos podem ter `ordem` repetida, e trocar dois números iguais
 * não move nada na tela.
 */
export function moverTemplate<T extends { id: string; ordem: number }>(
  lista: T[],
  id: string,
  direcao: -1 | 1,
): T[] {
  const ordenada = [...lista].sort((a, b) => a.ordem - b.ordem)
  const de = ordenada.findIndex((t) => t.id === id)
  const para = de + direcao
  const atual = ordenada[de]
  const vizinho = ordenada[para]
  if (!atual || !vizinho) return ordenada
  ordenada[de] = vizinho
  ordenada[para] = atual
  return ordenada.map((t, i) => ({ ...t, ordem: i }))
}

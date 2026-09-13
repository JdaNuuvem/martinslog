import type { Mensagem, ResumoConversa, Template, TipoMensagem } from './api'

/**
 * Lógica pura da caixa de entrada: nada aqui toca rede, DOM ou relógio
 * implícito. O "agora" entra por parâmetro para que "Hoje" e "Ontem" sejam
 * testáveis sem congelar o tempo do processo inteiro.
 */

const DIAS_DA_SEMANA = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0')
}

/** Meia-noite local do dia de `data`, em milissegundos. */
function inicioDoDia(data: Date): number {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime()
}

/**
 * Quantos dias de calendário separam `iso` de `agora`.
 *
 * Conta por meia-noite, e não por 24 h: uma mensagem das 23h50 de ontem vista
 * às 00h10 de hoje é "Ontem", mesmo tendo chegado há vinte minutos. É assim
 * que o atendente lê a data.
 */
function diasAtras(iso: string, agora: Date): number {
  const diferenca = inicioDoDia(agora) - inicioDoDia(new Date(iso))
  return Math.round(diferenca / 86_400_000)
}

export function horaMinuto(iso: string): string {
  const data = new Date(iso)
  return `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`
}

/** Horário da lista de conversas: hoje → HH:mm, ontem → "Ontem", senão dd/mm. */
export function horarioDaLista(iso: string, agora: Date = new Date()): string {
  const dias = diasAtras(iso, agora)
  if (dias <= 0) return horaMinuto(iso)
  if (dias === 1) return 'Ontem'
  const data = new Date(iso)
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}`
}

/**
 * Rótulo do separador de dia dentro da conversa.
 *
 * Na última semana o nome do dia diz mais que a data ("Terça-feira" se lê de
 * relance; "09/09/2026" obriga a fazer conta). Depois disso, só a data resolve.
 */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const dias = diasAtras(iso, agora)
  if (dias <= 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  const data = new Date(iso)
  if (dias < 7) return DIAS_DA_SEMANA[data.getDay()] ?? ''
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}`
}

export type GrupoDoDia = { chave: string; rotulo: string; mensagens: Mensagem[] }

/** Agrupa mensagens (já em ordem cronológica) pelo dia de calendário local. */
export function agruparPorDia(mensagens: Mensagem[], agora: Date = new Date()): GrupoDoDia[] {
  const grupos: GrupoDoDia[] = []
  for (const mensagem of mensagens) {
    const data = new Date(mensagem.ocorridoEm)
    const chave = `${data.getFullYear()}-${data.getMonth()}-${data.getDate()}`
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.chave === chave) ultimo.mensagens.push(mensagem)
    else grupos.push({ chave, rotulo: rotuloDoDia(mensagem.ocorridoEm, agora), mensagens: [mensagem] })
  }
  return grupos
}

/**
 * Junta mensagens novas às que já estão na tela, sem duplicar.
 *
 * A mesma mensagem chega por mais de um caminho — a resposta do envio, a
 * consulta periódica e a carga de antigas se sobrepõem de propósito — e a
 * versão que chega por último é a mais nova (é assim que ✓ vira ✓✓). A
 * ordenação é estável: duas mensagens no mesmo milissegundo mantêm a ordem
 * em que apareceram.
 */
export function mesclarMensagens(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  if (novas.length === 0) return atuais
  const porId = new Map<string, Mensagem>()
  for (const m of atuais) porId.set(m.id, m)
  for (const m of novas) porId.set(m.id, m)
  return [...porId.values()]
    .map((m, i) => ({ m, i, t: new Date(m.ocorridoEm).getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ m }) => m)
}

/** Troca a mensagem otimista (id local) pela que o servidor gravou. */
export function substituirMensagem(atuais: Mensagem[], idLocal: string, doServidor: Mensagem): Mensagem[] {
  return mesclarMensagens(
    atuais.filter((m) => m.id !== idLocal),
    [doServidor],
  )
}

export const PREFIXO_ID_LOCAL = 'local-'

/**
 * Marco do `depoisDe` da consulta periódica.
 *
 * Não é a última mensagem: é a de algumas posições antes do fim. Pedir só o
 * que é estritamente novo nunca traria de volta a mudança de status das
 * mensagens já exibidas — o ✓✓ azul de "lida" chega depois da mensagem. Reler
 * uma janela curta do fim custa pouco e o merge por id descarta a repetição.
 */
export function marcoDaConsulta(mensagens: Mensagem[], janela = 20): string | undefined {
  const doServidor = mensagens.filter((m) => !m.id.startsWith(PREFIXO_ID_LOCAL))
  return doServidor[Math.max(0, doServidor.length - janela)]?.ocorridoEm
}

/**
 * Loja que a tela abre: a pedida no endereço, se existir; senão a primeira
 * conectada; senão a primeira. Abrir numa loja desconectada quando há outra
 * conectada mostraria uma caixa vazia sem motivo aparente.
 */
export function escolherLoja<T extends { perfilId: string; conectado: boolean }>(
  lojas: T[],
  pedida: string | null,
): string | null {
  return (
    lojas.find((l) => l.perfilId === pedida)?.perfilId ??
    lojas.find((l) => l.conectado)?.perfilId ??
    lojas[0]?.perfilId ??
    null
  )
}

/** Junta a primeira página recarregada da lista com as páginas já roladas. */
export function mesclarConversas(atuais: ResumoConversa[], novas: ResumoConversa[]): ResumoConversa[] {
  const porId = new Map<string, ResumoConversa>()
  for (const c of atuais) porId.set(c.id, c)
  for (const c of novas) porId.set(c.id, c)
  return [...porId.values()].sort(
    (a, b) => new Date(b.ultimaMensagemEm).getTime() - new Date(a.ultimaMensagemEm).getTime(),
  )
}

/**
 * Dígitos prontos para discar.
 *
 * Não se adivinha o 55: o telefone vem do jid do WhatsApp, que sempre traz o
 * código do país. E a adivinhação erraria de verdade — "14155552671" é um
 * número dos EUA com onze dígitos, o mesmo tamanho de um celular brasileiro
 * sem o 55.
 */
export function digitosParaDiscagem(telefone: string): string {
  return telefone.replace(/\D/g, '')
}

/** "(11) 98765-4321" para número brasileiro; "+<dígitos>" para o resto. */
export function telefoneFormatado(telefone: string): string {
  const digitos = digitosParaDiscagem(telefone)
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = digitos.slice(2, 4)
    const numero = digitos.slice(4)
    const corte = numero.length === 9 ? 5 : 4
    return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`
  }
  return digitos ? `+${digitos}` : telefone
}

/**
 * Como a conversa se chama na tela.
 *
 * Contato que só chegou com identificador `@lid` não traz número nem nome —
 * mostrar o jid seria mostrar um código sem sentido para quem atende.
 */
export function nomeDoContato(c: Pick<ResumoConversa, 'nome' | 'telefone'>): string {
  const nome = c.nome?.trim()
  if (nome) return nome
  if (c.telefone) return telefoneFormatado(c.telefone)
  return 'Contato'
}

export function iniciais(nome: string | null): string {
  const palavras = (nome ?? '').trim().split(/\s+/).filter((p) => /\p{L}/u.test(p))
  const primeira = palavras[0]?.[0] ?? ''
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1]?.[0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

export function tamanhoLegivel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function duracaoLegivel(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos) || segundos < 0) return '0:00'
  const total = Math.floor(segundos)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${doisDigitos(m)}:${doisDigitos(s)}` : `${m}:${doisDigitos(s)}`
}

const ROTULO_TIPO: Partial<Record<TipoMensagem, string>> = {
  AUDIO: '🎤 Áudio',
  IMAGEM: '📷 Foto',
  VIDEO: '🎥 Vídeo',
  DOCUMENTO: '📄 Documento',
  FIGURINHA: 'Figurinha',
}

/** Prévia da lista: ícone do tipo e, quando houver, a legenda ou o texto. */
export function previaDaConversa(c: Pick<ResumoConversa, 'previa' | 'previaTipo'>): string {
  const rotulo = ROTULO_TIPO[c.previaTipo]
  const texto = c.previa?.trim()
  if (!rotulo) return texto || ''
  return texto ? `${rotulo.split(' ')[0]} ${texto}` : rotulo
}

/** Tipo com que um arquivo local aparece no balão otimista, antes de o servidor responder. */
export function tipoDoArquivo(mimetype: string): TipoMensagem {
  if (mimetype.startsWith('image/')) return 'IMAGEM'
  if (mimetype.startsWith('video/')) return 'VIDEO'
  if (mimetype.startsWith('audio/')) return 'AUDIO'
  return 'DOCUMENTO'
}

/** Limite de anexo do WhatsApp para mídia comum. Recusar aqui poupa o upload. */
export const LIMITE_ANEXO_BYTES = 16 * 1024 * 1024

export function validarAnexo(arquivo: { size: number }): string | null {
  if (arquivo.size > LIMITE_ANEXO_BYTES) {
    return `O arquivo tem ${tamanhoLegivel(arquivo.size)} e o WhatsApp aceita até 16 MB.`
  }
  if (arquivo.size === 0) return 'O arquivo está vazio.'
  return null
}

/** Minúsculas e sem acento: "Rastreío" e "rastreio" são a mesma busca. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * O termo digitado depois de "/" no início do campo, ou `null` se o campo não
 * está pedindo template.
 *
 * Só vale enquanto não há espaço: "/rastreio" filtra; "/rastreio chegou" já é
 * texto que a pessoa quer mandar, e abrir a lista por cima atrapalharia.
 */
export function termoDaBarra(texto: string): string | null {
  const achado = /^\/(\S*)$/.exec(texto)
  return achado ? (achado[1] ?? '') : null
}

/** Filtra templates por atalho (prefixo, primeiro) e título (trecho, depois). */
export function filtrarTemplates(templates: Template[], termo: string): Template[] {
  const alvo = normalizar(termo.trim().replace(/^\//, ''))
  const ordenados = [...templates].sort((a, b) => a.ordem - b.ordem)
  if (!alvo) return ordenados
  const porAtalho = ordenados.filter((t) => t.atalho && normalizar(t.atalho).startsWith(alvo))
  const porTitulo = ordenados.filter(
    (t) => !porAtalho.includes(t) && normalizar(t.titulo).includes(alvo),
  )
  return [...porAtalho, ...porTitulo]
}

export type Segmento = { tipo: 'texto' | 'link'; valor: string; destaque: boolean }

const PADRAO_LINK = /\b(?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]"']/gi

/**
 * Quebra o texto em trechos de link e de texto, e marca onde o termo da busca
 * aparece. Devolver dados (e não JSX) mantém isto testável e impede que texto
 * do cliente vire HTML: cada trecho é renderizado como texto puro.
 */
export function segmentarTexto(texto: string, termo = ''): Segmento[] {
  const brutos: Array<{ tipo: 'texto' | 'link'; valor: string }> = []
  let inicio = 0
  for (const achado of texto.matchAll(PADRAO_LINK)) {
    const pos = achado.index ?? 0
    if (pos > inicio) brutos.push({ tipo: 'texto', valor: texto.slice(inicio, pos) })
    brutos.push({ tipo: 'link', valor: achado[0] })
    inicio = pos + achado[0].length
  }
  if (inicio < texto.length) brutos.push({ tipo: 'texto', valor: texto.slice(inicio) })

  const alvo = normalizar(termo.trim())
  if (!alvo) return brutos.map((b) => ({ ...b, destaque: false }))

  return brutos.flatMap((b) => {
    // A normalização remove acentos combinados; em textos com letras
    // decompostas o índice poderia desalinhar, então só se destaca quando o
    // tamanho não muda (o caso de quase todo texto digitado em teclado).
    const base = normalizar(b.valor)
    if (base.length !== b.valor.length) return [{ ...b, destaque: base.includes(alvo) }]
    const partes: Segmento[] = []
    let de = 0
    let pos = base.indexOf(alvo)
    while (pos !== -1) {
      if (pos > de) partes.push({ tipo: b.tipo, valor: b.valor.slice(de, pos), destaque: false })
      partes.push({ tipo: b.tipo, valor: b.valor.slice(pos, pos + alvo.length), destaque: true })
      de = pos + alvo.length
      pos = base.indexOf(alvo, de)
    }
    if (de < b.valor.length) partes.push({ tipo: b.tipo, valor: b.valor.slice(de), destaque: false })
    return partes
  })
}

export function hrefDoLink(valor: string): string {
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`
}

/** Ids das mensagens carregadas em que o termo aparece (texto ou nome do arquivo). */
export function mensagensComTermo(mensagens: Mensagem[], termo: string): string[] {
  const alvo = normalizar(termo.trim())
  if (!alvo) return []
  return mensagens
    .filter((m) => normalizar(`${m.texto ?? ''} ${m.midia?.nome ?? ''}`).includes(alvo))
    .map((m) => m.id)
}

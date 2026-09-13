/**
 * Espelho dos enums do schema. O domínio não importa o Prisma (regra do
 * lint), e uniões literais idênticas são intercambiáveis com as geradas —
 * um valor novo no schema que falte aqui vira erro de tipo em quem grava.
 */
export type TipoMensagemWhatsapp =
  | 'TEXTO'
  | 'AUDIO'
  | 'IMAGEM'
  | 'VIDEO'
  | 'DOCUMENTO'
  | 'FIGURINHA'
  | 'OUTRO'

export type StatusMensagemWhatsapp = 'ENVIANDO' | 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'ERRO'

/**
 * Ler uma mensagem crua da Evolution e dizer o que ela é.
 *
 * Puro de propósito: o mesmo registro chega por dois caminhos — o webhook
 * `messages.upsert` e a importação por `findMessages` — e as duas leituras
 * precisam concordar. Duas cópias da regra "o que é áudio" acabariam
 * discordando, e a que discorda em silêncio é a que grava mensagem em branco.
 *
 * Formato conferido na Evolution v2.3.7 (registro de `findMessages` medido em
 * produção, e `prepareMessage` em
 * src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts da tag
 * 2.3.7): `{ key: { id, fromMe, remoteJid, remoteJidAlt? }, pushName,
 * messageType, message: { conversation | imageMessage | ... },
 * messageTimestamp: number }`. A Evolution já troca `extendedTextMessage` por
 * `conversation`, mas o webhook de versões antigas não — por isso os dois.
 */

type Bruto = Record<string, unknown>

export type RegistroEvolution = {
  key?: {
    id?: string
    fromMe?: boolean
    remoteJid?: string
    remoteJidAlt?: string
    senderPn?: string
  }
  pushName?: string | null
  messageType?: string
  message?: Bruto | null
  messageTimestamp?: number | string | { low?: number } | null
}

export type MensagemLida = {
  idExterno: string
  jid: string
  /** Só dígitos, quando a própria mensagem revela o número. */
  telefone: string | null
  fromMe: boolean
  /** Nome de quem escreveu. Em mensagem `fromMe` é o nome da LOJA. */
  pushName: string | null
  tipo: TipoMensagemWhatsapp
  texto: string | null
  midiaMimetype: string | null
  midiaNome: string | null
  midiaTamanho: number | null
  midiaDuracao: number | null
  ocorridoEm: Date
}

const SUFIXO_LID = '@lid'
const SUFIXO_TELEFONE = '@s.whatsapp.net'

/**
 * Só conversa de uma pessoa com a loja entra na caixa de entrada.
 *
 * Grupo, lista de transmissão, status e canal ficam de fora: responder num
 * grupo pela caixa de entrada da loja falaria com dezenas de pessoas achando
 * que fala com uma.
 */
export function jidDeConversa(jid: string | null | undefined): jid is string {
  if (!jid) return false
  return jid.endsWith(SUFIXO_LID) || jid.endsWith(SUFIXO_TELEFONE)
}

/** Dígitos do telefone, e só de jid que É telefone. `@lid` nunca vira número. */
export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith(SUFIXO_TELEFONE)) return null
  const digitos = jid.slice(0, -SUFIXO_TELEFONE.length).split(':')[0]?.replace(/\D/g, '')
  return digitos || null
}

/** O jid de um telefone solto, para quem ainda chama pelo número. */
export function jidDoTelefone(digitos: string): string {
  return `${digitos.replace(/\D/g, '')}${SUFIXO_TELEFONE}`
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null
}

/**
 * Número que pode vir como número, string ou `Long` serializado (`{low}`).
 * O Baileys usa os três para `fileLength` e `seconds`, conforme a origem.
 */
function inteiro(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor)
  if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
  if (valor && typeof valor === 'object' && 'low' in valor) {
    const low = (valor as { low?: unknown }).low
    return typeof low === 'number' ? low : null
  }
  return null
}

/**
 * Tipos que não são mensagem para a tela: reação, apagar, editar, voto.
 * Gravá-los criaria balões vazios no meio da conversa.
 */
const SEM_BALAO = new Set([
  'reactionMessage',
  'protocolMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'senderKeyDistributionMessage',
  'editedMessage',
])

/** Envelopes que só embrulham a mensagem de verdade. */
const ENVELOPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
]

function desembrulhar(message: Bruto): Bruto {
  let atual = message
  for (let i = 0; i < 3; i++) {
    const envelope = ENVELOPES.find((e) => (atual[e] as Bruto | undefined)?.message)
    if (!envelope) break
    atual = (atual[envelope] as { message: Bruto }).message
  }
  return atual
}

/**
 * Texto de mensagens com botão, lista ou template — as de empresa (banco,
 * concessionária, a própria Meta) e as respostas do cliente a elas.
 *
 * Medido em produção: eram 1 em cada 10 mensagens da caixa, todas vazias
 * como "não suportada", quando o que importa nelas é o texto.
 */
function textoInterativo(m: Bruto): string | null {
  const campo = (chave: string) => m[chave] as Bruto | undefined
  const botoes = campo('buttonsMessage')
  const interativa = campo('interactiveMessage')
  const lista = campo('listMessage')
  const modelo = campo('templateMessage')
  const hidratado = (modelo?.hydratedTemplate ?? modelo?.hydratedFourRowTemplate) as Bruto | undefined

  return (
    texto(botoes?.contentText) ??
    texto(campo('buttonsResponseMessage')?.selectedDisplayText) ??
    texto((interativa?.body as Bruto | undefined)?.text) ??
    texto(campo('listResponseMessage')?.title) ??
    texto(lista?.description) ??
    texto(lista?.title) ??
    texto(hidratado?.hydratedContentText) ??
    texto(campo('templateButtonReplyMessage')?.selectedDisplayText) ??
    null
  )
}

type Conteudo = Pick<
  MensagemLida,
  'tipo' | 'texto' | 'midiaMimetype' | 'midiaNome' | 'midiaTamanho' | 'midiaDuracao'
>

function conteudoDe(bruto: Bruto): Conteudo | null {
  const m = desembrulhar(bruto)
  const vazio = { midiaMimetype: null, midiaNome: null, midiaTamanho: null, midiaDuracao: null }

  const conversa = texto(m.conversation) ?? texto((m.extendedTextMessage as Bruto | undefined)?.text)
  if (conversa) return { tipo: 'TEXTO', texto: conversa, ...vazio }

  const interativo = textoInterativo(m)
  if (interativo) return { tipo: 'TEXTO', texto: interativo, ...vazio }

  const midias: Array<[string, TipoMensagemWhatsapp]> = [
    ['imageMessage', 'IMAGEM'],
    ['videoMessage', 'VIDEO'],
    ['ptvMessage', 'VIDEO'],
    ['audioMessage', 'AUDIO'],
    ['documentMessage', 'DOCUMENTO'],
    ['stickerMessage', 'FIGURINHA'],
  ]
  for (const [chave, tipo] of midias) {
    const midia = m[chave] as Bruto | undefined
    if (!midia) continue
    return {
      tipo,
      texto: texto(midia.caption),
      midiaMimetype: texto(midia.mimetype),
      midiaNome: texto(midia.fileName),
      midiaTamanho: inteiro(midia.fileLength),
      midiaDuracao: inteiro(midia.seconds),
    }
  }

  const chaves = Object.keys(m).filter((k) => k !== 'messageContextInfo')
  if (chaves.length === 0) return null
  if (chaves.every((k) => SEM_BALAO.has(k))) return null

  // Contato, localização, enquete: a tela mostra "mensagem não suportada" em
  // vez de fingir que nada chegou.
  return { tipo: 'OUTRO', texto: null, ...vazio }
}

function carimbo(valor: RegistroEvolution['messageTimestamp']): Date {
  const segundos = inteiro(valor)
  return segundos && segundos > 0 ? new Date(segundos * 1000) : new Date()
}

/**
 * Registro da Evolution → mensagem da caixa de entrada, ou `null` quando não
 * é uma (grupo, reação, sem id).
 */
export function lerMensagem(registro: RegistroEvolution | null | undefined): MensagemLida | null {
  const key = registro?.key
  const jid = key?.remoteJid
  if (!key?.id || !jidDeConversa(jid) || !registro?.message) return null

  const conteudo = conteudoDe(registro.message)
  if (!conteudo) return null

  /*
    Quando a Evolution sabe o número por trás do `@lid`, ele vem em
    `remoteJidAlt` (ou `senderPn` no Baileys antigo). No celular medido, as
    mensagens `@lid` NÃO traziam nenhum dos dois — então isto é bônus, nunca
    premissa.
  */
  const alternativo = [key.remoteJidAlt, key.senderPn].find((j) => j?.endsWith(SUFIXO_TELEFONE))

  return {
    idExterno: key.id,
    jid,
    telefone: telefoneDoJid(jid) ?? telefoneDoJid(alternativo),
    fromMe: key.fromMe === true,
    pushName: texto(registro.pushName),
    ...conteudo,
    ocorridoEm: carimbo(registro.messageTimestamp),
  }
}

/**
 * Status de `messages.update` → status nosso.
 *
 * Valores de src/utils/renderStatus.ts da tag 2.3.7: ERROR, PENDING,
 * SERVER_ACK, DELIVERY_ACK, READ, PLAYED. `PLAYED` (áudio ouvido) é lido para
 * quem olha os tiques.
 */
export function statusDaEvolution(valor: unknown): StatusMensagemWhatsapp | null {
  switch (valor) {
    case 'SERVER_ACK':
      return 'ENVIADA'
    case 'DELIVERY_ACK':
      return 'ENTREGUE'
    case 'READ':
    case 'PLAYED':
      return 'LIDA'
    case 'ERROR':
      return 'ERRO'
    default:
      return null
  }
}

const ORDEM_STATUS: Record<StatusMensagemWhatsapp, number> = {
  ERRO: 0,
  ENVIANDO: 1,
  ENVIADA: 2,
  ENTREGUE: 3,
  LIDA: 4,
}

/** Status que podem ser substituídos por `novo` sem andar para trás. */
export function statusAnterioresA(novo: StatusMensagemWhatsapp): StatusMensagemWhatsapp[] {
  if (novo === 'ERRO') return ['ENVIANDO']
  return (Object.keys(ORDEM_STATUS) as StatusMensagemWhatsapp[]).filter(
    (s) => s !== 'ERRO' && ORDEM_STATUS[s] < ORDEM_STATUS[novo],
  )
}

/** Uma linha para a lista de conversas. */
export function previaDe(tipo: TipoMensagemWhatsapp, textoMensagem: string | null): string | null {
  if (textoMensagem) return textoMensagem.slice(0, 200)
  const rotulos: Record<TipoMensagemWhatsapp, string | null> = {
    TEXTO: null,
    AUDIO: 'Áudio',
    IMAGEM: 'Imagem',
    VIDEO: 'Vídeo',
    DOCUMENTO: 'Documento',
    FIGURINHA: 'Figurinha',
    OUTRO: 'Mensagem não suportada',
  }
  return rotulos[tipo]
}

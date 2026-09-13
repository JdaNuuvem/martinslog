import { credenciaisDoServidor } from '@/infra/whatsapp'
import type { RegistroEvolution } from '@/domain/whatsapp/mensagem-evolution'

/**
 * As rotas da Evolution que a caixa de entrada usa, uma função por rota.
 *
 * Cada corpo abaixo foi conferido no código da tag 2.3.7 do repositório
 * EvolutionAPI/evolution-api — não na documentação, que está atrás da versão
 * em mais de um ponto (o `sendText` antigo usava `textMessage: { text }`, e a
 * 2.3.7 recusa esse corpo). A fonte de cada formato está ao lado da função.
 *
 * Tudo aqui fala com a apikey do SERVIDOR. Nenhuma função devolve a chave, e
 * nenhuma rota do navegador chega aqui sem passar pela posse da loja.
 */

/** Uma chamada lenta não pode segurar a tela nem a importação inteira. */
const TIMEOUT_MS = 30_000

export class EvolutionApiError extends Error {
  constructor(
    mensagem: string,
    readonly statusHttp: number | null,
  ) {
    super(mensagem)
    this.name = 'EvolutionApiError'
  }
}

type Corpo = Record<string, unknown>

function mensagemDeErro(corpo: unknown, statusHttp: number): string {
  const c = corpo as { response?: { message?: unknown }; message?: unknown; error?: unknown } | null
  const daResposta = c?.response?.message
  if (Array.isArray(daResposta) && daResposta.length > 0) {
    return daResposta.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ')
  }
  if (typeof daResposta === 'string' && daResposta) return daResposta
  if (typeof c?.message === 'string' && c.message) return c.message
  if (typeof c?.error === 'string' && c.error) return c.error
  return `A Evolution recusou com HTTP ${statusHttp}.`
}

async function chamar<T>(caminho: string, metodo: 'GET' | 'POST', corpo?: Corpo): Promise<T> {
  const servidor = credenciaisDoServidor()
  if (!servidor) throw new EvolutionApiError('A Evolution não está configurada neste servidor.', null)

  const controle = new AbortController()
  const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

  let resposta: Response
  try {
    resposta = await fetch(`${servidor.baseUrl}${caminho}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', apikey: servidor.apiKey },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controle.signal,
    })
  } catch (erro) {
    throw new EvolutionApiError(
      erro instanceof Error && erro.name === 'AbortError'
        ? 'A Evolution demorou demais para responder.'
        : 'Não foi possível falar com a Evolution.',
      null,
    )
  } finally {
    clearTimeout(alarme)
  }

  const lido = (await resposta.json().catch(() => null)) as unknown
  if (!resposta.ok) throw new EvolutionApiError(mensagemDeErro(lido, resposta.status), resposta.status)
  return lido as T
}

const inst = (instancia: string) => encodeURIComponent(instancia)

// ─── Leitura ────────────────────────────────────────────────────────────────

export type ChatEvolution = {
  id?: string
  remoteJid?: string
  pushName?: string | null
  profilePicUrl?: string | null
  updatedAt?: string | null
  unreadCount?: number | null
  lastMessage?: RegistroEvolution | null
}

/**
 * `POST /chat/findChats/{instance}`, corpo `{}` → array.
 *
 * Fonte: `fetchChats` em src/api/services/channel.service.ts (2.3.7). Sem
 * `take`/`skip` a consulta não tem LIMIT: vem tudo, ordenado por `updatedAt`.
 * Medido em produção: 335 chats numa chamada.
 */
export async function buscarChats(instancia: string): Promise<ChatEvolution[]> {
  const lido = await chamar<unknown>(`/chat/findChats/${inst(instancia)}`, 'POST', {})
  return Array.isArray(lido) ? (lido as ChatEvolution[]) : []
}

export type PaginaMensagens = {
  total: number
  pages: number
  currentPage: number
  records: RegistroEvolution[]
}

/**
 * `POST /chat/findMessages/{instance}`, corpo `{ where, page, offset }`.
 *
 * Fonte: `fetchMessages` em src/api/services/channel.service.ts (2.3.7). O
 * TAMANHO da página é `offset` — não `limit` —, com padrão 50:
 * `skip: offset * (page - 1), take: offset`. Resposta
 * `{ messages: { total, pages, currentPage, records } }`, mais nova primeiro.
 * `limit` vai junto só para uma versão que o leia; a 2.3.7 ignora.
 */
export async function buscarMensagens(
  instancia: string,
  pagina: number,
  porPagina: number,
  where: Corpo = {},
): Promise<PaginaMensagens> {
  const lido = await chamar<{ messages?: Partial<PaginaMensagens> }>(
    `/chat/findMessages/${inst(instancia)}`,
    'POST',
    { where, page: pagina, offset: porPagina, limit: porPagina },
  )
  const m = lido?.messages
  return {
    total: m?.total ?? 0,
    pages: m?.pages ?? 0,
    currentPage: m?.currentPage ?? pagina,
    records: Array.isArray(m?.records) ? m.records : [],
  }
}

export type MidiaBaixada = { base64: string; mimetype: string | null; fileName: string | null }

/**
 * `POST /chat/getBase64FromMediaMessage/{instance}`, corpo
 * `{ message: { key: { id } }, convertToMp4: false }`.
 *
 * Fonte: `getBase64FromMediaMessage` em whatsapp.baileys.service.ts (2.3.7).
 * Sem `message.message`, a Evolution busca a mensagem no banco DELA pelo
 * `key.id` e baixa do WhatsApp. Devolve
 * `{ mediaType, fileName, caption, size, mimetype, base64 }`.
 */
export async function baixarMidia(instancia: string, idExterno: string): Promise<MidiaBaixada> {
  const lido = await chamar<{ base64?: string; mimetype?: string; fileName?: string }>(
    `/chat/getBase64FromMediaMessage/${inst(instancia)}`,
    'POST',
    { message: { key: { id: idExterno } }, convertToMp4: false },
  )
  if (!lido?.base64) throw new EvolutionApiError('A Evolution não devolveu o arquivo.', null)
  return { base64: lido.base64, mimetype: lido.mimetype ?? null, fileName: lido.fileName ?? null }
}

/**
 * `POST /chat/markMessageAsRead/{instance}`, corpo
 * `{ readMessages: [{ id, fromMe, remoteJid }] }` — os três obrigatórios.
 *
 * Fonte: `readMessageSchema` em src/validate/chat.schema.ts (2.3.7).
 */
export async function marcarComoLida(
  instancia: string,
  mensagens: Array<{ id: string; fromMe: boolean; remoteJid: string }>,
): Promise<void> {
  if (mensagens.length === 0) return
  await chamar(`/chat/markMessageAsRead/${inst(instancia)}`, 'POST', { readMessages: mensagens })
}

/**
 * `POST /webhook/set/{instance}`, corpo
 * `{ webhook: { enabled, url, byEvents, base64, events } }`.
 *
 * Fonte: webhook.router.ts e webhook.schema.ts (2.3.7): o corpo é EMBRULHADO
 * em `webhook`, só `enabled` e `url` são obrigatórios, e `MESSAGES_UPDATE`
 * está na lista de `EventController.events`. `base64: false` porque o webhook
 * com mídia embutida mandaria cada áudio inteiro no corpo do evento.
 */
export async function configurarWebhook(
  instancia: string,
  url: string,
  eventos: string[],
): Promise<void> {
  await chamar(`/webhook/set/${inst(instancia)}`, 'POST', {
    webhook: { enabled: true, url, byEvents: false, base64: false, events: eventos },
  })
}

// ─── Envio ──────────────────────────────────────────────────────────────────

type RespostaEnvio = { key?: { id?: string } }

function idDoEnvio(lido: RespostaEnvio | null): string {
  const id = lido?.key?.id
  /*
    200 sem id é resposta que não dá para conferir depois: o status de
    entregue/lido chega por id, e sem ele a mensagem ficaria "enviando" para
    sempre.
  */
  if (!id) throw new EvolutionApiError('A Evolution respondeu sem id da mensagem.', null)
  return id
}

/**
 * `POST /message/sendText/{instance}`, corpo `{ number, text, linkPreview }`.
 *
 * Fonte: `textMessageSchema` em src/validate/message.schema.ts (2.3.7) —
 * obrigatórios `number` e `text`. `number` aceita o jid completo, inclusive
 * `@lid`: `whatsappNumber` trata `@lid` como existente sem consultar.
 */
export async function enviarTexto(instancia: string, jid: string, texto: string): Promise<string> {
  const lido = await chamar<RespostaEnvio>(`/message/sendText/${inst(instancia)}`, 'POST', {
    number: jid,
    text: texto,
    linkPreview: false,
  })
  return idDoEnvio(lido)
}

export type TipoMidiaEnvio = 'image' | 'video' | 'document'

/**
 * `POST /message/sendMedia/{instance}`, corpo
 * `{ number, mediatype, mimetype, media, fileName, caption }`.
 *
 * Fonte: `mediaMessageSchema` (message.schema.ts) e `prepareMediaMessage`
 * (whatsapp.baileys.service.ts), 2.3.7. `media` é URL ou base64 PURO — sem o
 * prefixo `data:...;base64,`, que ela passaria direto para `Buffer.from` e
 * corromperia o arquivo.
 */
export async function enviarMidia(
  instancia: string,
  jid: string,
  midia: { tipo: TipoMidiaEnvio; base64: string; mimetype: string; nome: string; legenda?: string | null },
): Promise<string> {
  const lido = await chamar<RespostaEnvio>(`/message/sendMedia/${inst(instancia)}`, 'POST', {
    number: jid,
    mediatype: midia.tipo,
    mimetype: midia.mimetype,
    media: midia.base64,
    fileName: midia.nome,
    ...(midia.legenda ? { caption: midia.legenda } : {}),
  })
  return idDoEnvio(lido)
}

/**
 * `POST /message/sendWhatsAppAudio/{instance}`, corpo `{ number, audio }`.
 *
 * Fonte: `audioMessageSchema` (message.schema.ts) e `audioWhatsapp`
 * (whatsapp.baileys.service.ts), 2.3.7. `encoding` ausente vira `true`: a
 * Evolution converte o webm/ogg do navegador para opus e manda como áudio de
 * voz (a bolinha com microfone), e não como arquivo anexado.
 */
export async function enviarAudio(instancia: string, jid: string, base64: string): Promise<string> {
  const lido = await chamar<RespostaEnvio>(`/message/sendWhatsAppAudio/${inst(instancia)}`, 'POST', {
    number: jid,
    audio: base64,
  })
  return idDoEnvio(lido)
}

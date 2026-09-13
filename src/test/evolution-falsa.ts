import type { RegistroEvolution } from '@/domain/whatsapp/mensagem-evolution'
import type { ChatEvolution } from '@/infra/whatsapp/evolution-api'

/**
 * Uma Evolution de mentira, para a suíte nunca falar com WhatsApp nenhum.
 *
 * Substitui o `fetch` global e responde pelo CAMINHO, no formato da 2.3.7.
 * Guarda cada chamada: a asserção que importa quase sempre é "o que teria
 * saído" — e, na importação, "que NADA saiu".
 */

export type ChamadaEvolution = { rota: string; instancia: string; corpo: Record<string, unknown> }

export type OpcoesEvolutionFalsa = {
  chats?: ChatEvolution[]
  mensagens?: RegistroEvolution[]
  /** Faz as rotas de envio responderem com este HTTP de erro. */
  recusarEnvioCom?: number
  midia?: { base64: string; mimetype: string }
}

export function evolutionFalsa(opcoes: OpcoesEvolutionFalsa = {}) {
  const chamadas: ChamadaEvolution[] = []
  let proximoId = 1

  const responder = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

  const fetchFalso = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const caminho = new URL(String(url)).pathname
    const [, , rota = '', instancia = ''] = caminho.split('/')
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    chamadas.push({ rota, instancia: decodeURIComponent(instancia), corpo })

    switch (rota) {
      case 'findChats':
        return responder(opcoes.chats ?? [])
      case 'findMessages': {
        // Mesma paginação da 2.3.7: tamanho da página em `offset`.
        const todas = opcoes.mensagens ?? []
        const porPagina = Number(corpo.offset) || 50
        const pagina = Number(corpo.page) || 1
        return responder({
          messages: {
            total: todas.length,
            pages: Math.ceil(todas.length / porPagina),
            currentPage: pagina,
            records: todas.slice((pagina - 1) * porPagina, pagina * porPagina),
          },
        })
      }
      case 'sendText':
      case 'sendMedia':
      case 'sendWhatsAppAudio':
        if (opcoes.recusarEnvioCom) {
          return responder({ response: { message: ['número não existe'] } }, opcoes.recusarEnvioCom)
        }
        return responder({ key: { id: `SAIDA-${Date.now()}-${proximoId++}` }, status: 'PENDING' })
      case 'getBase64FromMediaMessage':
        return opcoes.midia ? responder(opcoes.midia) : responder({ message: 'not found' }, 400)
      case 'set':
      case 'markMessageAsRead':
        return responder({ ok: true })
      default:
        return responder({ message: `rota não simulada: ${caminho}` }, 404)
    }
  }

  return {
    fetch: fetchFalso,
    chamadas,
    enviadas: () => chamadas.filter((c) => c.rota.startsWith('send')),
  }
}

/** Registro no formato de `findMessages` / `messages.upsert`. */
export function registro(dados: {
  id: string
  jid: string
  fromMe?: boolean
  pushName?: string
  message: Record<string, unknown>
  segundos?: number
}): RegistroEvolution {
  return {
    key: { id: dados.id, fromMe: dados.fromMe ?? false, remoteJid: dados.jid },
    pushName: dados.pushName ?? null,
    messageType: Object.keys(dados.message)[0],
    message: dados.message,
    messageTimestamp: dados.segundos ?? Math.floor(Date.now() / 1000),
  }
}

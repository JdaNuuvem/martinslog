import type { TipoMensagemWhatsapp } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { DomainError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { baixarMidia } from '@/infra/whatsapp/evolution-api'

/**
 * O arquivo de uma mensagem com mídia, buscado na Evolution quando alguém abre.
 *
 * O banco guarda só os metadados. O binário mora na Evolution, que já o
 * guarda de qualquer jeito, e é baixado sob demanda — a maioria dos áudios de
 * uma conversa antiga nunca vai ser ouvida de novo.
 *
 * Cache em memória, pequeno e com teto em bytes: rolar a conversa para cima e
 * para baixo pede a mesma imagem várias vezes, e cada ida à Evolution é uma
 * ida ao WhatsApp. Pequeno porque é memória do processo da aplicação, que
 * não pode trocar estabilidade por miniatura.
 */

const MAX_ITENS = 40
const MAX_BYTES = 48 * 1024 * 1024

type ItemCache = { dados: Buffer; mimetype: string }

const cache = new Map<string, ItemCache>()
let bytesNoCache = 0

export const TIPOS_COM_MIDIA: readonly TipoMensagemWhatsapp[] = [
  'AUDIO',
  'IMAGEM',
  'VIDEO',
  'DOCUMENTO',
  'FIGURINHA',
]

export class MidiaIndisponivelError extends DomainError {
  readonly codigo = 'MIDIA_INDISPONIVEL'
}

/** Guarda no cache, despejando os mais antigos. Map preserva a ordem de inserção. */
export function guardarMidiaNoCache(mensagemId: string, item: ItemCache): void {
  // Um arquivo maior que um quarto do teto expulsaria o cache inteiro para
  // caber sozinho. Não compensa: ele é servido e esquecido.
  if (item.dados.length > MAX_BYTES / 4) return

  const anterior = cache.get(mensagemId)
  if (anterior) {
    bytesNoCache -= anterior.dados.length
    cache.delete(mensagemId)
  }
  cache.set(mensagemId, item)
  bytesNoCache += item.dados.length

  while (cache.size > MAX_ITENS || bytesNoCache > MAX_BYTES) {
    const maisAntigo = cache.keys().next().value
    if (maisAntigo === undefined) break
    bytesNoCache -= cache.get(maisAntigo)?.dados.length ?? 0
    cache.delete(maisAntigo)
  }
}

function lerDoCache(mensagemId: string): ItemCache | null {
  const item = cache.get(mensagemId)
  if (!item) return null
  // Tocar reinsere no fim: quem acabou de ser pedido é o último a sair.
  cache.delete(mensagemId)
  cache.set(mensagemId, item)
  return item
}

/** Só para teste: começar cada caso sem herança do anterior. */
export function limparCacheDeMidia(): void {
  cache.clear()
  bytesNoCache = 0
}

export type MidiaDaMensagem = {
  dados: Buffer
  mimetype: string
  nome: string | null
  tipo: TipoMensagemWhatsapp
}

/**
 * O binário da mídia, ou `null` quando a mensagem não existe, não é da conta
 * ou não tem mídia — os três viram 404 do mesmo jeito, para não confirmar a
 * quem sonda que aquele id existe em outra loja.
 */
export async function midiaDaMensagem(
  userId: string,
  mensagemId: string,
): Promise<MidiaDaMensagem | null> {
  const mensagem = await prisma.conversaMensagem.findUnique({
    where: { id: mensagemId },
    select: {
      tipo: true,
      idExterno: true,
      midiaMimetype: true,
      midiaNome: true,
      conversa: {
        select: { perfilId: true, loja: { select: { evolutionConfig: { select: { instancia: true } } } } },
      },
    },
  })
  if (!mensagem || !TIPOS_COM_MIDIA.includes(mensagem.tipo)) return null
  if (!(await acharPerfil(userId, mensagem.conversa.perfilId))) return null

  const emCache = lerDoCache(mensagemId)
  if (emCache) {
    return { ...emCache, nome: mensagem.midiaNome, tipo: mensagem.tipo }
  }

  const instancia = mensagem.conversa.loja.evolutionConfig?.instancia
  if (!mensagem.idExterno || !instancia) {
    throw new MidiaIndisponivelError('Este arquivo não está mais disponível no WhatsApp da loja.')
  }

  let baixada
  try {
    baixada = await baixarMidia(instancia, mensagem.idExterno)
  } catch (erro) {
    throw new MidiaIndisponivelError(
      erro instanceof Error ? erro.message : 'Não foi possível baixar o arquivo.',
      { cause: erro },
    )
  }

  const item: ItemCache = {
    dados: Buffer.from(baixada.base64, 'base64'),
    mimetype: mensagem.midiaMimetype ?? baixada.mimetype ?? 'application/octet-stream',
  }
  guardarMidiaNoCache(mensagemId, item)
  return { ...item, nome: mensagem.midiaNome ?? baixada.fileName, tipo: mensagem.tipo }
}

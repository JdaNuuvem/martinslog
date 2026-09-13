import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { DomainError } from '@/domain/errors'
import { env } from '@/env'
import { credenciaisDoServidor } from '@/infra/whatsapp'
import {
  buscarChats,
  buscarMensagens,
  configurarWebhook,
} from '@/infra/whatsapp/evolution-api'
import {
  jidDeConversa,
  lerMensagem,
  previaDe,
  statusDaEvolution,
  telefoneDoJid,
  type MensagemLida,
} from '@/domain/whatsapp/mensagem-evolution'
import { conversaDoJid } from '@/server/conversa-service'

/**
 * Trazer para a plataforma o que o celular da loja já tem.
 *
 * Existia porque não existia: a Evolution guardava 335 conversas e 2.352
 * mensagens do celular pareado, e a caixa de entrada mostrava zero — ela só
 * gravava mensagem NOVA, de TEXTO, RECEBIDA. Quem abre a tela quer ver o
 * WhatsApp da loja, não só o que chegou depois de alguém ligar o webhook.
 *
 * Idempotente por `idExterno`: rodar duas vezes não duplica nada, e é o que
 * permite disparar de três lugares (botão, reconexão, primeira abertura) sem
 * coordenar quem chega primeiro.
 *
 * NUNCA aciona robô nem aviso. É histórico: responder agora uma mensagem de
 * semana passada seria o robô falando sozinho com 335 pessoas de uma vez —
 * exatamente o padrão que faz a Meta banir o número.
 */

/** Por página na Evolution. Menos idas pelo túnel, sem estourar a resposta. */
const POR_PAGINA = 100
/** Freio de segurança: um `pages` errado da Evolution não vira laço infinito. */
const MAX_PAGINAS = 2_000
/** Importação que morreu no meio (deploy, queda) não pode travar a loja para sempre. */
const TRAVA_VENCE_MS = 15 * 60 * 1000

/** Eventos que a caixa de entrada precisa. A instância antiga só tinha os dois primeiros. */
export const EVENTOS_DO_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE']

export class SincronizacaoEmAndamentoError extends DomainError {
  readonly codigo = 'SINCRONIZACAO_EM_ANDAMENTO'
  constructor() {
    super('A importação do histórico desta loja já está rodando. Aguarde terminar.')
  }
}

export class SemInstanciaConectadaError extends DomainError {
  readonly codigo = 'SEM_CONEXAO'
  constructor() {
    super('Esta loja não está com o WhatsApp pareado pela Evolution.')
  }
}

export type ResultadoSincronizacao = { conversas: number; mensagens: number }

/**
 * Pega a trava num UPDATE só. Dois processos disputando fazem a mesma
 * escrita condicional, e o Postgres garante que só um vê `count = 1`.
 */
async function pegarTrava(perfilId: string): Promise<boolean> {
  const { count } = await prisma.evolutionConfig.updateMany({
    where: {
      perfilId,
      OR: [
        { sincronizandoDesde: null },
        { sincronizandoDesde: { lt: new Date(Date.now() - TRAVA_VENCE_MS) } },
      ],
    },
    data: { sincronizandoDesde: new Date() },
  })
  return count === 1
}

/**
 * (Re)aponta o webhook da instância, agora com `MESSAGES_UPDATE`.
 *
 * Melhor esforço: sem ele os tiques de entregue/lido não chegam, mas o
 * histórico continua valendo a pena importar.
 */
async function reconfigurarWebhook(instancia: string): Promise<void> {
  if (!env.EVOLUTION_WEBHOOK_TOKEN) return
  try {
    await configurarWebhook(
      instancia,
      `${env.APP_URL}/api/evolution/webhook/${env.EVOLUTION_WEBHOOK_TOKEN}`,
      EVENTOS_DO_WEBHOOK,
    )
  } catch (erro) {
    console.error('Falha ao reconfigurar o webhook da Evolution', { instancia, cause: erro })
  }
}

type ConversaEmMemoria = { id: string; nomeDeCliente: boolean }

export async function sincronizarHistorico(perfilId: string): Promise<ResultadoSincronizacao> {
  const config = await prisma.evolutionConfig.findUnique({
    where: { perfilId },
    select: { instancia: true, conectadoEm: true },
  })
  if (!config?.conectadoEm || !credenciaisDoServidor()) throw new SemInstanciaConectadaError()
  if (!(await pegarTrava(perfilId))) throw new SincronizacaoEmAndamentoError()

  try {
    await reconfigurarWebhook(config.instancia)

    const conversas = new Map<string, ConversaEmMemoria>()
    /** `pushName` das mensagens `fromMe`: é o nome da loja, nunca o do cliente. */
    const nomesDaLoja = new Set<string>()
    let inseridas = 0

    const conversaDe = async (lida: MensagemLida): Promise<ConversaEmMemoria> => {
      const nomeDoCliente = lida.fromMe ? null : lida.pushName
      const ja = conversas.get(lida.jid)
      // Mensagens vêm da mais nova para a mais velha: o primeiro nome de
      // cliente visto é o atual. Os seguintes são nomes antigos.
      if (ja && (ja.nomeDeCliente || !nomeDoCliente)) return ja

      const conversa = await conversaDoJid(perfilId, {
        jid: lida.jid,
        telefone: lida.telefone,
        nome: nomeDoCliente,
      })
      const registro = { id: conversa.id, nomeDeCliente: Boolean(nomeDoCliente) }
      conversas.set(lida.jid, registro)
      return registro
    }

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const resultado = await buscarMensagens(config.instancia, pagina, POR_PAGINA)
      const linhas: Prisma.ConversaMensagemCreateManyInput[] = []

      for (const registro of resultado.records) {
        const lida = lerMensagem(registro)
        if (!lida) continue
        if (lida.fromMe && lida.pushName) nomesDaLoja.add(lida.pushName)

        const conversa = await conversaDe(lida)
        const statusBruto = (registro as { status?: unknown }).status
        linhas.push({
          conversaId: conversa.id,
          // fromMe é alguém da loja pelo aparelho. Se a mensagem saiu pela
          // plataforma, ela já existe com o autor certo e o skipDuplicates a
          // preserva.
          autor: lida.fromMe ? 'ATENDENTE' : 'CLIENTE',
          tipo: lida.tipo,
          texto: lida.texto,
          status: lida.fromMe ? (statusDaEvolution(statusBruto) ?? 'ENVIADA') : 'ENVIADA',
          midiaMimetype: lida.midiaMimetype,
          midiaNome: lida.midiaNome,
          midiaTamanho: lida.midiaTamanho,
          midiaDuracao: lida.midiaDuracao,
          idExterno: lida.idExterno,
          ocorridoEm: lida.ocorridoEm,
          payload: registro as Prisma.InputJsonValue,
        })
      }

      if (linhas.length > 0) {
        const { count } = await prisma.conversaMensagem.createMany({ data: linhas, skipDuplicates: true })
        inseridas += count
      }

      if (resultado.records.length === 0 || pagina >= resultado.pages) break
    }

    /*
      Os chats trazem o que a mensagem não tem: foto, contador de não lidas e
      o nome de quem só recebeu mensagem da loja e nunca escreveu.
    */
    const chats = await buscarChats(config.instancia)
    const naoLidas: Array<{ id: string; naoLidas: number }> = []

    for (const chat of chats) {
      const jid = chat.remoteJid
      if (!jidDeConversa(jid)) continue

      const conhecida = conversas.get(jid)
      // Chat sem nenhuma mensagem importada seria uma linha vazia na lista.
      if (!conhecida && !chat.lastMessage) continue

      const nomeDoChat =
        chat.pushName && !nomesDaLoja.has(chat.pushName) && chat.lastMessage?.key?.fromMe !== true
          ? chat.pushName
          : null

      const conversa = await conversaDoJid(perfilId, {
        jid,
        telefone: telefoneDoJid(jid),
        nome: conhecida?.nomeDeCliente ? null : nomeDoChat,
        fotoUrl: chat.profilePicUrl ?? null,
      })
      conversas.set(jid, { id: conversa.id, nomeDeCliente: conhecida?.nomeDeCliente ?? false })
      naoLidas.push({ id: conversa.id, naoLidas: Math.max(0, chat.unreadCount ?? 0) })
    }

    for (let i = 0; i < naoLidas.length; i += 50) {
      await prisma.$transaction(
        naoLidas.slice(i, i + 50).map((c) =>
          prisma.conversa.update({ where: { id: c.id }, data: { naoLidas: c.naoLidas } }),
        ),
      )
    }

    await recalcularTopoDasConversas(perfilId)

    await prisma.evolutionConfig.update({
      where: { perfilId },
      data: { sincronizadoEm: new Date() },
    })

    return { conversas: conversas.size, mensagens: inseridas }
  } finally {
    await prisma.evolutionConfig
      .updateMany({ where: { perfilId }, data: { sincronizandoDesde: null } })
      .catch(() => null)
  }
}

/**
 * Ordem e prévia da lista, pela última mensagem de cada conversa.
 *
 * Uma leitura só (DISTINCT ON) e a prévia montada por `previaDe`, a mesma
 * função do webhook — em SQL seria uma segunda cópia do rótulo "Áudio".
 */
async function recalcularTopoDasConversas(perfilId: string): Promise<void> {
  const ultimas = await prisma.$queryRaw<
    Array<{ conversaId: string; ocorridoEm: Date; texto: string | null; tipo: MensagemLida['tipo'] }>
  >`
    SELECT DISTINCT ON (m."conversaId") m."conversaId", m."ocorridoEm", m."texto", m."tipo"::text AS "tipo"
    FROM "conversa_mensagens" m
    JOIN "conversas" c ON c."id" = m."conversaId"
    WHERE c."perfilId" = ${perfilId}
    ORDER BY m."conversaId", m."ocorridoEm" DESC
  `

  for (let i = 0; i < ultimas.length; i += 50) {
    await prisma.$transaction(
      ultimas.slice(i, i + 50).map((u) =>
        prisma.conversa.update({
          where: { id: u.conversaId },
          data: { ultimaMensagemEm: u.ocorridoEm, previa: previaDe(u.tipo, u.texto), previaTipo: u.tipo },
        }),
      ),
    )
  }
}

/**
 * Dispara sem esperar, para quem não pode segurar a resposta (o webhook).
 * "Já está rodando" é o caso normal de dois gatilhos juntos, não erro.
 */
export function dispararSincronizacao(perfilId: string): void {
  void sincronizarHistorico(perfilId).catch((erro) => {
    if (erro instanceof SincronizacaoEmAndamentoError) return
    console.error('Falha na importação do histórico do WhatsApp', { perfilId, cause: erro })
  })
}

/**
 * Primeira abertura da caixa de entrada de uma loja que nunca importou.
 *
 * Espera um pouco, e não até o fim: 2.352 mensagens levam mais que uma
 * requisição aguenta. O que não coube na espera aparece na próxima
 * atualização da lista, que a tela já faz sozinha.
 */
export async function sincronizacaoInicial(perfilId: string, esperaMs = 8_000): Promise<void> {
  const config = await prisma.evolutionConfig.findUnique({
    where: { perfilId },
    select: { conectadoEm: true, sincronizadoEm: true, sincronizandoDesde: true },
  })
  if (!config?.conectadoEm || config.sincronizadoEm || config.sincronizandoDesde) return
  if (!credenciaisDoServidor()) return

  const importacao = sincronizarHistorico(perfilId).catch((erro) => {
    if (!(erro instanceof SincronizacaoEmAndamentoError)) {
      console.error('Falha na importação inicial do WhatsApp', { perfilId, cause: erro })
    }
  })
  let alarme: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    importacao,
    new Promise<void>((resolver) => {
      alarme = setTimeout(resolver, esperaMs)
    }),
  ])
  clearTimeout(alarme)
}

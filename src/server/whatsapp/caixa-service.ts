import type {
  AutorMensagem,
  ConversaMensagem,
  Prisma,
  StatusMensagemWhatsapp,
  TipoMensagemWhatsapp,
} from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { credenciaisDoServidor } from '@/infra/whatsapp'
import { marcarComoLida } from '@/infra/whatsapp/evolution-api'
import { TIPOS_COM_MIDIA } from './midia-service'
import { sincronizacaoInicial } from './importacao-service'

/**
 * A caixa de entrada vista pela tela: lojas, conversas, mensagens.
 *
 * Toda função recebe `userId` e confere a posse da loja antes de ler. Conversa
 * de outra conta responde como inexistente — confirmar que ela existe já
 * diria que aquele contato falou com alguma loja daqui.
 */

const POR_PAGINA_CONVERSAS = 50
const LIMITE_MENSAGENS_PADRAO = 50
const LIMITE_MENSAGENS_MAXIMO = 200

export type LojaCaixa = { perfilId: string; nome: string; conectado: boolean; numero: string | null }

export type ResumoConversa = {
  id: string
  jid: string
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  ultimaMensagemEm: string
  previa: string | null
  previaTipo: TipoMensagemWhatsapp
  naoLidas: number
  roboPausado: boolean
}

export type MensagemCaixa = {
  id: string
  autor: AutorMensagem
  tipo: TipoMensagemWhatsapp
  texto: string | null
  midia: {
    url: string
    mimetype: string
    nome: string | null
    tamanho: number | null
    duracao: number | null
  } | null
  status: StatusMensagemWhatsapp
  erro: string | null
  ocorridoEm: string
}

/** Mimetype de quando a Evolution não disse: o navegador precisa de algum. */
const MIMETYPE_PADRAO: Partial<Record<TipoMensagemWhatsapp, string>> = {
  AUDIO: 'audio/ogg',
  IMAGEM: 'image/jpeg',
  VIDEO: 'video/mp4',
  FIGURINHA: 'image/webp',
  DOCUMENTO: 'application/octet-stream',
}

export function serializarMensagem(m: ConversaMensagem): MensagemCaixa {
  const temMidia = TIPOS_COM_MIDIA.includes(m.tipo)
  return {
    id: m.id,
    autor: m.autor,
    tipo: m.tipo,
    texto: m.texto,
    midia: temMidia
      ? {
          url: `/api/whatsapp/mensagens/${m.id}/midia`,
          mimetype: m.midiaMimetype ?? MIMETYPE_PADRAO[m.tipo] ?? 'application/octet-stream',
          nome: m.midiaNome,
          tamanho: m.midiaTamanho,
          duracao: m.midiaDuracao,
        }
      : null,
    status: m.status,
    erro: m.erro,
    ocorridoEm: m.ocorridoEm.toISOString(),
  }
}

export async function listarLojas(userId: string): Promise<LojaCaixa[]> {
  const perfis = await prisma.perfil.findMany({
    where: { userId },
    orderBy: { criadoEm: 'asc' },
    select: {
      id: true,
      nome: true,
      nomeExibicao: true,
      evolutionConfig: { select: { conectadoEm: true, numero: true } },
    },
  })
  return perfis.map((p) => ({
    perfilId: p.id,
    // O identificador junto do nome de exibição: lojas diferentes podem usar a
    // mesma marca, e escolher a loja errada no seletor é responder pelo celular
    // errado.
    nome: p.nomeExibicao && p.nomeExibicao !== p.nome ? `${p.nomeExibicao} (${p.nome})` : p.nome,
    conectado: Boolean(p.evolutionConfig?.conectadoEm),
    numero: p.evolutionConfig?.numero ?? null,
  }))
}

/**
 * A loja da caixa de entrada: a pedida, se for da conta; sem pedido, a
 * primeira com celular pareado — é a que tem conversa para mostrar. `null`
 * quando a conta não tem loja nenhuma.
 */
export async function lojaDaCaixa(userId: string, perfilId?: string | null): Promise<string | null> {
  if (perfilId) {
    if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
    return perfilId
  }
  const lojas = await listarLojas(userId)
  return (lojas.find((l) => l.conectado) ?? lojas[0])?.perfilId ?? null
}

type Cursor = { t: string; id: string }

function lerCursor(bruto: string | null | undefined): Cursor | null {
  if (!bruto) return null
  try {
    const lido = JSON.parse(Buffer.from(bruto, 'base64url').toString('utf8')) as Cursor
    return typeof lido.t === 'string' && typeof lido.id === 'string' && !Number.isNaN(Date.parse(lido.t))
      ? lido
      : null
  } catch {
    // Cursor adulterado volta ao começo em vez de derrubar a tela.
    return null
  }
}

function escreverCursor(c: { ultimaMensagemEm: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: c.ultimaMensagemEm.toISOString(), id: c.id })).toString('base64url')
}

export async function listarConversasCaixa(
  userId: string,
  filtro: { perfilId?: string | null; busca?: string | null; cursor?: string | null },
): Promise<{ conversas: ResumoConversa[]; proximoCursor: string | null }> {
  const perfilId = await lojaDaCaixa(userId, filtro.perfilId)
  if (!perfilId) return { conversas: [], proximoCursor: null }

  await sincronizacaoInicial(perfilId)

  const busca = filtro.busca?.trim().slice(0, 100)
  const cursor = lerCursor(filtro.cursor)

  const condicoes: Prisma.ConversaWhereInput[] = [{ perfilId }]
  if (busca) {
    condicoes.push({
      OR: [
        { nomeContato: { contains: busca, mode: 'insensitive' } },
        { telefone: { contains: busca.replace(/\D/g, '') || busca } },
        { jid: { contains: busca, mode: 'insensitive' } },
        { mensagens: { some: { texto: { contains: busca, mode: 'insensitive' } } } },
      ],
    })
  }
  if (cursor) {
    const t = new Date(cursor.t)
    condicoes.push({
      OR: [{ ultimaMensagemEm: { lt: t } }, { ultimaMensagemEm: t, id: { lt: cursor.id } }],
    })
  }

  const linhas = await prisma.conversa.findMany({
    where: { AND: condicoes },
    orderBy: [{ ultimaMensagemEm: 'desc' }, { id: 'desc' }],
    take: POR_PAGINA_CONVERSAS + 1,
  })

  const temMais = linhas.length > POR_PAGINA_CONVERSAS
  const pagina = linhas.slice(0, POR_PAGINA_CONVERSAS)
  const agora = Date.now()

  return {
    conversas: pagina.map((c) => ({
      id: c.id,
      jid: c.jid,
      telefone: c.telefone,
      nome: c.nomeContato,
      fotoUrl: c.fotoUrl,
      ultimaMensagemEm: c.ultimaMensagemEm.toISOString(),
      previa: c.previa,
      previaTipo: c.previaTipo,
      naoLidas: c.naoLidas,
      roboPausado: Boolean(c.roboPausadoAte && c.roboPausadoAte.getTime() > agora),
    })),
    proximoCursor: temMais ? escreverCursor(pagina[pagina.length - 1]!) : null,
  }
}

/** A conversa, se for da conta. Qualquer outro caso é "não encontrada". */
export async function conversaDaConta(userId: string, conversaId: string) {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } })
  if (!conversa || !(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }
  return conversa
}

/**
 * Referência de paginação: data ISO ou id de mensagem da própria conversa.
 * Aceitar os dois deixa a tela usar o que tiver à mão.
 */
async function referencia(
  conversaId: string,
  bruto: string | null | undefined,
): Promise<{ ocorridoEm: Date; id: string | null } | null> {
  if (!bruto) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(bruto) && !Number.isNaN(Date.parse(bruto))) {
    return { ocorridoEm: new Date(bruto), id: null }
  }
  const mensagem = await prisma.conversaMensagem.findFirst({
    where: { id: bruto, conversaId },
    select: { ocorridoEm: true, id: true },
  })
  return mensagem
}

export async function listarMensagens(
  userId: string,
  conversaId: string,
  filtro: { antesDe?: string | null; depoisDe?: string | null; limite?: number | null },
): Promise<{ mensagens: MensagemCaixa[]; temMais: boolean }> {
  await conversaDaConta(userId, conversaId)

  const limite = Math.min(
    LIMITE_MENSAGENS_MAXIMO,
    Math.max(1, Math.trunc(filtro.limite || LIMITE_MENSAGENS_PADRAO)),
  )

  if (filtro.depoisDe) {
    const ref = await referencia(conversaId, filtro.depoisDe)
    const linhas = await prisma.conversaMensagem.findMany({
      where: {
        conversaId,
        ...(ref
          ? {
              OR: [
                { ocorridoEm: { gt: ref.ocorridoEm } },
                ...(ref.id ? [{ ocorridoEm: ref.ocorridoEm, id: { gt: ref.id } }] : []),
              ],
            }
          : {}),
      },
      orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }],
      take: limite + 1,
    })
    return {
      mensagens: linhas.slice(0, limite).map(serializarMensagem),
      temMais: linhas.length > limite,
    }
  }

  const ref = await referencia(conversaId, filtro.antesDe)
  const linhas = await prisma.conversaMensagem.findMany({
    where: {
      conversaId,
      ...(ref
        ? {
            OR: [
              { ocorridoEm: { lt: ref.ocorridoEm } },
              ...(ref.id ? [{ ocorridoEm: ref.ocorridoEm, id: { lt: ref.id } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
    take: limite + 1,
  })
  return {
    mensagens: linhas.slice(0, limite).reverse().map(serializarMensagem),
    temMais: linhas.length > limite,
  }
}

/**
 * Zera o contador e avisa o WhatsApp, para os tiques azuis aparecerem no
 * celular do cliente como apareceriam se a loja lesse pelo aparelho.
 *
 * O aviso é melhor esforço: a Evolution fora não pode impedir o atendente de
 * limpar a própria caixa de entrada.
 */
export async function marcarConversaLida(userId: string, conversaId: string): Promise<void> {
  const conversa = await conversaDaConta(userId, conversaId)
  await prisma.conversa.update({ where: { id: conversaId }, data: { naoLidas: 0 } })

  const config = await prisma.evolutionConfig.findUnique({
    where: { perfilId: conversa.perfilId },
    select: { instancia: true, conectadoEm: true },
  })
  if (!config?.conectadoEm || !credenciaisDoServidor()) return

  const recebidas = await prisma.conversaMensagem.findMany({
    where: { conversaId, autor: 'CLIENTE', idExterno: { not: null } },
    orderBy: { ocorridoEm: 'desc' },
    take: Math.max(conversa.naoLidas, 1),
    select: { idExterno: true },
  })

  try {
    await marcarComoLida(
      config.instancia,
      recebidas.map((m) => ({ id: m.idExterno!, fromMe: false, remoteJid: conversa.jid })),
    )
  } catch (erro) {
    console.error('Falha ao marcar a conversa como lida na Evolution', { conversaId, cause: erro })
  }
}

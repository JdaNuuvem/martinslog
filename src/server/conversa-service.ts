import type { AutorMensagem, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { credenciaisDoServidor, whatsappProvider } from '@/infra/whatsapp'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'

/**
 * Conversa com o comprador: guardar o que chega, mandar o que sai, e decidir
 * quando o robô deve ficar calado.
 *
 * Entrada e saída moram na mesma lista porque é assim que uma conversa se lê.
 * O que muda entre elas é só o autor.
 */

/**
 * Quanto tempo o robô fica calado depois que um humano responde.
 *
 * Prazo, e não interruptor: ninguém lembra de devolver a conversa ao robô
 * depois de atender, e sem expirar sozinho toda conversa tocada uma vez
 * ficaria sem automação para sempre. Meia hora cobre o vaivém de um
 * atendimento sem prender a conversa até o dia seguinte.
 */
const PAUSA_DO_ROBO_MINUTOS = 30

export type ResumoConversa = {
  id: string
  contato: string
  nomeContato: string | null
  ultimaMensagemEm: Date
  naoLidas: number
  roboPausado: boolean
  previa: string | null
}

/** Achar ou criar a conversa daquele telefone naquela loja. */
async function conversaDoContato(perfilId: string, contato: string, nomeContato?: string | null) {
  return prisma.conversa.upsert({
    where: { perfilId_contato: { perfilId, contato } },
    create: { perfilId, contato, nomeContato: nomeContato ?? null },
    // O nome muda quando a pessoa troca no WhatsApp. Só sobrescreve com valor
    // presente: um push name ausente não deve apagar o que já se sabia.
    update: nomeContato ? { nomeContato } : {},
  })
}

/**
 * Grava o que o comprador escreveu.
 *
 * Idempotente por `idExterno`: o webhook reentrega quando não recebe 200 a
 * tempo, e sem isso a mesma mensagem apareceria duas vezes na tela.
 */
export async function registrarEntrada(entrada: {
  perfilId: string
  contato: string
  nomeContato?: string | null
  texto: string
  idExterno: string
  ocorridoEm: Date
  payload: Prisma.InputJsonValue
}): Promise<{ conversaId: string; repetida: boolean } | null> {
  const jaExiste = await prisma.conversaMensagem.findUnique({
    where: { idExterno: entrada.idExterno },
    select: { conversaId: true },
  })
  if (jaExiste) return { conversaId: jaExiste.conversaId, repetida: true }

  const conversa = await conversaDoContato(entrada.perfilId, entrada.contato, entrada.nomeContato)

  await prisma.$transaction([
    prisma.conversaMensagem.create({
      data: {
        conversaId: conversa.id,
        autor: 'CLIENTE',
        texto: entrada.texto,
        idExterno: entrada.idExterno,
        ocorridoEm: entrada.ocorridoEm,
        payload: entrada.payload,
      },
    }),
    prisma.conversa.update({
      where: { id: conversa.id },
      data: {
        ultimaMensagemEm: entrada.ocorridoEm,
        naoLidas: { increment: 1 },
      },
    }),
  ])

  return { conversaId: conversa.id, repetida: false }
}

/**
 * Manda uma mensagem pela conversa e registra o que aconteceu.
 *
 * `autor` separa o que o robô respondeu do que uma pessoa escreveu. Os dois
 * saem pelo mesmo número — a distinção é para o painel, não para o comprador.
 *
 * Quando é ATENDENTE, o robô é silenciado: duas respostas para a mesma
 * pergunta, uma humana e uma automática, é pior que só a automática.
 */
export async function enviarNaConversa(entrada: {
  perfilId: string
  contato: string
  texto: string
  autor: Extract<AutorMensagem, 'ROBO' | 'ATENDENTE'>
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const para = normalizarTelefone(entrada.contato)
  if (!para) return { ok: false, erro: 'Telefone inválido.' }

  const loja = await prisma.perfil.findUnique({
    where: { id: entrada.perfilId },
    select: { whatsappProvedor: true, evolutionConfig: true },
  })

  const conversa = await conversaDoContato(entrada.perfilId, entrada.contato)

  const servidor = credenciaisDoServidor()
  if (loja?.whatsappProvedor !== 'EVOLUTION' || !servidor || !loja.evolutionConfig?.conectadoEm) {
    /*
      Só pela Evolution. A API oficial da Meta não manda texto livre fora da
      janela de 24h — ela exigiria um template aprovado, e uma resposta de
      atendimento não é template.

      Grava a tentativa com o motivo em vez de só devolver o erro. Sem isto, o
      que o atendente escreveu desaparecia da tela junto com o aviso de falha,
      e ele não tinha como saber se chegou a mandar — nem o que tinha escrito.
    */
    const motivo = 'Esta loja não está com o WhatsApp pareado pela Evolution.'
    await prisma.conversaMensagem.create({
      data: {
        conversaId: conversa.id,
        autor: entrada.autor,
        texto: entrada.texto,
        erro: motivo,
      },
    })
    return { ok: false, erro: motivo }
  }

  const resultado = await whatsappProvider('EVOLUTION').enviar(
    {
      tipo: 'EVOLUTION',
      baseUrl: servidor.baseUrl,
      apiKey: servidor.apiKey,
      instancia: loja.evolutionConfig.instancia,
    },
    { para, texto: entrada.texto, template: null },
  )

  const agora = new Date()

  await prisma.$transaction([
    prisma.conversaMensagem.create({
      data: {
        conversaId: conversa.id,
        autor: entrada.autor,
        texto: entrada.texto,
        // Mensagem que não saiu fica registrada com o motivo, em vez de
        // sumir: o atendente precisa ver que a resposta dele não chegou.
        idExterno: resultado.ok ? resultado.idExterno : null,
        erro: resultado.ok ? null : resultado.mensagem,
        ocorridoEm: agora,
      },
    }),
    prisma.conversa.update({
      where: { id: conversa.id },
      data: {
        ultimaMensagemEm: agora,
        ...(entrada.autor === 'ATENDENTE'
          ? {
              naoLidas: 0,
              roboPausadoAte: new Date(agora.getTime() + PAUSA_DO_ROBO_MINUTOS * 60 * 1000),
            }
          : {}),
      },
    }),
  ])

  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.mensagem }
}

/** O robô deve responder nesta conversa, ou um humano assumiu? */
export async function roboPodeResponder(conversaId: string): Promise<boolean> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: { roboPausadoAte: true },
  })
  if (!conversa?.roboPausadoAte) return true
  return conversa.roboPausadoAte.getTime() <= Date.now()
}

export async function listarConversas(
  userId: string,
  perfilId: string,
): Promise<ResumoConversa[]> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const conversas = await prisma.conversa.findMany({
    where: { perfilId },
    orderBy: { ultimaMensagemEm: 'desc' },
    take: 100,
    include: {
      // Só a última, para a prévia da lista. Carregar o histórico inteiro de
      // cem conversas para mostrar uma linha de cada seria o caminho curto
      // para a tela demorar a abrir.
      mensagens: { orderBy: { ocorridoEm: 'desc' }, take: 1, select: { texto: true } },
    },
  })

  const agora = Date.now()
  return conversas.map((c) => ({
    id: c.id,
    contato: c.contato,
    nomeContato: c.nomeContato,
    ultimaMensagemEm: c.ultimaMensagemEm,
    naoLidas: c.naoLidas,
    roboPausado: Boolean(c.roboPausadoAte && c.roboPausadoAte.getTime() > agora),
    previa: c.mensagens[0]?.texto ?? null,
  }))
}

export async function lerConversa(userId: string, conversaId: string) {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { mensagens: { orderBy: { ocorridoEm: 'asc' }, take: 200 } },
  })
  if (!conversa) return null
  if (!(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }

  // Abrir a conversa é o ato de ler. Zerar aqui evita um botão "marcar como
  // lida" que ninguém clica e um contador que nunca zera.
  if (conversa.naoLidas > 0) {
    await prisma.conversa.update({ where: { id: conversaId }, data: { naoLidas: 0 } })
  }

  return conversa
}

/** Assume a conversa: o robô fica calado pelo prazo padrão. */
export async function assumirConversa(userId: string, conversaId: string): Promise<Date> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: { perfilId: true },
  })
  if (!conversa) throw new NaoAutorizadoError('Conversa não encontrada.')
  if (!(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }

  const ate = new Date(Date.now() + PAUSA_DO_ROBO_MINUTOS * 60 * 1000)
  await prisma.conversa.update({ where: { id: conversaId }, data: { roboPausadoAte: ate } })
  return ate
}

/** Devolve a conversa ao robô antes do prazo. */
export async function devolverAoRobo(userId: string, conversaId: string): Promise<void> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: { perfilId: true },
  })
  if (!conversa) throw new NaoAutorizadoError('Conversa não encontrada.')
  if (!(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }
  await prisma.conversa.update({ where: { id: conversaId }, data: { roboPausadoAte: null } })
}

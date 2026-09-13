import { Prisma } from '@prisma/client'
import type { AutorMensagem, StatusMensagemWhatsapp } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import {
  jidDoTelefone,
  previaDe,
  statusAnterioresA,
  telefoneDoJid,
  type MensagemLida,
} from '@/domain/whatsapp/mensagem-evolution'
import { enviarConteudo, PAUSA_DO_ROBO_MINUTOS } from '@/server/whatsapp/envio-service'
import { registrarLead } from './lead-service'

/**
 * Conversa com o comprador: guardar o que chega, mandar o que sai, e decidir
 * quando o robô deve ficar calado.
 *
 * Entrada e saída moram na mesma lista porque é assim que uma conversa se lê.
 * O que muda entre elas é só o autor.
 */

export { PAUSA_DO_ROBO_MINUTOS }

function colisaoDeChave(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

/**
 * Achar ou criar a conversa daquele contato naquela loja.
 *
 * Procura pelo jid e, quando se sabe o telefone, também pelo jid de telefone:
 * a mesma pessoa pode ter aparecido antes como `...@s.whatsapp.net` e agora
 * como `...@lid`. Duas conversas para a mesma pessoa partiriam o histórico ao
 * meio, e o atendente responderia sem ver o que já foi dito.
 */
export async function conversaDoJid(
  perfilId: string,
  dados: { jid: string; telefone?: string | null; nome?: string | null; fotoUrl?: string | null },
): Promise<{ id: string; perfilId: string; jid: string; telefone: string | null; criada: boolean; ultimaMensagemEm: Date }> {
  const candidatos = [dados.jid]
  if (dados.telefone) candidatos.push(jidDoTelefone(dados.telefone))

  const achadas = await prisma.conversa.findMany({
    where: { perfilId, jid: { in: candidatos } },
    select: { id: true, perfilId: true, jid: true, telefone: true, nomeContato: true, ultimaMensagemEm: true },
  })
  const existente = achadas.find((c) => c.jid === dados.jid) ?? achadas[0]

  if (existente) {
    // Só sobrescreve com valor presente: um push name ausente não deve apagar
    // o que já se sabia.
    const mudancas = {
      ...(dados.telefone && !existente.telefone ? { telefone: dados.telefone } : {}),
      ...(dados.nome && dados.nome !== existente.nomeContato ? { nomeContato: dados.nome } : {}),
      ...(dados.fotoUrl ? { fotoUrl: dados.fotoUrl } : {}),
    }
    if (Object.keys(mudancas).length > 0) {
      await prisma.conversa.update({ where: { id: existente.id }, data: mudancas })
    }
    return { ...existente, telefone: existente.telefone ?? dados.telefone ?? null, criada: false }
  }

  try {
    const criada = await prisma.conversa.create({
      data: {
        perfilId,
        jid: dados.jid,
        telefone: dados.telefone ?? null,
        nomeContato: dados.nome ?? null,
        fotoUrl: dados.fotoUrl ?? null,
      },
      select: { id: true, perfilId: true, jid: true, telefone: true, ultimaMensagemEm: true },
    })
    return { ...criada, criada: true }
  } catch (erro) {
    // Duas mensagens da mesma pessoa nova chegando juntas: a outra criou.
    if (!colisaoDeChave(erro)) throw erro
    const outra = await prisma.conversa.findUniqueOrThrow({
      where: { perfilId_jid: { perfilId, jid: dados.jid } },
      select: { id: true, perfilId: true, jid: true, telefone: true, ultimaMensagemEm: true },
    })
    return { ...outra, criada: false }
  }
}

/**
 * Grava uma mensagem que chegou pelo webhook — do cliente, ou do próprio
 * celular da loja (`fromMe`).
 *
 * Idempotente por `idExterno`: o webhook reentrega quando não recebe 200 a
 * tempo, e sem isso a mesma mensagem apareceria duas vezes na tela.
 *
 * `fromMe` vira ATENDENTE: é alguém da loja respondendo pelo aparelho. Não
 * conta como não lida e não passa pelo robô. O `pushName` dela é o nome da
 * LOJA, então não vira nome da conversa.
 */
export async function registrarMensagem(entrada: {
  perfilId: string
  lida: MensagemLida
  payload?: Prisma.InputJsonValue
}): Promise<{ conversaId: string; repetida: boolean; telefone: string | null }> {
  const { lida } = entrada

  const jaExiste = await prisma.conversaMensagem.findUnique({
    where: { idExterno: lida.idExterno },
    select: { conversa: { select: { id: true, telefone: true } } },
  })
  if (jaExiste) {
    return { conversaId: jaExiste.conversa.id, repetida: true, telefone: jaExiste.conversa.telefone }
  }

  const autor: AutorMensagem = lida.fromMe ? 'ATENDENTE' : 'CLIENTE'
  const conversa = await conversaDoJid(entrada.perfilId, {
    jid: lida.jid,
    telefone: lida.telefone,
    nome: lida.fromMe ? null : lida.pushName,
  })

  // Mensagem atrasada (reentrega de ontem) não pode jogar a conversa para o
  // topo nem trocar a prévia pela de uma mensagem mais velha.
  const maisNova = conversa.criada || lida.ocorridoEm >= conversa.ultimaMensagemEm

  try {
    await prisma.$transaction([
      prisma.conversaMensagem.create({
        data: {
          conversaId: conversa.id,
          autor,
          tipo: lida.tipo,
          texto: lida.texto,
          status: 'ENVIADA',
          midiaMimetype: lida.midiaMimetype,
          midiaNome: lida.midiaNome,
          midiaTamanho: lida.midiaTamanho,
          midiaDuracao: lida.midiaDuracao,
          idExterno: lida.idExterno,
          ocorridoEm: lida.ocorridoEm,
          payload: entrada.payload,
        },
      }),
      prisma.conversa.update({
        where: { id: conversa.id },
        data: {
          ...(maisNova
            ? {
                ultimaMensagemEm: lida.ocorridoEm,
                previa: previaDe(lida.tipo, lida.texto),
                previaTipo: lida.tipo,
              }
            : {}),
          ...(autor === 'CLIENTE' ? { naoLidas: { increment: 1 } } : {}),
        },
      }),
    ])
  } catch (erro) {
    // A reentrega passou pela checagem junto com a original.
    if (colisaoDeChave(erro)) return { conversaId: conversa.id, repetida: true, telefone: conversa.telefone }
    throw erro
  }

  /*
    Quem chama a loja no WhatsApp entra na base mesmo sem ter comprado — é o
    lead no sentido literal. Só com telefone: um `@lid` não reconhece ninguém
    da próxima vez.
  */
  if (autor === 'CLIENTE' && conversa.telefone) {
    try {
      await registrarLead({
        tipo: 'CONVERSA',
        perfilId: entrada.perfilId,
        conversaId: conversa.id,
        ocorridoEm: lida.ocorridoEm,
        nome: lida.pushName,
        telefone: conversa.telefone,
      })
    } catch (error) {
      console.error('Falha ao registrar o lead da conversa', { cause: error })
    }
  }

  return { conversaId: conversa.id, repetida: false, telefone: conversa.telefone }
}

/**
 * Tique de entregue/lido vindo de `messages.update`. Só avança: o evento chega
 * fora de ordem, e um "entregue" atrasado não desfaz um "lido".
 */
export async function atualizarStatusMensagem(
  perfilId: string,
  idExterno: string,
  status: StatusMensagemWhatsapp,
): Promise<number> {
  const { count } = await prisma.conversaMensagem.updateMany({
    // Pela loja da instância: o evento de uma instância não mexe em mensagem
    // de outra loja, ainda que alguém forje o id.
    where: { idExterno, conversa: { perfilId }, status: { in: statusAnterioresA(status) } },
    data: { status },
  })
  return count
}

/**
 * Manda um texto pela conversa de um contato, por telefone ou jid.
 *
 * É a porta de quem não tem a conversa aberta: robô, campanha, confirmação do
 * "PARE". `automatico` diz se o disparo é da máquina — e aí só sai por loja
 * com provedor EVOLUTION — ou resposta a um pedido da própria pessoa.
 */
export async function enviarNaConversa(entrada: {
  perfilId: string
  contato?: string
  jid?: string
  texto: string
  autor: Extract<AutorMensagem, 'ROBO' | 'ATENDENTE'>
  automatico?: boolean
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const telefoneNormalizado = entrada.contato ? normalizarTelefone(entrada.contato) : null
  const jid = entrada.jid ?? (telefoneNormalizado ? jidDoTelefone(telefoneNormalizado) : null)
  if (!jid) return { ok: false, erro: 'Telefone inválido.' }

  const conversa = await conversaDoJid(entrada.perfilId, {
    jid,
    telefone: telefoneDoJid(jid) ?? telefoneNormalizado,
  })

  const resultado = await enviarConteudo({
    conversa,
    autor: entrada.autor,
    conteudo: { tipo: 'texto', texto: entrada.texto },
    exigirProvedorEvolution: entrada.automatico ?? entrada.autor === 'ROBO',
  })
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro }
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

async function exigirConversaDaConta(userId: string, conversaId: string): Promise<void> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: { perfilId: true },
  })
  if (!conversa || !(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }
}

/** Assume a conversa: o robô fica calado pelo prazo padrão. */
export async function assumirConversa(userId: string, conversaId: string): Promise<Date> {
  await exigirConversaDaConta(userId, conversaId)
  const ate = new Date(Date.now() + PAUSA_DO_ROBO_MINUTOS * 60 * 1000)
  await prisma.conversa.update({ where: { id: conversaId }, data: { roboPausadoAte: ate } })
  return ate
}

/** Devolve a conversa ao robô antes do prazo. */
export async function devolverAoRobo(userId: string, conversaId: string): Promise<void> {
  await exigirConversaDaConta(userId, conversaId)
  await prisma.conversa.update({ where: { id: conversaId }, data: { roboPausadoAte: null } })
}

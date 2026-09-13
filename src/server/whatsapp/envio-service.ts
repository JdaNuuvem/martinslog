import { Prisma } from '@prisma/client'
import type { AutorMensagem, ConversaMensagem, TipoMensagemWhatsapp } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { DomainError } from '@/domain/errors'
import { credenciaisDoServidor } from '@/infra/whatsapp'
import {
  enviarAudio,
  enviarMidia,
  enviarTexto,
  type TipoMidiaEnvio,
} from '@/infra/whatsapp/evolution-api'
import { previaDe } from '@/domain/whatsapp/mensagem-evolution'
import { guardarMidiaNoCache } from './midia-service'

/**
 * Mandar algo numa conversa: texto, arquivo ou áudio gravado.
 *
 * A mensagem é gravada ANTES de ir para a Evolution, como ENVIANDO. Na ordem
 * inversa, uma queda no meio do envio deixaria a pessoa sem registro do que
 * escreveu — e sem saber se chegou a sair.
 */

/** Teto do WhatsApp para mídia comum. Acima disto a Evolution recusa depois de receber tudo. */
export const LIMITE_ARQUIVO_BYTES = 16 * 1024 * 1024

/**
 * Quanto tempo o robô fica calado depois que um humano responde.
 *
 * Prazo, e não interruptor: ninguém lembra de devolver a conversa ao robô
 * depois de atender, e sem expirar sozinho toda conversa tocada uma vez
 * ficaria sem automação para sempre. Meia hora cobre o vaivém de um
 * atendimento sem prender a conversa até o dia seguinte.
 */
export const PAUSA_DO_ROBO_MINUTOS = 30

export class ArquivoGrandeDemaisError extends DomainError {
  readonly codigo = 'ARQUIVO_GRANDE_DEMAIS'
  constructor() {
    super('O arquivo passa de 16 MB, o limite do WhatsApp. Envie um arquivo menor.')
  }
}

export class ConteudoVazioError extends DomainError {
  readonly codigo = 'CORPO_INVALIDO'
}

export type ConteudoEnvio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'arquivo'; dados: Buffer; mimetype: string; nome: string; legenda?: string | null }
  | { tipo: 'audio'; dados: Buffer; mimetype: string; duracao?: number | null }

export type ResultadoEnvioConversa =
  | { ok: true; mensagem: ConversaMensagem }
  | { ok: false; motivo: 'sem-conexao' | 'recusado'; erro: string; mensagem: ConversaMensagem }

/**
 * Imagem e vídeo só nos formatos que o WhatsApp mostra inline. O resto vai
 * como documento: um SVG mandado como imagem chega quebrado, e como arquivo
 * chega inteiro.
 */
function comoEnviar(mimetype: string): { tipo: TipoMensagemWhatsapp; midia: TipoMidiaEnvio } {
  const base = mimetype.split(';')[0]?.trim().toLowerCase() ?? ''
  if (['image/jpeg', 'image/png', 'image/webp'].includes(base)) return { tipo: 'IMAGEM', midia: 'image' }
  if (['video/mp4', 'video/3gpp'].includes(base)) return { tipo: 'VIDEO', midia: 'video' }
  return { tipo: 'DOCUMENTO', midia: 'document' }
}

function validar(conteudo: ConteudoEnvio): void {
  if (conteudo.tipo === 'texto') {
    if (!conteudo.texto.trim()) throw new ConteudoVazioError('Escreva alguma coisa antes de enviar.')
    return
  }
  if (conteudo.dados.length === 0) throw new ConteudoVazioError('O arquivo veio vazio.')
  if (conteudo.dados.length > LIMITE_ARQUIVO_BYTES) throw new ArquivoGrandeDemaisError()
}

/**
 * Grava o id que a Evolution devolveu, engolindo o eco.
 *
 * O WhatsApp devolve a nossa própria mensagem pelo webhook `messages.upsert`
 * com `fromMe`, e às vezes esse eco chega ANTES da resposta HTTP do envio. O
 * webhook não acha o id (ainda não gravamos) e cria uma cópia. Aqui a cópia
 * sai e a original fica — ela é que sabe se foi o robô ou o atendente.
 */
async function gravarIdExterno(mensagemId: string, idExterno: string): Promise<ConversaMensagem> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const [, atualizada] = await prisma.$transaction([
        prisma.conversaMensagem.deleteMany({ where: { idExterno, NOT: { id: mensagemId } } }),
        prisma.conversaMensagem.update({
          where: { id: mensagemId },
          data: { idExterno, status: 'ENVIADA', erro: null },
        }),
      ])
      return atualizada
    } catch (erro) {
      // O eco pode cair entre o delete e o update. Uma segunda volta resolve.
      const colidiu = erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
      if (!colidiu || tentativa >= 1) throw erro
    }
  }
}

export async function enviarConteudo(entrada: {
  conversa: { id: string; perfilId: string; jid: string }
  autor: Extract<AutorMensagem, 'ROBO' | 'ATENDENTE'>
  conteudo: ConteudoEnvio
  /**
   * Disparo automático (robô, campanha) só sai por loja com provedor
   * EVOLUTION: é o provedor que diz por onde a loja QUER falar sozinha.
   * Resposta de uma pessoa numa conversa aberta só precisa do celular
   * pareado — é o mesmo que ela responder pelo próprio aparelho.
   */
  exigirProvedorEvolution: boolean
}): Promise<ResultadoEnvioConversa> {
  const { conversa, conteudo, autor } = entrada
  validar(conteudo)

  const loja = await prisma.perfil.findUnique({
    where: { id: conversa.perfilId },
    select: {
      whatsappProvedor: true,
      evolutionConfig: { select: { instancia: true, conectadoEm: true } },
    },
  })

  const comoMidia = conteudo.tipo === 'arquivo' ? comoEnviar(conteudo.mimetype) : null
  const tipo: TipoMensagemWhatsapp =
    conteudo.tipo === 'texto' ? 'TEXTO' : conteudo.tipo === 'audio' ? 'AUDIO' : comoMidia!.tipo
  const texto =
    conteudo.tipo === 'texto' ? conteudo.texto : conteudo.tipo === 'arquivo' ? conteudo.legenda || null : null
  const agora = new Date()

  const mensagem = await prisma.conversaMensagem.create({
    data: {
      conversaId: conversa.id,
      autor,
      tipo,
      texto,
      status: 'ENVIANDO',
      ocorridoEm: agora,
      ...(conteudo.tipo === 'texto'
        ? {}
        : {
            midiaMimetype: conteudo.mimetype,
            midiaNome: conteudo.tipo === 'arquivo' ? conteudo.nome : null,
            midiaTamanho: conteudo.dados.length,
            midiaDuracao: conteudo.tipo === 'audio' ? (conteudo.duracao ?? null) : null,
          }),
    },
  })

  await prisma.conversa.update({
    where: { id: conversa.id },
    data: {
      ultimaMensagemEm: agora,
      previa: previaDe(tipo, texto),
      previaTipo: tipo,
      ...(autor === 'ATENDENTE'
        ? {
            naoLidas: 0,
            roboPausadoAte: new Date(agora.getTime() + PAUSA_DO_ROBO_MINUTOS * 60 * 1000),
          }
        : {}),
    },
  })

  const config = loja?.evolutionConfig
  const semConexao =
    !credenciaisDoServidor() ||
    !config?.conectadoEm ||
    (entrada.exigirProvedorEvolution && loja?.whatsappProvedor !== 'EVOLUTION')

  if (semConexao || !config) {
    /*
      Grava a tentativa com o motivo em vez de só devolver o erro. Sem isto, o
      que o atendente escreveu desaparecia da tela junto com o aviso de falha.
    */
    const motivo = !config?.conectadoEm || !credenciaisDoServidor()
      ? 'Esta loja não está com o WhatsApp pareado pela Evolution.'
      : 'Esta loja não usa a Evolution para mensagens automáticas.'
    const falha = await prisma.conversaMensagem.update({
      where: { id: mensagem.id },
      data: { status: 'ERRO', erro: motivo },
    })
    return { ok: false, motivo: 'sem-conexao', erro: motivo, mensagem: falha }
  }

  let idExterno: string
  try {
    if (conteudo.tipo === 'texto') {
      idExterno = await enviarTexto(config.instancia, conversa.jid, conteudo.texto)
    } else if (conteudo.tipo === 'audio') {
      idExterno = await enviarAudio(config.instancia, conversa.jid, conteudo.dados.toString('base64'))
    } else {
      idExterno = await enviarMidia(config.instancia, conversa.jid, {
        tipo: comoMidia!.midia,
        base64: conteudo.dados.toString('base64'),
        mimetype: conteudo.mimetype,
        nome: conteudo.nome,
        legenda: conteudo.legenda,
      })
    }
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : 'A Evolution recusou o envio.'
    const falha = await prisma.conversaMensagem.update({
      where: { id: mensagem.id },
      data: { status: 'ERRO', erro: motivo },
    })
    return { ok: false, motivo: 'recusado', erro: motivo, mensagem: falha }
  }

  const enviada = await gravarIdExterno(mensagem.id, idExterno)

  // O arquivo que acabou de sair já está em mãos: a tela vai pedi-lo em
  // seguida para desenhar o balão, e buscá-lo na Evolution seria ida à toa.
  if (conteudo.tipo !== 'texto') {
    guardarMidiaNoCache(mensagem.id, { dados: conteudo.dados, mimetype: conteudo.mimetype })
  }

  return { ok: true, mensagem: enviada }
}

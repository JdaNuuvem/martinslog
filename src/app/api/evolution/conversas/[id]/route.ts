import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { exigirAdmin } from '@/server/admin/guarda'
import {
  assumirConversa,
  devolverAoRobo,
  enviarNaConversa,
  lerConversa,
} from '@/server/conversa-service'

type Params = { params: Promise<{ id: string }> }

/**
 * Uma conversa: ler o histórico, responder, assumir do robô ou devolver.
 *
 * `GET` marca como lida — abrir a conversa é o ato de ler. Um botão "marcar
 * como lida" seria trabalho manual para registrar o que já aconteceu.
 */

const responderSchema = z.object({
  texto: z.string().trim().min(1, 'Escreva alguma coisa.').max(4096),
})

const acaoSchema = z.object({
  acao: z.enum(['assumir', 'devolver-ao-robo']),
})

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params

  try {
    const conversa = await lerConversa(guarda.sessao.userId, id)
    if (!conversa) return NextResponse.json({ mensagem: 'Conversa não encontrada.' }, { status: 404 })

    return NextResponse.json({
      conversa: {
        id: conversa.id,
        contato: conversa.contato,
        nomeContato: conversa.nomeContato,
        roboPausadoAte: conversa.roboPausadoAte,
        mensagens: conversa.mensagens.map((m) => ({
          id: m.id,
          autor: m.autor,
          texto: m.texto,
          erro: m.erro,
          ocorridoEm: m.ocorridoEm,
        })),
      },
    })
  } catch (erro) {
    if (erro instanceof DomainError) {
      // Conversa de outra conta responde 404, e não 403: confirmar que ela
      // existe já diria que aquele telefone falou com alguma loja daqui.
      return NextResponse.json({ mensagem: 'Conversa não encontrada.' }, { status: 404 })
    }
    throw erro
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const corpo = await request.json().catch(() => ({}))
  const analisado = responderSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Escreva alguma coisa antes de enviar.' },
      { status: 400 },
    )
  }

  const conversa = await lerConversa(guarda.sessao.userId, id)
  if (!conversa) return NextResponse.json({ mensagem: 'Conversa não encontrada.' }, { status: 404 })

  const resultado = await enviarNaConversa({
    perfilId: conversa.perfilId,
    contato: conversa.contato,
    texto: analisado.data.texto,
    autor: 'ATENDENTE',
  })

  if (!resultado.ok) {
    /*
      502 e não 500: quem recusou foi o provedor, não nós. A mensagem já está
      gravada com o erro, então a tela pode mostrá-la como não entregue em vez
      de perder o que o atendente escreveu.
    */
    return NextResponse.json({ codigo: 'ENVIO_RECUSADO', mensagem: resultado.erro }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const corpo = await request.json().catch(() => ({}))
  const analisado = acaoSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json({ codigo: 'CORPO_INVALIDO' }, { status: 400 })
  }

  try {
    if (analisado.data.acao === 'assumir') {
      const ate = await assumirConversa(guarda.sessao.userId, id)
      return NextResponse.json({ roboPausadoAte: ate })
    }
    await devolverAoRobo(guarda.sessao.userId, id)
    return NextResponse.json({ roboPausadoAte: null })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ mensagem: 'Conversa não encontrada.' }, { status: 404 })
    }
    throw erro
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { exigirAdmin } from '@/server/admin/guarda'
import { assumirConversa, devolverAoRobo } from '@/server/conversa-service'
import {
  conversaDaConta,
  listarMensagens,
  marcarConversaLida,
} from '@/server/whatsapp/caixa-service'
import { enviarConteudo } from '@/server/whatsapp/envio-service'

type Params = { params: Promise<{ id: string }> }

/**
 * Uma conversa no formato ANTIGO: ler o histórico, responder, assumir do robô
 * ou devolver. Delega para a caixa de entrada nova e traduz os nomes.
 *
 * `GET` marca como lida — era o contrato desta rota, e a tela antiga conta
 * com isso.
 */

const responderSchema = z.object({
  texto: z.string().trim().min(1, 'Escreva alguma coisa.').max(4096),
})

const acaoSchema = z.object({
  acao: z.enum(['assumir', 'devolver-ao-robo']),
})

/** Conversa de outra conta responde 404, e não 403. */
function naoEncontrada(): NextResponse {
  return NextResponse.json({ mensagem: 'Conversa não encontrada.' }, { status: 404 })
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params

  try {
    const conversa = await conversaDaConta(guarda.sessao.userId, id)
    const { mensagens } = await listarMensagens(guarda.sessao.userId, id, { limite: 200 })
    await marcarConversaLida(guarda.sessao.userId, id)

    return NextResponse.json({
      conversa: {
        id: conversa.id,
        contato: conversa.telefone ?? conversa.jid,
        nomeContato: conversa.nomeContato,
        roboPausadoAte: conversa.roboPausadoAte,
        mensagens: mensagens.map((m) => ({
          id: m.id,
          autor: m.autor,
          // A tela antiga só sabe desenhar texto.
          texto: m.texto ?? `[${m.tipo.toLowerCase()}]`,
          erro: m.erro,
          ocorridoEm: m.ocorridoEm,
        })),
      },
    })
  } catch (erro) {
    if (erro instanceof DomainError) return naoEncontrada()
    throw erro
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const analisado = responderSchema.safeParse(await request.json().catch(() => ({})))
  if (!analisado.success) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Escreva alguma coisa antes de enviar.' },
      { status: 400 },
    )
  }

  let conversa
  try {
    conversa = await conversaDaConta(guarda.sessao.userId, id)
  } catch (erro) {
    if (erro instanceof DomainError) return naoEncontrada()
    throw erro
  }

  const resultado = await enviarConteudo({
    conversa,
    autor: 'ATENDENTE',
    conteudo: { tipo: 'texto', texto: analisado.data.texto },
    exigirProvedorEvolution: false,
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
  const analisado = acaoSchema.safeParse(await request.json().catch(() => ({})))
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
    if (erro instanceof DomainError) return naoEncontrada()
    throw erro
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { marcarConversaLida } from '@/server/whatsapp/caixa-service'
import { respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

/**
 * Marca a conversa como lida aqui e no WhatsApp.
 *
 * Rota à parte, e não efeito colateral de abrir: a lista de mensagens é
 * relida a cada poucos segundos, e ler não pode mandar tique azul ao cliente
 * a cada atualização da tela.
 */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  try {
    await marcarConversaLida(guarda.sessao.userId, id)
    return NextResponse.json({ ok: true })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

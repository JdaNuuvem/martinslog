import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarConversasCaixa } from '@/server/whatsapp/caixa-service'
import { respostaDeErro } from '@/server/whatsapp/resposta-http'

/**
 * Lista de conversas no formato ANTIGO, para a tela que ainda o usa.
 *
 * Delega para a caixa de entrada nova (`/api/whatsapp/conversas`) e só
 * traduz os nomes. `contato` era o telefone; conversa `@lid` não tem
 * telefone, e aqui mostra o jid para a linha não sair em branco.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  try {
    const { conversas } = await listarConversasCaixa(guarda.sessao.userId, {
      perfilId: request.nextUrl.searchParams.get('perfilId'),
    })
    return NextResponse.json({
      conversas: conversas.map((c) => ({
        id: c.id,
        contato: c.telefone ?? c.jid,
        nomeContato: c.nome,
        ultimaMensagemEm: c.ultimaMensagemEm,
        naoLidas: c.naoLidas,
        roboPausado: c.roboPausado,
        previa: c.previa,
      })),
    })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

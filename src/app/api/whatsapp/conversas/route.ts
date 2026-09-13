import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarConversasCaixa } from '@/server/whatsapp/caixa-service'
import { respostaDeErro } from '@/server/whatsapp/resposta-http'

/**
 * Lista de conversas da loja, mais recente primeiro, 50 por página.
 *
 * `perfilId` vem da tela porque a conta tem várias lojas e a pessoa escolhe
 * qual caixa abrir — mas passa pela posse antes de qualquer leitura: um
 * perfil de outra conta responde 404, igual a um que não existe.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const busca = request.nextUrl.searchParams
  try {
    return NextResponse.json(
      await listarConversasCaixa(guarda.sessao.userId, {
        perfilId: busca.get('perfilId'),
        busca: busca.get('busca'),
        cursor: busca.get('cursor'),
      }),
    )
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

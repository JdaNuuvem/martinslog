import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { lojaDaCaixa } from '@/server/whatsapp/caixa-service'
import { sincronizarHistorico } from '@/server/whatsapp/importacao-service'
import { respostaDeErro } from '@/server/whatsapp/resposta-http'

/**
 * Importa agora o histórico do celular da loja.
 *
 * Espera terminar, ao contrário dos gatilhos automáticos: quem clica quer ver
 * o número de conversas trazidas. 409 quando já está rodando — o botão
 * apertado duas vezes não pode virar duas importações.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  try {
    const perfilId = await lojaDaCaixa(guarda.sessao.userId, request.nextUrl.searchParams.get('perfilId'))
    if (!perfilId) {
      return NextResponse.json({ codigo: 'NAO_ENCONTRADO', mensagem: 'Loja não encontrada.' }, { status: 404 })
    }
    return NextResponse.json(await sincronizarHistorico(perfilId))
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

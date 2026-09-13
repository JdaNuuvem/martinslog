import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarLojas } from '@/server/whatsapp/caixa-service'

/**
 * Lojas da conta para o seletor da caixa de entrada.
 *
 * Só administradores, como o resto da Evolution: aqui começa o caminho até o
 * que compradores escreveram, que é conteúdo de terceiros.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  return NextResponse.json({ lojas: await listarLojas(guarda.sessao.userId) })
}

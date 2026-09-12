import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarPerfis } from '@/server/perfil-service'
import { listarConversas } from '@/server/conversa-service'

/**
 * Lista de conversas da loja, mais recente primeiro.
 *
 * Só para administradores, como o resto da Evolution: aqui aparece o que
 * compradores escreveram, que é conteúdo de terceiros.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfis = await listarPerfis(guarda.sessao.userId)
  const perfil = perfis[0]
  if (!perfil) return NextResponse.json({ conversas: [] })

  return NextResponse.json({
    conversas: await listarConversas(guarda.sessao.userId, perfil.id),
  })
}

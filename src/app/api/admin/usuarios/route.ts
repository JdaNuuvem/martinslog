import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarUsuarios } from '@/server/admin/usuarios'

/**
 * `GET /api/admin/usuarios?busca=` — lista de usuários para o painel.
 *
 * A guarda vem antes de qualquer leitura de parâmetro: quem não é admin
 * recebe 404 sem descobrir que a rota existe.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const busca = request.nextUrl.searchParams.get('busca') ?? ''

  try {
    return NextResponse.json({ usuarios: await listarUsuarios(busca) })
  } catch (error) {
    console.error('Erro inesperado ao listar usuários', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao listar os usuários.' },
      { status: 500 },
    )
  }
}

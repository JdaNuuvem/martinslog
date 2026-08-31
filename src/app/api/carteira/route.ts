import { NextRequest, NextResponse } from 'next/server'
import { lerSessao } from '@/server/auth/sessao'
import { listarExtrato, obterCarteira } from '@/server/wallet-service'

/**
 * Devolve o saldo atual e uma página do extrato do usuário autenticado.
 * Query params opcionais: `pagina` (padrão 1) e `tamanhoPagina` (padrão 20).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const url = new URL(request.url)
  const pagina = Number(url.searchParams.get('pagina') ?? '1') || 1
  const tamanhoPaginaBruto = Number(url.searchParams.get('tamanhoPagina') ?? '20') || 20
  const tamanhoPagina = Math.min(Math.max(tamanhoPaginaBruto, 1), 100)

  const [carteira, extrato] = await Promise.all([
    obterCarteira(sessao.userId),
    listarExtrato(sessao.userId, pagina, tamanhoPagina),
  ])

  return NextResponse.json({ saldoCentavos: carteira.saldoCentavos, extrato })
}

import { NextRequest, NextResponse } from 'next/server'
import { lerSessao } from '@/server/auth/sessao'
import { obterCarteira } from '@/server/wallet-service'

/**
 * Só o saldo, sem extrato.
 *
 * Existe para a topbar, que aparece em toda tela autenticada e precisa
 * apenas do número. Usar `GET /api/carteira` ali carregaria vinte
 * lançamentos e uma contagem a cada navegação, para jogar tudo fora.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const carteira = await obterCarteira(sessao.userId)
  return NextResponse.json({ saldoCentavos: carteira.saldoCentavos })
}

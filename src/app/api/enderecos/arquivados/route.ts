import { NextRequest, NextResponse } from 'next/server'
import { lerSessao } from '@/server/auth/sessao'
import { listarEnderecosArquivados } from '@/server/enderecos-service'

/**
 * Lista os endereços arquivados do usuário autenticado.
 *
 * Rota estática irmã de `/api/enderecos/[id]`. O Next resolve segmentos
 * estáticos antes dos dinâmicos, então `/api/enderecos/arquivados` cai aqui
 * e nunca é interpretado como um endereço de id "arquivados".
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const enderecos = await listarEnderecosArquivados(sessao.userId)
  return NextResponse.json({ enderecos })
}

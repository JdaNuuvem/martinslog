import { NextRequest, NextResponse } from 'next/server'
import { abaEtiquetasSchema, buscaEtiquetasSchema } from '@/lib/etiquetas-schema'
import { lerSessao } from '@/server/auth/sessao'
import { listarEtiquetas } from '@/server/etiquetas-service'

/**
 * Lista as etiquetas do usuário logado.
 *
 * Aba e busca inválidas caem no padrão pelo `catch` dos schemas, em vez de
 * devolverem erro: parâmetro estranho na URL não é motivo para o cliente
 * ficar sem a tela.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const aba = abaEtiquetasSchema.parse(request.nextUrl.searchParams.get('aba') ?? 'todos')
  const busca = buscaEtiquetasSchema.parse(request.nextUrl.searchParams.get('busca') ?? '')

  try {
    /*
      O papel vem da SESSÃO, nunca da URL. Aceitar um parâmetro de "ver tudo"
      seria dar a qualquer lojista os envios dos outros com uma digitada na
      barra de endereço.
    */
    const resultado = await listarEtiquetas(sessao.userId, {
      aba,
      busca,
      todasAsContas: sessao.papel === 'ADMIN',
    })
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('Erro inesperado ao listar etiquetas', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao listar as etiquetas.' },
      { status: 500 },
    )
  }
}

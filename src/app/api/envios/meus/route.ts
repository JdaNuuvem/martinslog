import { NextRequest, NextResponse } from 'next/server'
import { filtroEnviosSchema } from '@/lib/meus-envios-schema'
import { lerSessao } from '@/server/auth/sessao'
import { listarMeusEnvios } from '@/server/meus-envios-service'

/**
 * Lista os envios do usuário logado para a tela de rastreio.
 *
 * Rota separada de `/api/envios` de propósito: aquela cria e paga envio, com
 * outro dono e outro ciclo de vida. Filtro inválido cai em `todos` pelo
 * `catch` do schema, em vez de devolver erro — aba errada na URL não é
 * motivo para quebrar a tela.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const filtro = filtroEnviosSchema.parse(request.nextUrl.searchParams.get('filtro') ?? 'todos')

  try {
    const resultado = await listarMeusEnvios(sessao.userId, filtro)
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('Erro inesperado ao listar envios', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao listar os envios.' },
      { status: 500 },
    )
  }
}

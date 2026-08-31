import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { gerarCotacao } from '@/server/cotacao-service'
import { cotacaoRequestSchema } from '@/lib/cotacao-schema'
import { lerSessao } from '@/server/auth/sessao'

const ANON_SESSION_COOKIE = 'anon_session_id'

const schema = cotacaoRequestSchema

export async function POST(request: NextRequest): Promise<NextResponse> {
  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = schema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados da cotação inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const entrada = analisado.data

  try {
    const anonSessionIdAtual = request.cookies.get(ANON_SESSION_COOKIE)?.value ?? null
    const sessao = await lerSessao(request)

    const resultado = await gerarCotacao(
      {
        cepOrigem: entrada.cepOrigem,
        cepDestino: entrada.cepDestino,
        pesoRealG: entrada.pesoG,
        alturaCm: entrada.alturaCm,
        larguraCm: entrada.larguraCm,
        comprimentoCm: entrada.comprimentoCm,
        formato: entrada.formato,
      },
      { userId: sessao?.userId ?? null, anonSessionId: anonSessionIdAtual },
    )

    const resposta = NextResponse.json(
      {
        quoteId: resultado.quoteId,
        pesoCubadoG: resultado.pesoCubadoG,
        pesoTaxavelG: resultado.pesoTaxavelG,
        opcoes: resultado.opcoes,
      },
      { status: 200 },
    )

    if (resultado.anonSessionId) {
      resposta.cookies.set(ANON_SESSION_COOKIE, resultado.anonSessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      })
    }

    return resposta
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.codigo === 'SERVICO_INDISPONIVEL' ? 503 : 422
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
    }

    console.error('Erro inesperado ao gerar cotação', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar a cotação.' },
      { status: 500 },
    )
  }
}

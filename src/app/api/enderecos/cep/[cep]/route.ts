import { NextRequest, NextResponse } from 'next/server'
import { CepInvalidoError, ServicoIndisponivelError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { buscarEnderecoPorCep } from '@/server/enderecos-service'

type Params = { params: Promise<{ cep: string }> }

/**
 * Busca logradouro/bairro/cidade/UF para preenchimento automático do
 * formulário. Distingue CEP inexistente (`CEP_INVALIDO`, 422 — o usuário
 * digitou algo errado) de provedor fora do ar (`SERVICO_INDISPONIVEL`, 503 —
 * o CEP pode estar certo, só a busca falhou). O cliente trata os dois casos
 * de forma diferente: o primeiro pede correção, o segundo libera
 * preenchimento manual sem acusar o CEP.
 */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { cep } = await params

  try {
    const endereco = await buscarEnderecoPorCep(cep)
    return NextResponse.json({ endereco })
  } catch (error) {
    if (error instanceof CepInvalidoError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }
    if (error instanceof ServicoIndisponivelError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 503 })
    }

    console.error('Erro inesperado ao buscar CEP', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao buscar o CEP.' },
      { status: 500 },
    )
  }
}

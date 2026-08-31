import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { acaoCatalogoPadraoSchema } from '@/lib/status-padrao-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import {
  definirCadenciaDias,
  listarCatalogoPadrao,
  removerStatusPadrao,
  salvarStatusPadrao,
} from '@/server/admin/status-rastreio'

/** `GET /api/admin/status-rastreio` — catálogo padrão da plataforma. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  try {
    return NextResponse.json({ linhas: await listarCatalogoPadrao() })
  } catch (error) {
    console.error('Erro inesperado ao listar o catálogo padrão de status', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao listar o catálogo.' },
      { status: 500 },
    )
  }
}

/**
 * `POST /api/admin/status-rastreio` — salvar, remover ou aplicar a cadência.
 *
 * As três chegam pelo mesmo verbo porque operam sobre o mesmo recurso, o
 * catálogo padrão, e assim a guarda e a validação ficam em um lugar só. Cada
 * uma grava `AuditLog` no serviço correspondente.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = acaoCatalogoPadraoSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    const primeiro = Object.values(campos).flat().find(Boolean)
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: primeiro ?? 'Dados inválidos.', campos },
      { status: 400 },
    )
  }

  const acao = analisado.data
  const ator = guarda.sessao.userId

  try {
    switch (acao.acao) {
      case 'SALVAR': {
        const salvo = await salvarStatusPadrao(ator, acao)
        return NextResponse.json({ status: salvo }, { status: 200 })
      }
      case 'REMOVER':
        await removerStatusPadrao(ator, acao.id)
        return new NextResponse(null, { status: 204 })
      case 'CADENCIA': {
        const resultado = await definirCadenciaDias(ator, acao.dias)
        return NextResponse.json(resultado, { status: 200 })
      }
    }
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado em ação sobre o catálogo padrão de status', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao executar a ação.' },
      { status: 500 },
    )
  }
}

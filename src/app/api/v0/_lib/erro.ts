import { NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'

/**
 * Mapeia código de domínio para status HTTP das rotas `/api/v0`. Segue o
 * mesmo formato `{ codigo, mensagem }` do restante da API
 * (`src/app/api/envios/route.ts`).
 */
function statusParaErro(codigo: string): number {
  switch (codigo) {
    case 'TOKEN_INVALIDO':
      return 401
    case 'ENVIO_NAO_ENCONTRADO':
    case 'COTACAO_NAO_ENCONTRADA':
      return 404
    case 'LIMITE_REQUISICOES_EXCEDIDO':
      return 429
    case 'SALDO_INSUFICIENTE':
      return 402
    case 'CORPO_INVALIDO':
    case 'CEP_INVALIDO':
      return 400
    case 'NAO_AUTORIZADO':
      return 403
    default:
      return 422
  }
}

/**
 * Resposta de erro padrão das rotas `/api/v0`. Nunca inclui `error.message`
 * de exceções que não sejam `DomainError` — mensagem de driver de banco,
 * nome de tabela ou stack nunca chegam ao lojista integrado. O detalhe vai
 * só para o log estruturado do servidor.
 */
export function respostaErro(error: unknown, contexto: string): NextResponse {
  if (error instanceof DomainError) {
    const status = statusParaErro(error.codigo)
    const corpo: Record<string, unknown> = { codigo: error.codigo, mensagem: error.message }
    if (error.codigo === 'LIMITE_REQUISICOES_EXCEDIDO') {
      return NextResponse.json(corpo, { status, headers: { 'Retry-After': '60' } })
    }
    return NextResponse.json(corpo, { status })
  }

  console.error(contexto, { cause: error })
  return NextResponse.json(
    { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado. Tente novamente.' },
    { status: 500 },
  )
}

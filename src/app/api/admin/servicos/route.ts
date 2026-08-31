import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { acaoServicosSchema } from '@/lib/servicos-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import {
  alternarServico,
  alternarTransportadora,
  listarTransportadoras,
  salvarServico,
  salvarTransportadora,
} from '@/server/admin/servicos'

/** `GET /api/admin/servicos` — transportadoras com seus serviços. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  try {
    return NextResponse.json({ transportadoras: await listarTransportadoras() })
  } catch (error) {
    console.error('Erro inesperado ao listar transportadoras', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao listar as transportadoras.' },
      { status: 500 },
    )
  }
}

/**
 * `POST /api/admin/servicos` — cria/edita transportadora ou serviço, e
 * liga/desliga qualquer um dos dois.
 *
 * Não existe verbo de exclusão: `Service` é referenciado por `Quote`,
 * `Shipment` e `PriceRule` com `onDelete: Restrict`, e o histórico do cliente
 * aponta para ele. Desativar é a operação correta e a única oferecida.
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

  const analisado = acaoServicosSchema.safeParse(corpo)
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
      case 'SALVAR_TRANSPORTADORA': {
        const salvo = await salvarTransportadora(ator, acao)
        return NextResponse.json({ transportadora: salvo }, { status: 200 })
      }
      case 'SALVAR_SERVICO': {
        const salvo = await salvarServico(ator, acao)
        return NextResponse.json({ servico: salvo }, { status: 200 })
      }
      case 'ALTERNAR': {
        const salvo =
          acao.alvo === 'SERVICO'
            ? await alternarServico(ator, acao.id, acao.ativo)
            : await alternarTransportadora(ator, acao.id, acao.ativo)
        return NextResponse.json({ ativo: salvo.ativo }, { status: 200 })
      }
    }
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado em ação sobre transportadoras/serviços', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao executar a ação.' },
      { status: 500 },
    )
  }
}

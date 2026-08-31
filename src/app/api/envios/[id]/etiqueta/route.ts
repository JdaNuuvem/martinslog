import { NextRequest, NextResponse } from 'next/server'
import { EnvioNaoEncontradoError, TransicaoInvalidaError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { prisma } from '@/infra/db/client'
import { emitirEtiqueta } from '@/server/emitir-etiqueta-service'

/**
 * Resposta única para "não é seu" e "não existe": 404 nos dois casos.
 *
 * Um 403 confirmaria a existência daquele envio para quem apenas chutou o
 * id — mesmo raciocínio de `buscarEnderecoDoUsuario` em `enderecos-service`
 * e da guarda administrativa.
 */
function naoEncontrado(): NextResponse {
  return NextResponse.json(
    { codigo: 'ENVIO_NAO_ENCONTRADO', mensagem: 'Envio não encontrado.' },
    { status: 404 },
  )
}

/**
 * Emite a etiqueta de um envio pago: atribui o código de rastreio e faz
 * nascer a linha do tempo da simulação (`emitirEtiqueta`).
 *
 * A posse é verificada aqui, e não no serviço, porque o serviço também é
 * chamado por caminhos que já provaram a posse (o gancho após o pagamento)
 * ou que não têm dono (ação administrativa).
 *
 * Emitir duas vezes devolve 409: a segunda chamada é recusada de propósito
 * pelo serviço, para nunca duplicar código nem timeline.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await context.params

  const envio = await prisma.shipment.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!envio || envio.userId !== sessao.userId) {
    return naoEncontrado()
  }

  try {
    const { codigoRastreio } = await emitirEtiqueta(id)
    return NextResponse.json({ codigoRastreio }, { status: 200 })
  } catch (error) {
    if (error instanceof TransicaoInvalidaError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 409 })
    }

    if (error instanceof EnvioNaoEncontradoError) {
      return naoEncontrado()
    }

    console.error('Erro inesperado ao emitir etiqueta', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao emitir a etiqueta.' },
      { status: 500 },
    )
  }
}

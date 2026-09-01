import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import {
  conectarEmail,
  desconectarEmail,
  listarEnvios,
  obterConfigEmail,
} from '@/server/email-service'

const conectarSchema = z.object({
  apiKey: z.string().trim().min(1, 'Informe a chave de API do Resend.'),
  remetente: z.string().trim().min(1, 'Informe o remetente.'),
})

/**
 * Conexão de e-mail da conta autenticada.
 *
 * A resposta **nunca** inclui a chave, nem para o dono: uma vez gravada, ela
 * só sai do banco para ser usada no envio. A tela confirma qual chave está
 * conectada pela dica.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const [config, envios] = await Promise.all([
    obterConfigEmail(sessao.userId),
    listarEnvios(sessao.userId),
  ])

  return NextResponse.json({ config, envios })
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
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

  const analisado = conectarSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados da conexão inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const config = await conectarEmail(sessao.userId, analisado.data)
    return NextResponse.json({ config })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    // A mensagem do erro nunca vai para o cliente aqui: ela pode conter
    // detalhe de configuração do servidor.
    console.error('Erro inesperado ao conectar e-mail', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao conectar o e-mail.' },
      { status: 500 },
    )
  }
}

/** Desconecta e apaga a chave. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  await desconectarEmail(sessao.userId)
  return new NextResponse(null, { status: 204 })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { PALETA, templatePadrao } from '@/domain/rastreio/template-rastreio'
import { lerSessao } from '@/server/auth/sessao'
import {
  obterTemplate,
  removerTemplate,
  salvarTemplate,
} from '@/server/template-rastreio-service'

const passoSchema = z.object({
  id: z.string().min(1).optional(),
  codigo: z.string().min(1),
  titulo: z.string().trim().min(1, 'Título é obrigatório'),
  descricao: z.string().trim().min(1, 'Descrição é obrigatória'),
  diasAposEmissao: z.number().min(0).max(365),
  tipo: z.enum(['ETAPA', 'COBRANCA']).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  valorCentavos: z.number().int().min(0).optional(),
})

const templateSchema = z.object({
  passos: z.array(passoSchema).min(1, 'O template precisa de ao menos um passo'),
})

/**
 * Template de percurso da conta autenticada.
 *
 * O `userId` vem sempre da sessão. A paleta e o percurso padrão vão junto na
 * resposta para a tela não precisar duplicar a lista de etapas possíveis —
 * ela é regra de domínio, não conteúdo de interface.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const template = await obterTemplate(sessao.userId)

  return NextResponse.json({
    template,
    paleta: PALETA,
    padrao: templatePadrao(),
  })
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

  const analisado = templateSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do template inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const salvo = await salvarTemplate(sessao.userId, analisado.data.passos)
    return NextResponse.json({ template: salvo })
  } catch (error) {
    if (error instanceof DomainError) {
      // A mensagem do domínio aponta o passo problemático pela posição, e é
      // ela que a tela mostra: "template inválido" não ajudaria quem montou
      // doze passos.
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao salvar template de rastreio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao salvar o template.' },
      { status: 500 },
    )
  }
}

/** Remove o template: a conta volta ao caminho padrão da simulação. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  await removerTemplate(sessao.userId)
  return new NextResponse(null, { status: 204 })
}

import { NextRequest, NextResponse } from 'next/server'
import { DomainError, SaldoInsuficienteError } from '@/domain/errors'
import { ajusteSaldoSchema } from '@/lib/admin-usuarios-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import { ajustarSaldo } from '@/server/admin/carteira'
import { prisma } from '@/infra/db/client'

/**
 * `POST /api/admin/usuarios/[id]/saldo` — credita ou debita a carteira de um
 * cliente por decisão administrativa.
 *
 * O `userId` vem da URL e nunca do corpo: assim não existe caminho em que um
 * corpo malformado mova dinheiro na carteira errada.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id: userId } = await context.params

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = ajusteSaldoSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem:
          campos.valorCentavos?.[0] ?? campos.motivo?.[0] ?? campos.tipo?.[0] ?? 'Ajuste inválido.',
        campos,
      },
      { status: 400 },
    )
  }

  const existe = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!existe) {
    return NextResponse.json(
      { codigo: 'USUARIO_NAO_ENCONTRADO', mensagem: 'Usuário não encontrado.' },
      { status: 404 },
    )
  }

  try {
    const resultado = await ajustarSaldo(guarda.sessao.userId, userId, analisado.data)
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    if (error instanceof SaldoInsuficienteError) {
      return NextResponse.json(
        {
          codigo: error.codigo,
          mensagem: 'O débito é maior que o saldo atual desta carteira.',
        },
        { status: 422 },
      )
    }
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao ajustar saldo', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao ajustar o saldo.' },
      { status: 500 },
    )
  }
}

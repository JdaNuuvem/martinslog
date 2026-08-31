import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { lerSessao } from '@/server/auth/sessao'
import { prisma } from '@/infra/db/client'

const corpoSchema = z.object({
  cepOrigem: z
    .string()
    .regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
})

/**
 * Persiste o CEP de origem padrão do usuário autenticado, usado pelo botão
 * SALVAR da calculadora. Sem sessão válida, o cliente usa `localStorage` —
 * esta rota nunca é chamada nesse caso.
 */
export async function PUT(request: NextRequest) {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const corpo: unknown = await request.json().catch(() => null)
  const analisado = corpoSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json({ mensagem: 'CEP de origem inválido.' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: sessao.userId },
    data: { cepOrigemPadrao: analisado.data.cepOrigem },
  })

  return NextResponse.json({ cepOrigem: analisado.data.cepOrigem })
}

export async function GET(request: NextRequest) {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ cepOrigem: null })
  }

  const user = await prisma.user.findUnique({
    where: { id: sessao.userId },
    select: { cepOrigemPadrao: true },
  })

  return NextResponse.json({ cepOrigem: user?.cepOrigemPadrao ?? null })
}

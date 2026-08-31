import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { fatorVelocidadeSchema } from '@/lib/simulacao-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import { definirFatorVelocidade } from '@/server/admin/simulacao'

/**
 * Define o fator de velocidade global da simulação.
 *
 * A guarda vem primeiro, antes de ler o corpo: quem não é administrador não
 * deve nem saber se o corpo enviado era válido. `exigirAdmin` responde 404,
 * não 403 — para quem não é admin, esta rota não existe.
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

  const analisado = fatorVelocidadeSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: campos.fatorVelocidade?.[0] ?? 'Fator de velocidade inválido.',
        campos,
      },
      { status: 400 },
    )
  }

  try {
    await definirFatorVelocidade(guarda.sessao.userId, analisado.data.fatorVelocidade)
    return NextResponse.json({ fatorVelocidade: analisado.data.fatorVelocidade }, { status: 200 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao definir o fator de velocidade', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao definir o fator de velocidade.' },
      { status: 500 },
    )
  }
}

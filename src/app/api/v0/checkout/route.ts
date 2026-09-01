import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro } from '../_lib/erro'
import { autenticarRequisicao, checkout } from '@/server/api-publica-service'

const corpoSchema = z.object({
  orders: z.array(z.string().min(1)).min(1, 'Informe ao menos um envio'),
})

/**
 * `POST /api/v0/checkout` — `{ orders: [ids] }` debita a carteira (ou, em
 * sandbox, nada debita — ver `checkout` em `api-publica-service.ts`).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)

    const corpo = await request.json().catch(() => null)
    const analisado = corpoSchema.safeParse(corpo)
    if (!analisado.success) {
      return NextResponse.json(
        {
          codigo: 'CORPO_INVALIDO',
          mensagem: 'Informe a lista de envios a pagar.',
          campos: analisado.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    const resultado = await checkout(contexto, analisado.data.orders)
    return NextResponse.json(
      { success: true, purchase: resultado },
      { status: 200 },
    )
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/checkout')
  }
}

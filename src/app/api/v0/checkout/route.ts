import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro, statusParaErro } from '../_lib/erro'
import { autenticarRequisicao, checkout } from '@/server/api-publica-service'

const corpoSchema = z.object({
  orders: z.array(z.string().min(1)).min(1, 'Informe ao menos um envio'),
})

/**
 * `POST /api/v0/checkout` — `{ orders: [ids] }` debita a carteira (ou, em
 * sandbox, nada debita — ver `checkout` em `api-publica-service.ts`).
 *
 * **Como o resultado é reportado**, e por que assim:
 *
 *  - todos passaram → 200, `status: "approved"`
 *  - alguns passaram → 200, `status: "partial"`, com o motivo em cada item
 *  - **nenhum passou → o erro do primeiro**, com o código HTTP dele
 *
 * O último ramo é compatibilidade deliberada. Quem manda um envio por
 * chamada — o caso comum, e o que a loja do Montador faz — recebia 402 em
 * saldo insuficiente e tratava como erro. Se o lote fracassado passasse a
 * responder 200, esse integrador leria sucesso e seguiria para `/order/info`
 * procurando uma etiqueta que nunca foi emitida, perdendo o motivo no
 * caminho. O resultado por envio é ganho novo; a leitura antiga continua
 * válida.
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

    const nenhumPassou = resultado.orders.every((o) => o.result === 'failed')
    if (nenhumPassou) {
      const primeiro = resultado.orders[0]
      const codigo = primeiro?.error_code ?? 'ERRO_INTERNO'
      return NextResponse.json(
        {
          codigo,
          mensagem: primeiro?.error ?? 'Nenhum envio pôde ser pago.',
          // O detalhe por envio vai junto: num lote, saber QUAL falhou e por
          // quê é a diferença entre corrigir e adivinhar.
          purchase: resultado,
        },
        { status: statusParaErro(codigo) },
      )
    }

    return NextResponse.json({ success: true, purchase: resultado }, { status: 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/checkout')
  }
}

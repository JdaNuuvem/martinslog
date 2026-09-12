import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { lerSessao } from '@/server/auth/sessao'
import { avancarEtapaEmLote, MAXIMO_POR_LOTE } from '@/server/avancar-lote-service'

/**
 * `POST /api/etiquetas/avancar-lote` — avança a etapa de vários envios.
 *
 * Responde **200 com o resultado por envio**, mesmo quando alguns falham.
 * Devolver erro seco no primeiro tropeço deixaria quem clicou sem saber o que
 * foi feito e o que não foi — e a segunda tentativa viraria aposta, porque
 * repetir um avanço que já aconteceu puxa OUTRA etapa.
 */
const corpoSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, 'Selecione ao menos um envio')
    /*
      Teto por chamada. Cada avanço abre transação e desloca a linha do tempo
      inteira do envio; sem limite, uma seleção de mil ficaria minutos
      segurando a conexão e estouraria o tempo limite no meio, deixando metade
      avançada e ninguém sabendo qual metade.
    */
    .max(MAXIMO_POR_LOTE, `No máximo ${MAXIMO_POR_LOTE} envios por vez`),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const corpo = await request.json().catch(() => null)
  const analisado = corpoSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: analisado.error.issues[0]?.message ?? 'Seleção inválida.',
      },
      { status: 400 },
    )
  }

  try {
    const resultado = await avancarEtapaEmLote(sessao, analisado.data.ids)
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    console.error('Erro inesperado ao avançar etapas em lote', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao avançar as etapas.' },
      { status: 500 },
    )
  }
}

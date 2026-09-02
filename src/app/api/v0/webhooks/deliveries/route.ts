import { NextRequest, NextResponse } from 'next/server'
import { respostaErro } from '../../_lib/erro'
import { autenticarRequisicao, listarEntregasWebhook } from '@/server/api-publica-service'

/**
 * `GET /api/v0/webhooks/deliveries` — o que tentamos entregar, e o que houve.
 *
 * A rede de recuperação para quem ficou fora do ar além das seis tentativas.
 * Sem ela, um evento perdido só se reconstrói varrendo pedido a pedido — e essa
 * varredura disputa cota com as chamadas que fecham venda.
 *
 * Filtros: `shipment_id`, `since` (ISO 8601) e `limit` (1 a 500, padrão 100).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)
    const busca = request.nextUrl.searchParams

    const desdeCru = busca.get('since')
    const desde = desdeCru ? new Date(desdeCru) : undefined
    if (desde && Number.isNaN(desde.getTime())) {
      return NextResponse.json(
        {
          codigo: 'CORPO_INVALIDO',
          mensagem: 'O parâmetro `since` precisa ser uma data ISO 8601.',
        },
        { status: 400 },
      )
    }

    const limiteCru = busca.get('limit')
    const limite = limiteCru ? Number(limiteCru) : undefined
    if (limite !== undefined && !Number.isFinite(limite)) {
      return NextResponse.json(
        { codigo: 'CORPO_INVALIDO', mensagem: 'O parâmetro `limit` precisa ser um número.' },
        { status: 400 },
      )
    }

    const entregas = await listarEntregasWebhook(contexto, {
      shipmentId: busca.get('shipment_id') ?? undefined,
      desde,
      limite,
    })

    return NextResponse.json({ deliveries: entregas }, { status: 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em GET /api/v0/webhooks/deliveries')
  }
}

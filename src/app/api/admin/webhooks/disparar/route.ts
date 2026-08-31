import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { dispararPendentes } from '@/server/webhook-service'

/**
 * Processa a fila de entregas vencidas.
 *
 * Não há worker nem fila externa no projeto: o disparo é sob demanda, para
 * ser chamado por um agendador externo (cron do sistema, agendador da
 * hospedagem) ou pelo próprio administrador. Enquanto ninguém chamar, as
 * entregas ficam pendentes no banco — nada se perde.
 *
 * Exige sessão de administrador. Fosse aberta, qualquer pessoa poderia
 * forçar a plataforma a disparar requisições em rajada para os endpoints
 * cadastrados, o que é tanto um amplificador de tráfego quanto uma forma de
 * queimar as tentativas de uma entrega antes que o endpoint do cliente volte.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  try {
    const resultado = await dispararPendentes()
    return NextResponse.json({ resultado })
  } catch (error) {
    console.error('Erro inesperado ao disparar webhooks', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar a fila.' },
      { status: 500 },
    )
  }
}

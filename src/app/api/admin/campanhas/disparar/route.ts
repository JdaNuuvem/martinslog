import { NextRequest, NextResponse } from 'next/server'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { dispararCampanhasPendentes } from '@/server/campanha-service'

/**
 * Solta um lote das campanhas agendadas.
 *
 * Mesma autenticação das outras filas (`WEBHOOK_CRON_TOKEN`): é a mesma
 * máquina chamando, de minuto em minuto.
 *
 * Uma rodada demora de propósito — o serviço espaça os envios para não
 * parecer rajada. Por isso o agendador chama e segue a vida; quem espera o
 * fim é o cron, não o usuário.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!tokenDeCronValido(request)) {
    return NextResponse.json({ mensagem: 'Recurso não encontrado.' }, { status: 404 })
  }

  try {
    return NextResponse.json({ resultado: await dispararCampanhasPendentes() })
  } catch (erro) {
    console.error('Falha ao disparar campanhas', { cause: erro })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao disparar campanhas.' },
      { status: 500 },
    )
  }
}

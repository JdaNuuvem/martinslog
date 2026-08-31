import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { dispararPendentes } from '@/server/webhook-service'

/**
 * Processa a fila de entregas vencidas.
 *
 * Não há worker nem fila externa no projeto: o disparo é sob demanda, para
 * ser chamado por um agendador externo (cron do sistema, agendador da
 * hospedagem) ou pelo próprio administrador. Enquanto ninguém chamar, as
 * entregas ficam pendentes no banco — nada se perde.
 *
 * Aceita duas credenciais: sessão de administrador (o botão do painel) ou
 * `Authorization: Bearer <WEBHOOK_CRON_TOKEN>` (o agendador). Sem uma das
 * duas, responde 404 como o resto da área administrativa.
 *
 * A porta fechada importa: aberta, qualquer pessoa poderia forçar a
 * plataforma a disparar requisições em rajada para os endpoints cadastrados,
 * o que é tanto um amplificador de tráfego quanto uma forma de queimar as
 * tentativas de uma entrega antes que o endpoint do cliente volte do ar.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Duas portas para a mesma ação: o administrador pelo painel e o agendador
  // pelo token. O token é conferido primeiro porque um cron nunca terá
  // sessão, e vale só para esta rota — não é uma credencial de admin.
  if (!tokenDeCronValido(request)) {
    const guarda = await exigirAdmin(request)
    if (!guarda.autorizado) {
      return guarda.resposta
    }
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

import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { dispararSmsPendentes } from '@/server/sms-service'

/**
 * Processa a fila de SMS vencidos.
 *
 * Mesmo desenho da fila de webhooks, e pelo mesmo motivo: a mensagem é gravada
 * primeiro e enviada depois, por um agendador externo. Enquanto ninguém
 * chamar, nada se perde — as mensagens ficam pendentes no banco.
 *
 * Aceita as duas credenciais da rota irmã: sessão de administrador (o botão do
 * painel) ou `Authorization: Bearer <WEBHOOK_CRON_TOKEN>` (o cron). Reusa o
 * mesmo token de propósito — são a mesma máquina chamando as duas filas de
 * minuto em minuto, e um segundo segredo para o mesmo agendador seria mais uma
 * coisa para vazar sem nada em troca.
 *
 * A porta fechada importa: aberta, qualquer um poderia esvaziar a fila em
 * rajada e queimar o saldo de SMS do lojista.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!tokenDeCronValido(request)) {
    const guarda = await exigirAdmin(request)
    if (!guarda.autorizado) {
      return guarda.resposta
    }
  }

  try {
    const resultado = await dispararSmsPendentes()
    return NextResponse.json({ resultado })
  } catch (error) {
    console.error('Erro inesperado ao disparar a fila de SMS', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar a fila.' },
      { status: 500 },
    )
  }
}

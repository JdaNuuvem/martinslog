import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { dispararPendentes } from '@/server/whatsapp-service'

/**
 * Processa a fila de WhatsApp vencido.
 *
 * A fila existia inteira — enfileiramento, retentativa, desistência, trava
 * contra repetição — e **ninguém a chamava**. Havia rota para a fila de SMS e
 * para a de webhooks; esta era a que faltava, e sem ela toda mensagem de
 * WhatsApp ficava pendente no banco para sempre, sem nada acusar.
 *
 * Mesmas duas credenciais das filas irmãs: sessão de administrador ou
 * `Authorization: Bearer <WEBHOOK_CRON_TOKEN>`.
 *
 * Enquanto nenhuma conta tiver WhatsApp verificado na Meta, uma rodada aqui
 * percorre zero mensagens e não custa nada — o enfileiramento já recusa quando
 * não há conta conectada. A rota nasce pronta para o dia em que a verificação
 * sair, em vez de virar mais uma coisa a lembrar naquele dia.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
    console.error('Erro inesperado ao disparar a fila de WhatsApp', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar a fila.' },
      { status: 500 },
    )
  }
}

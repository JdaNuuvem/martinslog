import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { sincronizarTodosOsEnvios } from '@/server/sincronizar-todos-service'

/**
 * Faz o relógio alcançar os envios de todas as contas.
 *
 * A timeline nasce inteira na emissão da etiqueta, com os eventos já datados
 * no futuro — mas o `Shipment.status` só andava quando alguém abria a página
 * pública daquele código. Era o único caminho de produção que chamava a
 * sincronização. Envio cujo comprador não abre o link ficava em `GENERATED`
 * para sempre, e com ele `order.posted` e `order.delivered`, que a loja usa
 * para espelhar o rastreio.
 *
 * Esta rota é a porta do agendador para essa varredura. Mesma dupla
 * credencial das outras filas: sessão de administrador (o botão do painel) ou
 * `Authorization: Bearer <WEBHOOK_CRON_TOKEN>` (o cron). Sem uma das duas,
 * 404 como o resto da área administrativa — a porta fechada importa porque
 * uma varredura aberta seria um jeito barato de fazer a plataforma percorrer
 * a base inteira a cada requisição.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!tokenDeCronValido(request)) {
    const guarda = await exigirAdmin(request)
    if (!guarda.autorizado) {
      return guarda.resposta
    }
  }

  try {
    const resultado = await sincronizarTodosOsEnvios()
    return NextResponse.json({ resultado })
  } catch (error) {
    console.error('Erro inesperado ao sincronizar envios', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao sincronizar os envios.' },
      { status: 500 },
    )
  }
}

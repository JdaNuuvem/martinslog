import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { tokenDeCronValido } from '@/server/webhook-cron-auth'
import { dispararRecuperacoes } from '@/server/recuperacao-service'

/**
 * Roda uma rodada da régua de recuperação.
 *
 * A régua estava completa e **nunca era chamada**: nenhuma rota, nenhum
 * agendador. A promessa que a API faz a cada pedido pendente ("a recuperação
 * cuidará dele se o pagamento não vier") não se cumpria, e o pendente — que é
 * a venda que ainda dá para salvar — ficava sem nenhuma cobrança.
 *
 * Esta rota é a porta que faltava. Ela **não** dispara nada por conta própria:
 * sem regra cadastrada, uma rodada percorre zero regras e não cria mensagem
 * nenhuma. Quem decide quantas cobranças, com que atraso e em qual canal é o
 * dono da loja — é dinheiro por mensagem e é o número dele que leva a fama de
 * quem manda demais.
 *
 * Mesmas duas credenciais das filas irmãs: sessão de administrador (o botão do
 * painel) ou `Authorization: Bearer <WEBHOOK_CRON_TOKEN>` (o agendador). Porta
 * aberta aqui deixaria qualquer um esvaziar a régua em rajada e queimar o saldo
 * de SMS do lojista.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!tokenDeCronValido(request)) {
    const guarda = await exigirAdmin(request)
    if (!guarda.autorizado) {
      return guarda.resposta
    }
  }

  try {
    const resultado = await dispararRecuperacoes()
    return NextResponse.json({ resultado })
  } catch (error) {
    console.error('Erro inesperado ao rodar a régua de recuperação', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao rodar a régua.' },
      { status: 500 },
    )
  }
}

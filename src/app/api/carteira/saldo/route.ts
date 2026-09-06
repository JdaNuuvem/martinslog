import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { obterCarteira } from '@/server/wallet-service'

/**
 * Só o saldo, sem extrato.
 *
 * Existe para a topbar, que aparece em toda tela autenticada e precisa
 * apenas do número. Usar `GET /api/carteira` ali carregaria vinte
 * lançamentos e uma contagem a cada navegação, para jogar tudo fora.
 *
 * Devolve junto se a conta é isenta da taxa por etiqueta. Sem isso a
 * interface só teria o número, e mostraria "saldo insuficiente" para quem
 * nunca vai ser cobrado — administrador e conta de parceiro veriam um aviso
 * de bloqueio que não corresponde a bloqueio nenhum.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const [carteira, dono] = await Promise.all([
    obterCarteira(sessao.userId),
    prisma.user.findUnique({
      where: { id: sessao.userId },
      select: { isentoCobranca: true, papel: true },
    }),
  ])

  // A mesma regra de `pagarEnvio`, e de propósito: se as duas divergirem, a
  // tela promete uma cobrança que o servidor não faz — ou o contrário.
  const isento = dono?.isentoCobranca === true || dono?.papel === 'ADMIN'

  return NextResponse.json({ saldoCentavos: carteira.saldoCentavos, isento })
}

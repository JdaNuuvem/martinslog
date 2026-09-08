import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { PapelUser } from '@prisma/client'
import { SESSION_COOKIE, validarSessaoPorId } from './sessao'

/**
 * Lê a sessão em componentes de servidor (layouts e páginas).
 *
 * As rotas de API usam `lerSessao`, que recebe o `NextRequest`. Um layout
 * não tem requisição, só `cookies()` de `next/headers` — daí este segundo
 * ponto de entrada. A validação em si é a mesma função dos dois lados, para
 * a regra de expiração não divergir.
 */
export async function lerSessaoDoServidor(): Promise<{
  userId: string
  papel: PapelUser
  nome: string
} | null> {
  const armazenamento = await cookies()
  return validarSessaoPorId(armazenamento.get(SESSION_COOKIE)?.value)
}

/**
 * Guarda para PÁGINA da área logada. Chame no início de toda `page.tsx` de
 * `(app)`, antes de qualquer consulta.
 *
 * O layout de `(app)` já chama `redirect('/login')` para quem não tem sessão —
 * e isso NÃO protege os filhos. No App Router o layout e as páginas renderizam
 * em paralelo: o `redirect` decide o que o navegador faz, e a página, que já
 * rodou, vai junto no corpo da resposta. Dá para ver pedindo o payload RSC
 * direto: vem o `NEXT_REDIRECT` e, ao lado dele, a subárvore da página
 * inteira.
 *
 * Hoje nenhuma página de `(app)` consulta o banco no servidor, então não há o
 * que vazar — o que é sorte, não proteção. A primeira que fizer um
 * `await prisma.…` repete o vazamento que a área `/admin` teve, onde 404 vinha
 * acompanhado de 240 KB com telefone e nome de comprador.
 *
 * Esta função existe para que essa página não precise descobrir isso sozinha.
 */
export async function exigirSessaoNaPagina(): Promise<{
  userId: string
  papel: PapelUser
  nome: string
}> {
  const sessao = await lerSessaoDoServidor()

  if (!sessao) {
    redirect('/login')
  }

  return sessao
}

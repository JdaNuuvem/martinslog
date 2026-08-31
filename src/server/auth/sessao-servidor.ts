import { cookies } from 'next/headers'
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

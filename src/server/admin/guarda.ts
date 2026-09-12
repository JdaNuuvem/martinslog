import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'
import type { PapelUser } from '@prisma/client'
import { lerSessao } from '@/server/auth/sessao'

export type SessaoAdmin = { userId: string; papel: PapelUser }

export type ResultadoGuarda =
  | { autorizado: true; sessao: SessaoAdmin }
  | { autorizado: false; resposta: NextResponse }

/**
 * Resposta única de negação da área administrativa: 404, não 403.
 *
 * 403 confirmaria que a rota existe e que há um painel administrativo ali,
 * dando alvo a quem sonda. Para quem não é admin — anônimo ou cliente
 * autenticado, indistintamente — a área simplesmente não existe. A mensagem
 * não menciona sessão, permissão nem login, pelo mesmo motivo.
 */
export function respostaNaoEncontrado(): NextResponse {
  return NextResponse.json({ mensagem: 'Recurso não encontrado.' }, { status: 404 })
}

/**
 * Guarda de autorização da área administrativa, para ser chamada no início
 * de todo route handler de `/api/admin` e no layout de `(admin)`.
 *
 * A checagem é feita aqui, no servidor com acesso ao banco, e não em
 * `middleware.ts`: o middleware roda no runtime edge, que não alcança o
 * Prisma. Lá só existiria o cookie, e o cookie carrega apenas o
 * identificador da sessão — nunca o papel. Guardar o papel no cookie
 * tornaria administrador qualquer pessoa disposta a editar o próprio
 * cookie. `lerSessao` vai ao banco a cada leitura, confere a expiração e
 * devolve o papel como está na tabela `users`.
 *
 * Esconder o link do painel na interface não conta como proteção: a
 * verificação precisa valer para chamada direta à API.
 */
export async function exigirAdmin(request: NextRequest): Promise<ResultadoGuarda> {
  const sessao = await lerSessao(request)

  if (!sessao || sessao.papel !== 'ADMIN') {
    return { autorizado: false, resposta: respostaNaoEncontrado() }
  }

  return { autorizado: true, sessao }
}

/**
 * Guarda para PÁGINA da área administrativa. Chame no início de toda
 * `page.tsx` de `(admin)`, antes de qualquer consulta.
 *
 * Por que na página, e não só no layout: no App Router o layout e os filhos
 * renderizam EM PARALELO. Um `notFound()` no layout troca o status para 404 e
 * a tela que o navegador pinta — e não impede o filho de rodar. As consultas
 * da página já foram ao banco, e o resultado sai no corpo da resposta como
 * payload RSC. Era o que acontecia: `/admin/pedidos` devolvia 404 e, dentro
 * dele, 240 KB com telefone, nome e valor pago de cliente, para qualquer
 * requisição anônima. **404 não prova que a rota está protegida.**
 *
 * Aqui o `notFound()` acontece dentro da própria página, antes das consultas,
 * então não há o que vazar. Cada rota de `/api/admin` já fazia isto por conta
 * própria — é por isso que a API nunca vazou e as páginas vazaram.
 */
export async function exigirAdminNaPagina(): Promise<SessaoAdmin> {
  const cabecalhos = await headers()
  const requisicao = new NextRequest('http://localhost/admin', { headers: cabecalhos })

  const guarda = await exigirAdmin(requisicao)
  if (!guarda.autorizado) {
    notFound()
  }

  return guarda.sessao
}

import { NextResponse, type NextRequest } from 'next/server'
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

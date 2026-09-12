import { NextRequest, NextResponse } from 'next/server'
import { decidir, ipDoPedido } from '@/domain/geo/bloqueio'
import { ehIpBrasileiro, ehIpPrivado } from '@/domain/geo/brasil'

/**
 * Bloqueio por país: a Martins Log atende só o Brasil.
 *
 * A decisão e as exceções vivem em `@/domain/geo/bloqueio` — aqui fica apenas a
 * ligação com o Next.js. A separação é o que permite testar a ORDEM das
 * exceções sem subir servidor, e é na ordem que esse tipo de bloqueio erra.
 *
 * O que NÃO é bloqueado, e por quê, está documentado lá: a API (o integrador
 * está nos Estados Unidos), o rastreio do comprador (que pode estar viajando),
 * robô de busca (senão o site sai do Google) e requisição sem IP (bloquear
 * nesse caso fecharia o site para o Brasil inteiro).
 */
export function middleware(request: NextRequest) {
  const decisao = decidir(
    {
      caminho: request.nextUrl.pathname,
      ip: ipDoPedido(request.headers),
      navegador: request.headers.get('user-agent'),
    },
    { ehBrasileiro: ehIpBrasileiro, ehPrivado: ehIpPrivado },
  )

  if (decisao === 'bloqueia') {
    /*
      Reescreve em vez de redirecionar: o visitante vê a explicação no endereço
      que pediu, sem uma volta pela rede. E `451` em vez de `403` porque a
      recusa é por região de atendimento, não por falta de permissão — o código
      diz a verdade a quem lê log.
    */
    return NextResponse.rewrite(new URL('/fora-do-brasil', request.url), { status: 451 })
  }

  return NextResponse.next()
}

/**
 * Onde o middleware roda.
 *
 * A exclusão de `_next` e de arquivo estático é por custo: eles passariam de
 * qualquer forma pela lista de caminhos livres, e cada requisição de imagem
 * pagaria uma busca binária sem necessidade.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { acharPerfil } from '@/server/perfil-service'
import { listarPerfis } from '@/server/perfil-service'

/**
 * Caixa de entrada: o que os compradores escreveram para a loja.
 *
 * Leitura simples e paginada por data. Não é uma tela de conversa — é o
 * registro de que alguém respondeu, que é a pergunta que aparece primeiro
 * quando se liga um canal de mão dupla: "o cliente respondeu e ninguém viu?".
 */

const LIMITE_PADRAO = 50

const marcarSchema = z.object({
  /** Ids a marcar como lidos. Vazio marca tudo da loja. */
  ids: z.array(z.string().min(1)).max(200).optional(),
})

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagens: [], naoLidas: 0 })

  const [mensagens, naoLidas] = await Promise.all([
    prisma.mensagemRecebida.findMany({
      where: { perfilId: perfil.id },
      orderBy: { recebidaEm: 'desc' },
      take: LIMITE_PADRAO,
      /*
        `payload` fica de fora: é o corpo cru do webhook, guardado para
        investigação, e pode ter kilobytes por mensagem. Mandá-lo para a tela
        multiplicaria o tamanho da resposta por nada — ninguém o lê ali.
      */
      select: {
        id: true,
        de: true,
        nomeContato: true,
        texto: true,
        recebidaEm: true,
        lidaEm: true,
      },
    }),
    prisma.mensagemRecebida.count({ where: { perfilId: perfil.id, lidaEm: null } }),
  ])

  return NextResponse.json({ mensagens, naoLidas })
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  if (!(await acharPerfil(sessao.userId, perfil.id))) {
    return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  }

  const corpo = await request.json().catch(() => ({}))
  const analisado = marcarSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json({ codigo: 'CORPO_INVALIDO' }, { status: 400 })
  }

  const { count } = await prisma.mensagemRecebida.updateMany({
    /*
      O `perfilId` entra no filtro sempre, mesmo com ids informados: sem ele,
      quem mandasse o id de uma mensagem de outra loja a marcaria como lida na
      caixa alheia.
    */
    where: {
      perfilId: perfil.id,
      lidaEm: null,
      ...(analisado.data.ids?.length ? { id: { in: analisado.data.ids } } : {}),
    },
    data: { lidaEm: new Date() },
  })

  return NextResponse.json({ marcadas: count })
}

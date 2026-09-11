import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarPerfis } from '@/server/perfil-service'

/**
 * Respostas prontas do robô, por palavra-chave.
 *
 * Área de administrador porque o robô só funciona pela Evolution, que é
 * restrita — não adiantaria o lojista escrever respostas para um canal que
 * ele não consegue ligar.
 */

const salvarSchema = z.object({
  id: z.string().optional(),
  nome: z.string().trim().min(1, 'Dê um nome para se achar depois.').max(80),
  /** Uma por linha na tela; chega como lista. */
  gatilhos: z.array(z.string().trim().min(1)).min(1, 'Informe ao menos uma palavra.').max(30),
  resposta: z.string().trim().min(1, 'Escreva a resposta.').max(1000),
  ordem: z.number().int().min(0).max(999).optional(),
  ativo: z.boolean().optional(),
})

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfil = await perfilDaConta(guarda.sessao.userId)
  if (!perfil) return NextResponse.json({ respostas: [] })

  return NextResponse.json({
    respostas: await prisma.respostaAutomatica.findMany({
      where: { perfilId: perfil.id },
      orderBy: { ordem: 'asc' },
    }),
  })
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfil = await perfilDaConta(guarda.sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const corpo = await request.json().catch(() => ({}))
  const analisado = salvarSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const dados = {
    nome: analisado.data.nome,
    gatilhos: analisado.data.gatilhos,
    resposta: analisado.data.resposta,
    ordem: analisado.data.ordem ?? 0,
    ativo: analisado.data.ativo ?? true,
  }

  if (analisado.data.id) {
    /*
      `updateMany` com o perfil no filtro, e não `update` pelo id: sem o
      perfil, quem mandasse o id de uma regra de outra conta a editaria.
    */
    const { count } = await prisma.respostaAutomatica.updateMany({
      where: { id: analisado.data.id, perfilId: perfil.id },
      data: dados,
    })
    if (count === 0) {
      return NextResponse.json({ mensagem: 'Resposta não encontrada.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  }

  const criada = await prisma.respostaAutomatica.create({
    data: { perfilId: perfil.id, ...dados },
  })
  return NextResponse.json({ id: criada.id })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfil = await perfilDaConta(guarda.sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ codigo: 'ID_AUSENTE' }, { status: 400 })

  await prisma.respostaAutomatica.deleteMany({ where: { id, perfilId: perfil.id } })
  return NextResponse.json({ ok: true })
}

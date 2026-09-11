import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { acharPerfil, listarPerfis } from '@/server/perfil-service'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { horaLocal, registrarNaoPerturbe } from '@/server/pode-enviar'

/**
 * Janela de silêncio e lista de quem pediu para parar.
 *
 * Não é área de administrador: decidir o horário de falar com o próprio
 * cliente e respeitar quem pediu para sair é do lojista. Restringir isso
 * empurraria o pedido de saída para uma fila de suporte, e o comprador que
 * pediu não tem por que esperar.
 */

const salvarSchema = z.object({
  silencioAtivo: z.boolean(),
  silencioInicioHora: z.number().int().min(0).max(23),
  silencioFimHora: z.number().int().min(0).max(23),
})

const bloquearSchema = z.object({
  contato: z.string().min(1, 'Informe o número.'),
  motivo: z.string().max(200).optional().nullable(),
})

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ silencio: null, bloqueados: [] })

  const [loja, bloqueados] = await Promise.all([
    prisma.perfil.findUnique({
      where: { id: perfil.id },
      select: { silencioAtivo: true, silencioInicioHora: true, silencioFimHora: true },
    }),
    prisma.naoPerturbe.findMany({
      where: { perfilId: perfil.id },
      orderBy: { criadoEm: 'desc' },
      take: 100,
      select: { id: true, contato: true, origem: true, motivo: true, criadoEm: true },
    }),
  ])

  return NextResponse.json({
    silencio: loja,
    bloqueados,
    /*
      A hora do servidor vai junto para a tela poder dizer "agora são 19h,
      está liberado". Sem isso, quem configura 22h–8h não tem como saber se a
      janela está valendo neste instante — e a dúvida vira chamado de suporte
      dizendo que as mensagens pararam.
    */
    horaAgora: horaLocal(),
  })
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const corpo = await request.json().catch(() => ({}))
  const analisado = salvarSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Horário inválido.' },
      { status: 400 },
    )
  }

  await prisma.perfil.update({ where: { id: perfil.id }, data: analisado.data })
  return NextResponse.json({ ok: true })
}

/** A loja registra um pedido de saída que chegou por fora (telefone, e-mail). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const corpo = await request.json().catch(() => ({}))
  const analisado = bloquearSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json({ codigo: 'CORPO_INVALIDO' }, { status: 400 })
  }

  const contato = normalizarTelefone(analisado.data.contato)
  if (!contato) {
    return NextResponse.json(
      { codigo: 'TELEFONE_INVALIDO', mensagem: 'Esse número não parece válido.' },
      { status: 400 },
    )
  }

  await registrarNaoPerturbe({
    perfilId: perfil.id,
    contato,
    origem: 'LOJA',
    motivo: analisado.data.motivo ?? null,
  })

  return NextResponse.json({ ok: true })
}

/**
 * Reativa um número.
 *
 * Existe para o engano — alguém registrou o telefone errado. NÃO é para
 * desfazer um pedido do comprador: quem pediu para sair só volta escrevendo
 * de novo, e é por isso que a tela pede confirmação antes.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  if (!(await acharPerfil(sessao.userId, perfil.id))) {
    return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ codigo: 'ID_AUSENTE' }, { status: 400 })

  await prisma.naoPerturbe.deleteMany({ where: { id, perfilId: perfil.id } })
  return NextResponse.json({ ok: true })
}

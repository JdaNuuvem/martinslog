import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { exigirAdmin } from '@/server/admin/guarda'
import { listarPerfis } from '@/server/perfil-service'
import { cancelarCampanha, criarCampanha, listarCampanhas } from '@/server/campanha-service'

/**
 * Campanhas: a mesma mensagem para muitos compradores.
 *
 * Área de administrador, e não por organização — é o recurso que pode custar
 * o número da loja. Quem dispara precisa ser quem entende o risco.
 *
 * As travas de volume NÃO estão aqui: moram em `campanha-service`, junto do
 * envio. Uma trava na borda é uma trava que a segunda rota esquece.
 */

const criarSchema = z.object({
  nome: z.string().trim().min(1, 'Dê um nome à campanha.').max(80),
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(1000),
  agendadaPara: z.string().datetime().optional().nullable(),
  destinatarios: z
    .array(z.object({ contato: z.string().min(1), nome: z.string().optional().nullable() }))
    .min(1, 'Informe ao menos um destinatário.')
    .max(2000, 'Máximo de 2000 por campanha.'),
})

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfil = await perfilDaConta(guarda.sessao.userId)
  if (!perfil) return NextResponse.json({ campanhas: [] })

  return NextResponse.json({
    campanhas: await listarCampanhas(guarda.sessao.userId, perfil.id),
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const perfil = await perfilDaConta(guarda.sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const corpo = await request.json().catch(() => ({}))
  const analisado = criarSchema.safeParse(corpo)
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

  try {
    const resultado = await criarCampanha(guarda.sessao.userId, perfil.id, {
      nome: analisado.data.nome,
      texto: analisado.data.texto,
      agendadaPara: analisado.data.agendadaPara ? new Date(analisado.data.agendadaPara) : null,
      destinatarios: analisado.data.destinatarios,
    })
    return NextResponse.json(resultado)
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ codigo: erro.codigo, mensagem: erro.message }, { status: 400 })
    }
    throw erro
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ codigo: 'ID_AUSENTE' }, { status: 400 })

  try {
    await cancelarCampanha(guarda.sessao.userId, id)
    return NextResponse.json({ ok: true })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ mensagem: 'Campanha não encontrada.' }, { status: 404 })
    }
    throw erro
  }
}

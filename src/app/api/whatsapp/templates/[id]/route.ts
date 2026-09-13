import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import {
  apagarTemplate,
  atualizarTemplate,
  templateSchema,
} from '@/server/whatsapp/template-whatsapp-service'
import { corpoInvalido, respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const analisado = templateSchema.safeParse(await request.json().catch(() => null))
  if (!analisado.success) {
    return corpoInvalido(analisado.error.issues[0]?.message ?? 'Resposta pronta inválida.')
  }

  try {
    const template = await atualizarTemplate(guarda.sessao.userId, id, analisado.data)
    return NextResponse.json({ template })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  try {
    await apagarTemplate(guarda.sessao.userId, id)
    return NextResponse.json({ ok: true })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

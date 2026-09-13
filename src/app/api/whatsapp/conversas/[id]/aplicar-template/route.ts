import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirAdmin } from '@/server/admin/guarda'
import { aplicarTemplate } from '@/server/whatsapp/template-whatsapp-service'
import { corpoInvalido, respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

const corpoSchema = z.object({ templateId: z.string().min(1) })

/**
 * Preenche a resposta pronta com os dados da conversa, SEM enviar.
 *
 * O texto volta para a caixa de digitação: o atendente confere e ajusta antes
 * de mandar. Enviar direto tiraria dele a chance de ver um pedido errado.
 */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const analisado = corpoSchema.safeParse(await request.json().catch(() => null))
  if (!analisado.success) return corpoInvalido('Escolha uma resposta pronta.')

  try {
    const texto = await aplicarTemplate(guarda.sessao.userId, id, analisado.data.templateId)
    return NextResponse.json({ texto })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirAdmin } from '@/server/admin/guarda'
import { assumirConversa, devolverAoRobo } from '@/server/conversa-service'
import { corpoInvalido, respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

const acaoSchema = z.object({ acao: z.enum(['assumir', 'devolver-ao-robo']) })

/** Assumir a conversa (robô calado pelo prazo padrão) ou devolvê-la ao robô. */
export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const analisado = acaoSchema.safeParse(await request.json().catch(() => null))
  if (!analisado.success) return corpoInvalido('Ação inválida.')

  try {
    if (analisado.data.acao === 'assumir') {
      const ate = await assumirConversa(guarda.sessao.userId, id)
      return NextResponse.json({ ok: true, roboPausadoAte: ate.toISOString() })
    }
    await devolverAoRobo(guarda.sessao.userId, id)
    return NextResponse.json({ ok: true, roboPausadoAte: null })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

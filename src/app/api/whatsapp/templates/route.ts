import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { lojaDaCaixa } from '@/server/whatsapp/caixa-service'
import {
  criarTemplate,
  listarTemplates,
  templateSchema,
} from '@/server/whatsapp/template-whatsapp-service'
import { corpoInvalido, respostaDeErro } from '@/server/whatsapp/resposta-http'

/**
 * Respostas prontas do WhatsApp de uma loja.
 *
 * A primeira listagem de uma loja sem nenhuma cria as padrão: uma caixa de
 * respostas vazia ensina menos do que cinco exemplos editáveis.
 */

async function perfilDaRequisicao(request: NextRequest, userId: string, doCorpo?: unknown) {
  const pedido =
    request.nextUrl.searchParams.get('perfilId') ?? (typeof doCorpo === 'string' ? doCorpo : null)
  return lojaDaCaixa(userId, pedido)
}

function semLoja(): NextResponse {
  return NextResponse.json({ codigo: 'NAO_ENCONTRADO', mensagem: 'Loja não encontrada.' }, { status: 404 })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  try {
    const perfilId = await perfilDaRequisicao(request, guarda.sessao.userId)
    if (!perfilId) return semLoja()
    return NextResponse.json({ templates: await listarTemplates(guarda.sessao.userId, perfilId) })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const analisado = templateSchema.safeParse(corpo)
  if (!analisado.success) {
    return corpoInvalido(analisado.error.issues[0]?.message ?? 'Resposta pronta inválida.')
  }

  try {
    const perfilId = await perfilDaRequisicao(request, guarda.sessao.userId, corpo?.perfilId)
    if (!perfilId) return semLoja()
    const template = await criarTemplate(guarda.sessao.userId, perfilId, analisado.data)
    return NextResponse.json({ template }, { status: 201 })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

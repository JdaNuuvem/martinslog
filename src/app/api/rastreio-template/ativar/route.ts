import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { alternarTemplate } from '@/server/template-rastreio-service'
import { reaplicarTemplateNosEnvios } from '@/server/reaplicar-template-service'

const schema = z.object({
  ativo: z.boolean(),
  /**
   * Reescrever a linha do tempo dos envios já emitidos com o percurso da
   * conta. Sai `false` por padrão: mexer no rastreio que o destinatário já
   * consultou é decisão consciente de quem ativa, nunca o comportamento
   * silencioso de ligar uma chave.
   */
  reaplicarNosEnvios: z.boolean().optional(),
})

/**
 * Liga ou desliga o template de percurso da conta autenticada.
 *
 * Ligar vale para as etiquetas emitidas daí em diante; as anteriores só
 * mudam com `reaplicarNosEnvios`, e a resposta diz quantas foram reescritas
 * para a tela poder informar o que de fato aconteceu.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = schema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Dados inválidos.' },
      { status: 400 },
    )
  }

  const { ativo, reaplicarNosEnvios } = analisado.data

  try {
    await alternarTemplate(sessao.userId, ativo)

    const enviosAtualizados =
      ativo && reaplicarNosEnvios ? await reaplicarTemplateNosEnvios(sessao.userId) : 0

    return NextResponse.json({ ativo, enviosAtualizados })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao alternar o template de rastreio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao ativar o percurso.' },
      { status: 500 },
    )
  }
}

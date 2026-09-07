import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { listarPerfis } from '@/server/perfil-service'
import { desconectar, obterConfig, salvarConfig } from '@/server/sms-service'

/**
 * SMS da loja: ler, conectar e desconectar.
 *
 * Espelha `/api/whatsapp` de propósito — são o mesmo problema com outro
 * provedor, e duas telas que se comportam diferente para a mesma tarefa é
 * como se ensina o lojista a desconfiar da que ele não usou ainda.
 *
 * A chave do provedor nunca volta em leitura: sai só a dica (últimos
 * caracteres). SMS é cobrado por mensagem, então uma chave vazada é conta
 * alheia gastando dinheiro do lojista.
 */

const corpoSchema = z.object({
  perfilId: z.string().min(1),
  provedor: z.string().trim().min(1, 'Informe o provedor.'),
  /** Ausente numa atualização mantém a chave atual. */
  chave: z.string().trim().optional().or(z.literal('')),
  identificador: z.string().trim().optional().or(z.literal('')),
  remetente: z.string().trim().optional().or(z.literal('')),
})

/** O primeiro perfil da conta, que é onde a configuração mora. */
async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) {
    return NextResponse.json(
      {
        codigo: 'SEM_PERFIL',
        mensagem: 'Esta conta ainda não tem uma loja. Crie uma em Perfis para conectar o SMS.',
      },
      { status: 409 },
    )
  }

  const config = await obterConfig(sessao.userId, perfil.id)
  return NextResponse.json({ perfil: { id: perfil.id, nome: perfil.nome }, config })
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = corpoSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do SMS inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    await salvarConfig(sessao.userId, analisado.data.perfilId, {
      provedor: analisado.data.provedor,
      chave: analisado.data.chave || null,
      identificador: analisado.data.identificador || null,
      remetente: analisado.data.remetente || null,
    })

    const config = await obterConfig(sessao.userId, analisado.data.perfilId)
    return NextResponse.json({ config })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ codigo: erro.codigo, mensagem: erro.message }, { status: 400 })
    }
    /*
      `salvarConfig` lança Error simples quando falta a chave na primeira vez.
      Devolver 400 com a mensagem dele é melhor que 500: é erro de quem
      preencheu, não do servidor.
    */
    if (erro instanceof Error && erro.message.includes('chave')) {
      return NextResponse.json({ codigo: 'CHAVE_AUSENTE', mensagem: erro.message }, { status: 400 })
    }
    console.error('Falha ao salvar o SMS', { cause: erro })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao salvar o SMS.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  await desconectar(sessao.userId, perfil.id)
  return NextResponse.json({ config: null })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { listarPerfis } from '@/server/perfil-service'
import { catalogoPronto, conferirRegrasDaMeta } from '@/domain/mensagem/whatsapp-textos'
import { desconectar, obterConfig, salvarConfig } from '@/server/whatsapp-service'

/**
 * WhatsApp da loja: ler, conectar e desconectar.
 *
 * O perfil vem sempre da conta autenticada, nunca de um id no corpo. Um perfil
 * informado pela tela é um perfil que uma hora vem trocado — e o comprador
 * receberia a mensagem pelo número de outra loja, sem nada acusar o erro.
 *
 * O token permanente da Meta nunca volta em leitura. Sai só a dica (últimos
 * caracteres), porque um segredo que volta numa resposta transforma qualquer
 * falha de autorização em permissão de mandar mensagem em nome da loja.
 */

const corpoSchema = z.object({
  perfilId: z.string().min(1),
  phoneNumberId: z.string().trim().min(1, 'Informe o ID do número.'),
  wabaId: z.string().trim().optional().or(z.literal('')),
  /** Ausente numa atualização mantém o token atual. */
  token: z.string().trim().optional().or(z.literal('')),
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
        mensagem: 'Esta conta ainda não tem uma loja. Crie uma em Perfis para conectar o WhatsApp.',
      },
      { status: 409 },
    )
  }

  const config = await obterConfig(sessao.userId, perfil.id)

  /*
    Os textos prontos vão junto da configuração, e não numa rota separada, por
    um motivo prático: eles não servem para nada depois de conectar — servem
    ANTES, para o lojista cadastrar na Meta. A tela precisa dos dois ao mesmo
    tempo para explicar a ordem das coisas.
  */
  const textos = catalogoPronto().map((c) => ({
    evento: c.evento.codigo,
    rotulo: c.evento.rotulo,
    descricao: c.evento.descricao,
    nome: c.nome,
    idioma: c.idioma,
    categoria: c.categoria,
    corpo: c.corpo,
    variaveis: c.variaveis,
    exemplos: c.exemplos,
    previa: c.previa,
    recusas: conferirRegrasDaMeta(c),
  }))

  return NextResponse.json({ perfil: { id: perfil.id, nome: perfil.nome }, config, textos })
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
        mensagem: 'Dados do WhatsApp inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    /*
      `salvarConfig` fala com a Meta antes de gravar como ativa. Gravar sem
      verificar deixaria a tela dizendo "conectado" para um token digitado
      errado, e o lojista só descobriria na primeira venda que não avisou
      ninguém — quando o prejuízo já aconteceu.
    */
    await salvarConfig(sessao.userId, analisado.data.perfilId, {
      phoneNumberId: analisado.data.phoneNumberId,
      wabaId: analisado.data.wabaId || null,
      token: analisado.data.token || null,
    })

    const config = await obterConfig(sessao.userId, analisado.data.perfilId)
    return NextResponse.json({ config })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ codigo: erro.codigo, mensagem: erro.message }, { status: 400 })
    }
    console.error('Falha ao salvar o WhatsApp', { cause: erro })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao salvar o WhatsApp.' },
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

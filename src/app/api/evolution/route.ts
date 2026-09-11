import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { listarPerfis } from '@/server/perfil-service'
import { evolutionDisponivel } from '@/infra/whatsapp'
import { desconectar, escolherProvedor, obterConexao } from '@/server/evolution-service'

/**
 * Conexão da loja com a Evolution: ler o estado, escolher o provedor,
 * desconectar.
 *
 * O `perfilId` vem sempre da sessão, nunca do corpo — mesmo motivo do
 * `/api/whatsapp`: um perfil informado pela tela é um perfil que uma hora vem
 * trocado, e a loja pareia o celular na conta de outra pessoa.
 *
 * A `apikey` da Evolution nunca sai daqui. O navegador pede o QR; quem vai
 * buscá-lo é o servidor.
 */

const corpoSchema = z.object({
  provedor: z.enum(['META', 'EVOLUTION']),
})

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

/**
 * Busca à parte em vez de crescer `PerfilResumo`.
 *
 * Aquele tipo alimenta a LISTAGEM de perfis, que roda em toda troca de loja no
 * topo da tela. Carregar nele um campo que só esta rota usa cobraria a leitura
 * de todo mundo para servir a um.
 */
async function provedorDaLoja(perfilId: string): Promise<'META' | 'EVOLUTION'> {
  const loja = await prisma.perfil.findUnique({
    where: { id: perfilId },
    select: { whatsappProvedor: true },
  })
  return loja?.whatsappProvedor ?? 'META'
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

  if (!evolutionDisponivel()) {
    /*
      200 com `disponivel: false`, e não erro: a tela precisa se desenhar
      explicando que o canal não existe neste servidor. Um 500 aqui viraria
      "não foi possível carregar", que manda o lojista procurar defeito onde
      só falta instalação.
    */
    return NextResponse.json({
      disponivel: false,
      perfil: { id: perfil.id, nome: perfil.nome },
      provedor: await provedorDaLoja(perfil.id),
      conexao: null,
    })
  }

  try {
    const conexao = await obterConexao(sessao.userId, perfil.id)
    return NextResponse.json({
      disponivel: true,
      perfil: { id: perfil.id, nome: perfil.nome },
      provedor: await provedorDaLoja(perfil.id),
      conexao,
    })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ codigo: erro.codigo, mensagem: erro.message }, { status: 502 })
    }
    console.error('Falha ao consultar a Evolution', { cause: erro })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao consultar a Evolution.' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

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
      { codigo: 'CORPO_INVALIDO', mensagem: 'Provedor inválido.' },
      { status: 400 },
    )
  }

  if (analisado.data.provedor === 'EVOLUTION' && !evolutionDisponivel()) {
    return NextResponse.json(
      {
        codigo: 'EVOLUTION_INDISPONIVEL',
        mensagem: 'A Evolution não está configurada neste servidor.',
      },
      { status: 409 },
    )
  }

  await escolherProvedor(sessao.userId, perfil.id, analisado.data.provedor)
  return NextResponse.json({ provedor: analisado.data.provedor })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  await desconectar(sessao.userId, perfil.id)
  return NextResponse.json({ conexao: null })
}

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { DomainError } from '@/domain/errors'
import { cadastroRequestSchema, loginRequestSchema } from '@/lib/auth-schema'
import { cadastrarUsuario } from '@/server/auth/cadastro'
import { autenticar, MENSAGEM_CREDENCIAIS_INVALIDAS } from '@/server/auth/login'
import { criarSessao, encerrarSessao } from '@/server/auth/sessao'
import { registrarTentativa } from '@/server/auth/rate-limit'

const ANON_SESSION_COOKIE = 'anon_session_id'

function obterIp(request: NextRequest): string {
  const encaminhado = request.headers.get('x-forwarded-for')
  if (encaminhado) {
    return encaminhado.split(',')[0]!.trim()
  }
  return 'desconhecido'
}

async function lerCorpo(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

async function tratarCadastro(request: NextRequest): Promise<NextResponse> {
  const corpo = await lerCorpo(request)
  const analisado = cadastroRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados de cadastro inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const entrada = analisado.data
  const ip = obterIp(request)

  if (!registrarTentativa('cadastro', ip, entrada.email)) {
    return NextResponse.json(
      { codigo: 'LIMITE_TENTATIVAS_EXCEDIDO', mensagem: 'Muitas tentativas. Tente novamente mais tarde.' },
      { status: 429 },
    )
  }

  try {
    const anonSessionId = request.cookies.get(ANON_SESSION_COOKIE)?.value ?? null

    const resultado = await cadastrarUsuario(
      {
        nome: entrada.nome,
        documento: entrada.documento,
        email: entrada.email,
        telefone: entrada.telefone,
        senha: entrada.senha,
      },
      { anonSessionId },
    )

    const resposta = NextResponse.json({ userId: resultado.userId }, { status: 201 })
    await criarSessao(resultado.userId, resposta)
    if (anonSessionId) {
      resposta.cookies.delete(ANON_SESSION_COOKIE)
    }
    return resposta
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json(
        { codigo: 'EMAIL_JA_CADASTRADO', mensagem: 'E-mail ou documento já cadastrado.' },
        { status: 409 },
      )
    }

    if (error instanceof DomainError) {
      const status = error.codigo === 'EMAIL_JA_CADASTRADO' ? 409 : 422
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
    }

    console.error('Erro inesperado ao cadastrar usuário', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar o cadastro.' },
      { status: 500 },
    )
  }
}

async function tratarLogin(request: NextRequest): Promise<NextResponse> {
  const corpo = await lerCorpo(request)
  const analisado = loginRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Dados de login inválidos.' },
      { status: 400 },
    )
  }

  const entrada = analisado.data
  const ip = obterIp(request)

  if (!registrarTentativa('login', ip, entrada.email)) {
    return NextResponse.json(
      { codigo: 'LIMITE_TENTATIVAS_EXCEDIDO', mensagem: 'Muitas tentativas. Tente novamente mais tarde.' },
      { status: 429 },
    )
  }

  try {
    const resposta = NextResponse.json({}, { status: 200 })
    const resultado = await autenticar({ email: entrada.email, senha: entrada.senha }, resposta)
    return NextResponse.json({ userId: resultado.userId }, { status: 200, headers: resposta.headers })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: MENSAGEM_CREDENCIAIS_INVALIDAS }, { status: 401 })
    }

    console.error('Erro inesperado ao autenticar usuário', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar o login.' },
      { status: 500 },
    )
  }
}

async function tratarLogout(request: NextRequest): Promise<NextResponse> {
  const resposta = NextResponse.json({}, { status: 200 })
  await encerrarSessao(request, resposta)
  return resposta
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ rota: string[] }> },
): Promise<NextResponse> {
  const { rota } = await context.params
  const acao = rota?.[0]

  switch (acao) {
    case 'cadastro':
      return tratarCadastro(request)
    case 'login':
      return tratarLogin(request)
    case 'logout':
      return tratarLogout(request)
    default:
      return NextResponse.json(
        { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: 'Rota de autenticação não encontrada.' },
        { status: 404 },
      )
  }
}

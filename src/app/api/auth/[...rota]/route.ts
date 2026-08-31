import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { env } from '@/env'
import { DomainError } from '@/domain/errors'
import { cadastroRequestSchema, loginRequestSchema } from '@/lib/auth-schema'
import { cadastrarUsuario } from '@/server/auth/cadastro'
import { autenticar, MENSAGEM_CREDENCIAIS_INVALIDAS } from '@/server/auth/login'
import { criarSessao, encerrarSessao } from '@/server/auth/sessao'
import { limiteExcedido, limparPorEmail, registrarFalha, registrarTentativa } from '@/server/auth/rate-limit'

const ANON_SESSION_COOKIE = 'anon_session_id'

/**
 * Determina o IP de origem para o rate limit. `x-forwarded-for` e
 * `x-real-ip` são cabeçalhos que o próprio cliente pode enviar — só são
 * confiáveis quando um proxy reverso na frente da aplicação os sobrescreve
 * (sinalizado por `TRUST_PROXY_HEADERS`). Sem um proxy confiável, usá-los
 * permite contornar o rate limit por IP trocando o cabeçalho a cada
 * tentativa; por isso, quando `TRUST_PROXY_HEADERS` é falso, eles são
 * ignorados por completo e todas as requisições caem no mesmo IP
 * "desconhecido" (o rate limit por e-mail continua valendo normalmente).
 *
 * Quando confiável, prioriza `x-real-ip` (tipicamente fixado pelo proxy
 * para o IP real de um único salto) e, na ausência dele, usa o *último*
 * salto de `x-forwarded-for` — o mais próximo do proxy e, portanto, o
 * único trecho da cadeia que o proxy realmente controla; o primeiro salto
 * é escrito pelo cliente e pode ser qualquer coisa.
 */
function obterIp(request: NextRequest): string {
  if (!env.TRUST_PROXY_HEADERS) {
    return 'desconhecido'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  const encaminhado = request.headers.get('x-forwarded-for')
  if (encaminhado) {
    const saltos = encaminhado.split(',').map((s) => s.trim())
    const ultimoSalto = saltos[saltos.length - 1]
    if (ultimoSalto) {
      return ultimoSalto
    }
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

  // A cota é verificada e consumida somente no caminho de falha (no catch
  // abaixo) — não antes de tentar autenticar. Isso garante que uma senha
  // correta nunca é barrada pelo rate limit, mesmo vindo logo depois de
  // várias tentativas erradas: só quem erra a senha paga a cota, e o 6º
  // login *correto* seguido do mesmo usuário continua funcionando.
  try {
    const resposta = NextResponse.json({}, { status: 200 })
    const resultado = await autenticar({ email: entrada.email, senha: entrada.senha }, resposta)
    // Sucesso: zera o contador de e-mail para não deixar falhas antigas
    // bloqueando o próximo login legítimo da mesma pessoa.
    limparPorEmail('login', entrada.email)
    return NextResponse.json({ userId: resultado.userId }, { status: 200, headers: resposta.headers })
  } catch (error) {
    if (error instanceof DomainError) {
      if (limiteExcedido('login', ip, entrada.email)) {
        return NextResponse.json(
          { codigo: 'LIMITE_TENTATIVAS_EXCEDIDO', mensagem: 'Muitas tentativas. Tente novamente mais tarde.' },
          { status: 429 },
        )
      }

      registrarFalha('login', ip, entrada.email)
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

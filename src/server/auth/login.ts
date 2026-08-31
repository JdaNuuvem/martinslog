import type { NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { CredenciaisInvalidasError } from '@/domain/errors'
import { HASH_DUMMY, verificarSenha } from './senha'
import { criarSessao } from './sessao'

/**
 * Mensagem única para e-mail inexistente e senha errada: textos diferentes
 * permitem enumerar quem tem conta na plataforma.
 */
export const MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.'

export type DadosLogin = {
  email: string
  senha: string
}

export type ResultadoLogin = {
  userId: string
  sessionId: string
}

/**
 * Autentica o usuário. Quando o e-mail não existe, ainda assim verifica a
 * senha contra um hash argon2id fixo (dummy) antes de responder — sem isso,
 * a diferença de tempo entre "e-mail existe" e "e-mail não existe" entrega
 * quais e-mails têm conta na plataforma.
 */
export async function autenticar(dados: DadosLogin, response: NextResponse): Promise<ResultadoLogin> {
  const emailNormalizado = dados.email.trim().toLowerCase()

  const user = await prisma.user.findUnique({ where: { email: emailNormalizado } })

  const hashParaComparar = user?.senhaHash ?? HASH_DUMMY
  const senhaConfere = await verificarSenha(hashParaComparar, dados.senha)

  if (!user || !senhaConfere) {
    throw new CredenciaisInvalidasError(MENSAGEM_CREDENCIAIS_INVALIDAS)
  }

  const sessionId = await criarSessao(user.id, response)

  return { userId: user.id, sessionId }
}

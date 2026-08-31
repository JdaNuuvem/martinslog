import { prisma } from '@/infra/db/client'
import { normalizarDocumento, validarCnpj, validarCpf } from '@/domain/auth/documento'
import { DocumentoInvalidoError, EmailJaCadastradoError } from '@/domain/errors'
import { hashSenha } from './senha'

export type DadosCadastro = {
  nome: string
  documento: string
  email: string
  telefone?: string
  senha: string
}

export type ContextoCadastro = {
  anonSessionId: string | null
}

export type ResultadoCadastro = {
  userId: string
}

/**
 * Cria o usuário e a carteira (saldo zero) na mesma transação. Se houver
 * uma `AnonSession` associada (cookie do visitante anônimo), migra as
 * cotações (`Quote`) daquela sessão para o novo usuário, também na mesma
 * transação — é o que faz a cotação sobreviver ao cadastro.
 *
 * A migração é de uso único: `AnonSession.id` não é um segredo (mesmo como
 * UUID, o cookie pode ser copiado por outro processo em algum ponto da
 * rede), então a prova real de posse é o cadastro chegar primeiro. Dentro
 * da transação, o `updateMany` só marca `consumidaEm` se ele ainda for
 * nulo — se duas cadastros concorrentes citarem a mesma `AnonSession`,
 * apenas o primeiro a commitar consegue `count === 1` e migra as cotações;
 * o segundo não migra nada. Só cotações com `userId` ainda nulo são
 * movidas, então uma `AnonSession` já consumida (ou forjada apontando para
 * cotações que já têm dono) nunca transfere nada.
 */
export async function cadastrarUsuario(
  dados: DadosCadastro,
  contexto: ContextoCadastro,
): Promise<ResultadoCadastro> {
  const documentoNormalizado = normalizarDocumento(dados.documento)

  const ehCpf = documentoNormalizado.length === 11
  const ehCnpj = documentoNormalizado.length === 14
  const documentoValido = ehCpf ? validarCpf(documentoNormalizado) : ehCnpj ? validarCnpj(documentoNormalizado) : false

  if (!documentoValido) {
    throw new DocumentoInvalidoError('CPF ou CNPJ inválido.')
  }

  const emailNormalizado = dados.email.trim().toLowerCase()

  const jaExiste = await prisma.user.findFirst({
    where: { OR: [{ email: emailNormalizado }, { documento: documentoNormalizado }] },
  })
  if (jaExiste) {
    throw new EmailJaCadastradoError('E-mail ou documento já cadastrado.')
  }

  const senhaHash = await hashSenha(dados.senha)

  const userId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        tipo: ehCpf ? 'PF' : 'PJ',
        papel: 'CLIENTE',
        documento: documentoNormalizado,
        nome: dados.nome.trim(),
        email: emailNormalizado,
        senhaHash,
        telefone: dados.telefone?.trim() || null,
      },
    })

    await tx.wallet.create({
      data: { userId: user.id, saldoCentavos: 0 },
    })

    if (contexto.anonSessionId) {
      const consumida = await tx.anonSession.updateMany({
        where: { id: contexto.anonSessionId, consumidaEm: null },
        data: { consumidaEm: new Date() },
      })

      if (consumida.count === 1) {
        await tx.quote.updateMany({
          where: { anonSessionId: contexto.anonSessionId, userId: null },
          data: { userId: user.id },
        })
      }
    }

    return user.id
  })

  return { userId }
}

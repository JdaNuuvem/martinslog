import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import {
  statusPorCodigoDoTemplate,
  validarTemplate,
  type PassoTemplate,
} from '@/domain/rastreio/template-rastreio'

/**
 * Template de percurso da conta.
 *
 * Sem template ativo, o envio segue o roteiro automático por cenário. Com
 * template, a sequência declarada substitui esse roteiro por completo.
 */

type ClientePrisma = Prisma.TransactionClient | typeof prisma

function paraPassos(valor: unknown): PassoTemplate[] {
  if (!Array.isArray(valor)) return []
  return valor as PassoTemplate[]
}

/** Devolve o template da conta, ou `null` se ela usa o caminho padrão. */
export async function obterTemplate(
  userId: string,
  cliente: ClientePrisma = prisma,
): Promise<{ passos: PassoTemplate[]; ativo: boolean } | null> {
  const registro = await cliente.rastreioTemplate.findUnique({ where: { userId } })
  if (!registro) return null

  return { passos: paraPassos(registro.passos), ativo: registro.ativo }
}

/**
 * Salva o template, validando a sequência inteira antes de gravar.
 *
 * A validação é do percurso completo, não passo a passo: um passo válido
 * isolado pode vir depois de outro que encerra o envio, e só a sequência
 * revela isso.
 */
export async function salvarTemplate(userId: string, passos: PassoTemplate[]) {
  validarTemplate(passos)

  const dados = { passos: passos as unknown as Prisma.InputJsonValue, ativo: true }

  const existente = await prisma.rastreioTemplate.findUnique({ where: { userId } })

  return existente
    ? prisma.rastreioTemplate.update({ where: { userId }, data: dados })
    : prisma.rastreioTemplate.create({ data: { userId, ...dados } })
}

/** Desliga o template sem apagá-lo: a conta volta ao caminho padrão. */
export async function alternarTemplate(userId: string, ativo: boolean) {
  const existente = await prisma.rastreioTemplate.findUnique({ where: { userId } })
  if (!existente) {
    throw new ValorInvalidoError('Nenhum template salvo para esta conta.')
  }

  return prisma.rastreioTemplate.update({ where: { userId }, data: { ativo } })
}

/** Remove o template. A conta volta ao caminho padrão da simulação. */
export async function removerTemplate(userId: string): Promise<void> {
  await prisma.rastreioTemplate.deleteMany({ where: { userId } })
}

/** Mapa código→status do template, para os pontos de leitura traduzirem. */
export async function statusPorCodigoDaConta(
  userId: string,
  cliente: ClientePrisma = prisma,
): Promise<Record<string, string>> {
  const template = await obterTemplate(userId, cliente)
  if (!template) return {}

  return statusPorCodigoDoTemplate(template.passos)
}

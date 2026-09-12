import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import {
  normalizarDias,
  ordenarPorConexoes,
  statusPorCodigoDoTemplate,
  validarTemplate,
  type ConexaoTemplate,
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

function paraConexoes(valor: unknown): ConexaoTemplate[] {
  if (!Array.isArray(valor)) return []
  return valor as ConexaoTemplate[]
}

/** Devolve o template da conta, ou `null` se ela usa o caminho padrão. */
export async function obterTemplate(
  userId: string,
  cliente: ClientePrisma = prisma,
): Promise<{ passos: PassoTemplate[]; conexoes: ConexaoTemplate[]; ativo: boolean } | null> {
  const registro = await cliente.rastreioTemplate.findUnique({ where: { userId } })
  if (!registro) return null

  const passos = paraPassos(registro.passos)
  const conexoes = paraConexoes(registro.conexoes)

  // A ordem entregue já é a do percurso: quem consome não precisa saber que
  // existe um grafo por trás, e a ordem do array deixa de ser fonte de
  // verdade concorrente com as setas.
  //
  // A conversão dos dias vem depois de ordenar, e não antes: o intervalo de
  // um passo só quer dizer alguma coisa depois de saber quem vem antes dele.
  return {
    passos: normalizarDias(ordenarPorConexoes(passos, conexoes)),
    conexoes,
    ativo: registro.ativo,
  }
}

/**
 * Salva o template, validando a sequência inteira antes de gravar.
 *
 * A validação é do percurso completo, não passo a passo: um passo válido
 * isolado pode vir depois de outro que encerra o envio, e só a sequência
 * revela isso.
 */
export async function salvarTemplate(
  userId: string,
  passos: PassoTemplate[],
  conexoes: ConexaoTemplate[] = [],
) {
  // Valida a ordem que vai valer de fato — a das conexões —, e não a ordem
  // em que os nós foram criados. Validar a outra deixaria passar um percurso
  // que só quebra depois, na emissão.
  const ordenados = normalizarDias(ordenarPorConexoes(passos, conexoes))
  validarTemplate(ordenados)

  const dados = {
    // Grava no formato de hoje (intervalo entre etapas), mantendo a ordem em
    // que os nós foram criados — quem manda na sequência são as conexões.
    passos: normalizarDias(passos) as unknown as Prisma.InputJsonValue,
    conexoes: conexoes as unknown as Prisma.InputJsonValue,
    ativo: true,
  }

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

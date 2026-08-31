import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Leitura do registro de auditoria.
 *
 * **Só leitura, e propositalmente sem nenhuma função de escrita ou remoção.**
 * Um log que o próprio painel apaga não serve como prova de nada. Quem grava
 * são os serviços que executam a ação (`admin/carteira.ts`,
 * `admin/envios.ts`, `admin/simulacao.ts`, `admin/importar-tabela.ts`,
 * `etiquetas-service.ts`), cada um dentro da transação do que fez — é o que
 * garante que ação gravada e log existem juntos ou não existem.
 */

export type FiltroAuditoria = {
  actorUserId?: string
  acao?: string
  entidade?: string
  entidadeId?: string
  de?: Date
  ate?: Date
  pagina?: number
}

export type RegistroAuditoria = {
  id: string
  acao: string
  entidade: string
  entidadeId: string
  atorId: string | null
  atorNome: string
  antes: Prisma.JsonValue
  depois: Prisma.JsonValue
  criadoEm: Date
}

export type ListaAuditoria = {
  itens: RegistroAuditoria[]
  pagina: number
  total: number
  totalPaginas: number
}

export const TAMANHO_PAGINA = 30

function montarWhere(filtro: FiltroAuditoria): Prisma.AuditLogWhereInput {
  const entidadeId = (filtro.entidadeId ?? '').trim()

  return {
    ...(filtro.actorUserId ? { actorUserId: filtro.actorUserId } : {}),
    ...(filtro.acao ? { acao: filtro.acao } : {}),
    ...(filtro.entidade ? { entidade: filtro.entidade } : {}),
    ...(entidadeId ? { entidadeId } : {}),
    ...(filtro.de || filtro.ate
      ? {
          criadoEm: {
            ...(filtro.de ? { gte: filtro.de } : {}),
            ...(filtro.ate ? { lte: filtro.ate } : {}),
          },
        }
      : {}),
  }
}

/**
 * Lista registros de auditoria, do mais recente para o mais antigo.
 *
 * O nome do ator é resolvido em uma segunda consulta, e não por `include`:
 * `AuditLog.actorUserId` não tem chave estrangeira de propósito — apagar o
 * usuário não pode apagar o rastro do que ele fez. Sem FK não há relação
 * para o Prisma seguir, então buscamos os nomes em lote pelos ids da página.
 * Ator já removido do sistema aparece como "conta removida", nunca em
 * branco.
 */
export async function listarAuditoria(filtro: FiltroAuditoria = {}): Promise<ListaAuditoria> {
  const pagina = Math.max(1, filtro.pagina ?? 1)
  const where = montarWhere(filtro)

  const [linhas, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * TAMANHO_PAGINA,
      take: TAMANHO_PAGINA,
    }),
    prisma.auditLog.count({ where }),
  ])

  const atorIds = [...new Set(linhas.map((linha) => linha.actorUserId).filter(Boolean))] as string[]
  const atores = await prisma.user.findMany({
    where: { id: { in: atorIds } },
    select: { id: true, nome: true, email: true },
  })
  const nomePorId = new Map(atores.map((ator) => [ator.id, `${ator.nome} (${ator.email})`]))

  return {
    itens: linhas.map((linha) => ({
      id: linha.id,
      acao: linha.acao,
      entidade: linha.entidade,
      entidadeId: linha.entidadeId,
      atorId: linha.actorUserId,
      atorNome: linha.actorUserId
        ? (nomePorId.get(linha.actorUserId) ?? 'conta removida')
        : 'sistema',
      antes: linha.antes,
      depois: linha.depois,
      criadoEm: linha.criadoEm,
    })),
    pagina,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA)),
  }
}

/**
 * Ações e entidades já registradas, para preencher os seletores do filtro.
 *
 * Vem do banco em vez de uma lista fixa no código: a constante ficaria
 * desatualizada no dia em que alguém gravasse uma ação nova, e o filtro
 * esconderia justamente o que passou a acontecer.
 */
export async function listarFacetas(): Promise<{ acoes: string[]; entidades: string[] }> {
  const [acoes, entidades] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['acao'], select: { acao: true }, orderBy: { acao: 'asc' } }),
    prisma.auditLog.findMany({
      distinct: ['entidade'],
      select: { entidade: true },
      orderBy: { entidade: 'asc' },
    }),
  ])

  return {
    acoes: acoes.map((linha) => linha.acao),
    entidades: entidades.map((linha) => linha.entidade),
  }
}

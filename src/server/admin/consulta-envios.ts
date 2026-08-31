import type { Prisma, StatusShipment } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Listagem global de envios do painel administrativo.
 *
 * Diferente de `usuarios.ts`, que mostra as etiquetas de *uma* conta, esta
 * consulta atravessa todas elas. É a que responde ao chamado de suporte que
 * chega com um código de rastreio e nada mais — sem ela, só se chega a um
 * envio sabendo antes de quem ele é.
 *
 * Só leitura. As ações sobre um envio já existem em `envios.ts`.
 */

export type FiltroEnviosAdmin = {
  status?: StatusShipment
  /** Casa com código de rastreio, id do envio, nome ou e-mail do dono. */
  busca?: string
  servicoId?: string
  de?: Date
  ate?: Date
  pagina?: number
}

export type EnvioAdminResumo = {
  id: string
  codigoRastreio: string | null
  status: StatusShipment
  servicoNome: string
  clienteId: string
  clienteNome: string
  clienteEmail: string
  destinatarioNome: string
  destinoCidadeUf: string
  precoCobradoCentavos: number
  criadoEm: Date
}

export type ListaEnviosAdmin = {
  itens: EnvioAdminResumo[]
  pagina: number
  totalPaginas: number
  total: number
  /** Contagem por status **do filtro inteiro menos o próprio status**. */
  porStatus: Record<StatusShipment, number>
}

export const TAMANHO_PAGINA = 25

type EnderecoGravado = { nome?: unknown; cidade?: unknown; uf?: unknown }

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function cidadeUf(destinatario: unknown): string {
  const registro = destinatario as EnderecoGravado | null
  const cidade = texto(registro?.cidade)
  const uf = texto(registro?.uf)
  return cidade && uf ? `${cidade}/${uf}` : cidade || uf || '—'
}

/**
 * Monta o `where` compartilhado por listagem e contagens.
 *
 * A busca é um `OR` entre código de rastreio, id do envio e os dados do dono
 * (`nome`/`email`), porque quem opera cola no campo o que veio no chamado e
 * não deveria ter de saber em qual coluna aquilo vive. O nome do
 * destinatário fica de fora de propósito: ele mora dentro do JSON
 * `Shipment.destinatario`, sem índice — filtrar por ele exigiria varrer a
 * tabela inteira, que é justamente o que a paginação evita.
 */
function montarWhere(filtro: FiltroEnviosAdmin, comStatus: boolean): Prisma.ShipmentWhereInput {
  const busca = (filtro.busca ?? '').trim()

  return {
    ...(comStatus && filtro.status ? { status: filtro.status } : {}),
    ...(filtro.servicoId ? { serviceId: filtro.servicoId } : {}),
    ...(filtro.de || filtro.ate
      ? {
          criadoEm: {
            ...(filtro.de ? { gte: filtro.de } : {}),
            ...(filtro.ate ? { lte: filtro.ate } : {}),
          },
        }
      : {}),
    ...(busca
      ? {
          OR: [
            { codigoRastreio: { contains: busca, mode: 'insensitive' } },
            { id: busca },
            { user: { nome: { contains: busca, mode: 'insensitive' } } },
            { user: { email: { contains: busca, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
}

const STATUS_VAZIO: Record<StatusShipment, number> = {
  PENDING: 0,
  RELEASED: 0,
  GENERATED: 0,
  POSTED: 0,
  DELIVERED: 0,
  CANCELLED: 0,
  LOST: 0,
}

/**
 * Lista envios de todas as contas, paginados do mais recente para o mais
 * antigo, com a contagem por status ao lado.
 *
 * A contagem **ignora o filtro de status** (mas respeita busca, serviço e
 * período): os números das abas descrevem o recorte inteiro. Se
 * acompanhassem a aba aberta, "Entregues" mostraria sempre o total da
 * própria aba e zero em todas as outras — inútil para decidir para onde ir.
 * Mesmo raciocínio das abas de `etiquetas-service.ts`.
 */
export async function listarEnviosAdmin(
  filtro: FiltroEnviosAdmin = {},
): Promise<ListaEnviosAdmin> {
  const pagina = Math.max(1, filtro.pagina ?? 1)
  const where = montarWhere(filtro, true)
  const whereSemStatus = montarWhere(filtro, false)

  const [linhas, total, agrupado] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * TAMANHO_PAGINA,
      take: TAMANHO_PAGINA,
      select: {
        id: true,
        codigoRastreio: true,
        status: true,
        destinatario: true,
        precoCobradoCentavos: true,
        criadoEm: true,
        service: { select: { nome: true } },
        user: { select: { id: true, nome: true, email: true } },
      },
    }),
    prisma.shipment.count({ where }),
    prisma.shipment.groupBy({ by: ['status'], where: whereSemStatus, _count: { _all: true } }),
  ])

  const porStatus = agrupado.reduce<Record<StatusShipment, number>>(
    (acumulado, linha) => ({ ...acumulado, [linha.status]: linha._count._all }),
    { ...STATUS_VAZIO },
  )

  return {
    itens: linhas.map((linha) => ({
      id: linha.id,
      codigoRastreio: linha.codigoRastreio,
      status: linha.status,
      servicoNome: linha.service.nome,
      clienteId: linha.user.id,
      clienteNome: linha.user.nome,
      clienteEmail: linha.user.email,
      destinatarioNome: texto((linha.destinatario as EnderecoGravado | null)?.nome) || '—',
      destinoCidadeUf: cidadeUf(linha.destinatario),
      precoCobradoCentavos: linha.precoCobradoCentavos,
      criadoEm: linha.criadoEm,
    })),
    pagina,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA)),
    porStatus,
  }
}

/** Serviços ativos, para o seletor de filtro da tela. */
export async function listarServicosParaFiltro(): Promise<{ id: string; nome: string }[]> {
  return prisma.service.findMany({
    where: { ativo: true },
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true },
  })
}

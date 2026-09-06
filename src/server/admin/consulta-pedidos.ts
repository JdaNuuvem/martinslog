import type { Prisma, StatusPedido } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Consulta dos pedidos que as lojas empurram por `POST /api/v0/pedidos`.
 *
 * Estes pedidos existiam no banco e não apareciam em lugar nenhum: nem no
 * painel da loja, nem no de administração. Mil e oitocentos registros chegando
 * do integrador, invisíveis — e o pendente é justamente o que vale dinheiro,
 * porque é a venda que ainda dá para recuperar.
 *
 * A consulta é de administração: enxerga TODAS as lojas. O recorte por loja é
 * um filtro opcional, não uma trava — quem chega aqui já passou pela guarda de
 * administrador no layout.
 */

/** Quantos pedidos por página. */
const POR_PAGINA = 50

export type PedidoAdmin = {
  id: string
  externalId: string
  status: StatusPedido
  clienteNome: string
  clienteFone: string
  clienteEmail: string | null
  valorCentavos: number
  checkoutUrl: string | null
  criadoEm: Date
  pagoEm: Date | null
  loja: string
  lojaId: string
  /** Envio gerado a partir deste pedido, quando já existe. */
  codigoRastreio: string | null
  shipmentId: string | null
  /** Quantas mensagens saíram para o comprador deste pedido. */
  mensagens: number
}

export type FiltroPedidos = {
  status?: StatusPedido
  busca?: string
  perfilId?: string
  pagina?: number
}

export type ResultadoPedidos = {
  pedidos: PedidoAdmin[]
  total: number
  pagina: number
  paginas: number
  /** Contagem por status, para os números do topo não dependerem do filtro. */
  porStatus: { status: StatusPedido; total: number }[]
}

function montarWhere(filtro: FiltroPedidos): Prisma.PedidoWhereInput {
  const where: Prisma.PedidoWhereInput = {}

  if (filtro.status) where.status = filtro.status
  if (filtro.perfilId) where.perfilId = filtro.perfilId

  const busca = filtro.busca?.trim()
  if (busca) {
    /*
      Busca pelo que quem atende tem na mão: o código do pedido na loja, o nome
      do comprador ou o telefone dele. Sem `mode: insensitive` a busca por nome
      falharia sempre que a caixa não batesse — e ninguém digita o nome do
      cliente com a mesma capitalização do cadastro.
    */
    where.OR = [
      { externalId: { contains: busca, mode: 'insensitive' } },
      { clienteNome: { contains: busca, mode: 'insensitive' } },
      { clienteFone: { contains: busca.replace(/\D/g, '') } },
    ]
  }

  return where
}

export async function listarPedidosAdmin(filtro: FiltroPedidos = {}): Promise<ResultadoPedidos> {
  const where = montarWhere(filtro)
  const pagina = Math.max(1, filtro.pagina ?? 1)

  const [total, linhas, agrupado] = await Promise.all([
    prisma.pedido.count({ where }),
    prisma.pedido.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        externalId: true,
        status: true,
        clienteNome: true,
        clienteFone: true,
        clienteEmail: true,
        valorCentavos: true,
        checkoutUrl: true,
        criadoEm: true,
        pagoEm: true,
        shipmentId: true,
        perfil: { select: { id: true, nome: true } },
        _count: { select: { mensagens: true } },
      },
    }),
    /*
      Contagem por status SEM o filtro de status: os números do topo precisam
      dizer quanto existe de cada coisa, não quanto sobrou do que já está
      filtrado — senão o painel mostra "1 pendente" quando o filtro é "pago".
    */
    prisma.pedido.groupBy({
      by: ['status'],
      where: { ...where, status: undefined },
      _count: { _all: true },
    }),
  ])

  /*
    O código de rastreio vive no envio, não no pedido. Buscado em UMA consulta
    para os cinquenta da página — dentro do laço seriam cinquenta idas ao
    banco, e a tela ficaria lenta justamente quando há muito o que ver.
  */
  const shipmentIds = linhas.map((l) => l.shipmentId).filter((id): id is string => Boolean(id))
  const envios = shipmentIds.length
    ? await prisma.shipment.findMany({
        where: { id: { in: shipmentIds } },
        select: { id: true, codigoRastreio: true },
      })
    : []
  const rastreioPorEnvio = new Map(envios.map((e) => [e.id, e.codigoRastreio]))

  return {
    pedidos: linhas.map((l) => ({
      id: l.id,
      externalId: l.externalId,
      status: l.status,
      clienteNome: l.clienteNome,
      clienteFone: l.clienteFone,
      clienteEmail: l.clienteEmail,
      valorCentavos: l.valorCentavos,
      checkoutUrl: l.checkoutUrl,
      criadoEm: l.criadoEm,
      pagoEm: l.pagoEm,
      loja: l.perfil.nome,
      lojaId: l.perfil.id,
      shipmentId: l.shipmentId,
      codigoRastreio: l.shipmentId ? (rastreioPorEnvio.get(l.shipmentId) ?? null) : null,
      mensagens: l._count.mensagens,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    porStatus: agrupado.map((g) => ({ status: g.status, total: g._count._all })),
  }
}

/** As lojas que já mandaram pedido, para o filtro. */
export async function listarLojasComPedido(): Promise<{ id: string; nome: string }[]> {
  const perfis = await prisma.perfil.findMany({
    where: { pedidos: { some: {} } },
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  })
  return perfis
}

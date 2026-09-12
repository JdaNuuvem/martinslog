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
  /** O comprador anexou comprovante, e quando. */
  temComprovante: boolean
  comprovanteEm: Date | null
}

export type FiltroPedidos = {
  status?: StatusPedido
  busca?: string
  perfilId?: string
  pagina?: number
  /** Só os que têm comprovante anexado. É o recorte que se procura à mão. */
  comComprovante?: boolean
}

export type ResultadoPedidos = {
  pedidos: PedidoAdmin[]
  total: number
  pagina: number
  paginas: number
  /** Contagem por status, para os números do topo não dependerem do filtro. */
  porStatus: { status: StatusPedido; total: number }[]
  /** Quantos têm comprovante, ignorando o filtro de status pelo mesmo motivo. */
  comComprovante: number
}

function montarWhere(filtro: FiltroPedidos): Prisma.PedidoWhereInput {
  const where: Prisma.PedidoWhereInput = {}

  if (filtro.status) where.status = filtro.status
  if (filtro.perfilId) where.perfilId = filtro.perfilId
  if (filtro.comComprovante) where.comprovanteEm = { not: null }

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

  const [total, linhas, agrupado, comComprovante] = await Promise.all([
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
        comprovanteEm: true,
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
    /*
      Quantos têm comprovante — sem o filtro de status E sem o próprio filtro
      de comprovante, pelo mesmo motivo das contagens acima: o número no topo
      descreve o que existe, não o que sobrou do recorte ativo.
    */
    prisma.pedido.count({
      where: { ...where, status: undefined, comprovanteEm: { not: null } },
    }),
  ])

  /*
    O código de rastreio vive no envio, e o vínculo é a REFERÊNCIA EXTERNA.

    A coluna `Pedido.shipmentId` existe no schema e nunca é escrita por
    ninguém — a tela mostrava "—" em todas as linhas, inclusive nos pedidos que
    já tinham etiqueta impressa há dias. O que de fato liga os dois é o código
    do pedido na loja: a loja manda `external_id` no `/pedidos` e o MESMO valor
    como `external_id` no `/cart`, que vira `Shipment.referenciaExterna`.

    O perfil entra na busca junto com a referência: dois lojistas podem usar a
    mesma numeração de pedido, e casar só pelo código mostraria a um deles o
    rastreio do outro.

    Uma consulta para os cinquenta da página, não uma por linha.
  */
  const referencias = linhas.map((l) => l.externalId)
  const envios = referencias.length
    ? await prisma.shipment.findMany({
        where: {
          referenciaExterna: { in: referencias },
          perfilId: { in: [...new Set(linhas.map((l) => l.perfil.id))] },
        },
        select: { id: true, codigoRastreio: true, referenciaExterna: true, perfilId: true },
        orderBy: { criadoEm: 'desc' },
      })
    : []

  /*
    Chave composta, e a PRIMEIRA vence: `orderBy` desc deixa o envio mais
    recente na frente, que é o certo quando um pedido foi refeito.
  */
  const envioPorPedido = new Map<string, { id: string; codigoRastreio: string | null }>()
  for (const e of envios) {
    const chave = `${e.perfilId}|${e.referenciaExterna}`
    if (!envioPorPedido.has(chave)) {
      envioPorPedido.set(chave, { id: e.id, codigoRastreio: e.codigoRastreio })
    }
  }

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
      temComprovante: l.comprovanteEm !== null,
      comprovanteEm: l.comprovanteEm,
      loja: l.perfil.nome,
      lojaId: l.perfil.id,
      shipmentId: l.shipmentId ?? envioPorPedido.get(`${l.perfil.id}|${l.externalId}`)?.id ?? null,
      codigoRastreio:
        envioPorPedido.get(`${l.perfil.id}|${l.externalId}`)?.codigoRastreio ?? null,
      mensagens: l._count.mensagens,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    porStatus: agrupado.map((g) => ({ status: g.status, total: g._count._all })),
    comComprovante,
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

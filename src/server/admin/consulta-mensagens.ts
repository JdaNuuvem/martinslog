import type { CanalMensagem, Prisma, StatusMensagem } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * O que já saiu para o comprador: SMS, WhatsApp e e-mail.
 *
 * Quando alguém diz "o cliente não recebeu", a pergunta seguinte é sempre a
 * mesma — saiu? para qual número? o provedor aceitou? deu erro qual? Sem uma
 * tela, essa resposta exigia consulta ao banco à mão, uma mensagem por vez.
 *
 * SMS/WhatsApp e e-mail moram em tabelas diferentes (`MensagemEnvio` e
 * `EmailDelivery`) porque nasceram de caminhos diferentes: a primeira é por
 * perfil de loja e passa por template; a segunda é por conta e nasce do envio.
 * Em vez de forçar uma união no banco — que custaria caro e ordenaria mal —,
 * cada canal tem sua consulta e a tela troca entre elas.
 */

const POR_PAGINA = 50

export type MensagemAdmin = {
  id: string
  canal: CanalMensagem
  provedor: string | null
  evento: string
  para: string
  status: StatusMensagem
  tentativas: number
  erro: string | null
  criadoEm: Date
  enviadaEm: Date | null
  entregueEm: Date | null
  loja: string
  /** Pedido da loja que originou a mensagem, quando veio de um pedido. */
  pedido: string | null
  /** Código de rastreio do envio, quando a mensagem é de rastreio. */
  codigoRastreio: string | null
}

export type FiltroMensagens = {
  canal?: CanalMensagem
  status?: StatusMensagem
  busca?: string
  pagina?: number
}

export type ResultadoMensagens = {
  mensagens: MensagemAdmin[]
  total: number
  pagina: number
  paginas: number
  porCanal: { canal: CanalMensagem; total: number }[]
  /** Quantas falharam no total — o número que se olha primeiro. */
  falhas: number
}

function montarWhere(filtro: FiltroMensagens): Prisma.MensagemEnvioWhereInput {
  const where: Prisma.MensagemEnvioWhereInput = {}
  if (filtro.canal) where.canal = filtro.canal
  if (filtro.status) where.status = filtro.status

  const busca = filtro.busca?.trim()
  if (busca) {
    /*
      O telefone é buscado só por dígitos: no banco ele está em E.164
      (5511988887777) e quem digita cola do painel da loja, com parênteses e
      traço. Comparar o texto cru não acharia nunca.
    */
    const digitos = busca.replace(/\D/g, '')
    where.OR = [
      { para: { contains: digitos || busca } },
      { evento: { contains: busca, mode: 'insensitive' } },
    ]
  }

  return where
}

export async function listarMensagensAdmin(
  filtro: FiltroMensagens = {},
): Promise<ResultadoMensagens> {
  const where = montarWhere(filtro)
  const pagina = Math.max(1, filtro.pagina ?? 1)

  const [total, linhas, agrupado, falhas] = await Promise.all([
    prisma.mensagemEnvio.count({ where }),
    prisma.mensagemEnvio.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        canal: true,
        provedor: true,
        evento: true,
        para: true,
        status: true,
        tentativas: true,
        erro: true,
        criadoEm: true,
        enviadaEm: true,
        entregueEm: true,
        shipmentId: true,
        perfil: { select: { nome: true } },
        pedido: { select: { externalId: true } },
      },
    }),
    // Sem o filtro de canal: as abas precisam mostrar quanto existe de cada
    // canal, não quanto sobrou do canal já selecionado.
    prisma.mensagemEnvio.groupBy({
      by: ['canal'],
      where: { ...where, canal: undefined },
      _count: { _all: true },
    }),
    prisma.mensagemEnvio.count({ where: { ...where, status: 'FALHA' } }),
  ])

  /*
    O código de rastreio vive no envio. Uma consulta para a página inteira, em
    vez de uma por linha — cinquenta idas ao banco deixariam a tela lenta
    justamente quando há muito o que ver.
  */
  const envioIds = linhas.map((l) => l.shipmentId).filter((id): id is string => Boolean(id))
  const envios = envioIds.length
    ? await prisma.shipment.findMany({
        where: { id: { in: envioIds } },
        select: { id: true, codigoRastreio: true },
      })
    : []
  const rastreioPorEnvio = new Map(envios.map((e) => [e.id, e.codigoRastreio]))

  return {
    mensagens: linhas.map((l) => ({
      id: l.id,
      canal: l.canal,
      provedor: l.provedor,
      evento: l.evento,
      para: l.para,
      status: l.status,
      tentativas: l.tentativas,
      erro: l.erro,
      criadoEm: l.criadoEm,
      enviadaEm: l.enviadaEm,
      entregueEm: l.entregueEm,
      loja: l.perfil.nome,
      pedido: l.pedido?.externalId ?? null,
      codigoRastreio: l.shipmentId ? (rastreioPorEnvio.get(l.shipmentId) ?? null) : null,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    porCanal: agrupado.map((g) => ({ canal: g.canal, total: g._count._all })),
    falhas,
  }
}

export type EmailAdmin = {
  id: string
  para: string
  assunto: string
  evento: string
  status: string
  erro: string | null
  criadoEm: Date
  conta: string
  codigoRastreio: string | null
}

export type ResultadoEmails = {
  emails: EmailAdmin[]
  total: number
  pagina: number
  paginas: number
  falhas: number
}

export async function listarEmailsAdmin(
  filtro: { busca?: string; pagina?: number } = {},
): Promise<ResultadoEmails> {
  const where: Prisma.EmailDeliveryWhereInput = {}
  const busca = filtro.busca?.trim()
  if (busca) {
    where.OR = [
      { para: { contains: busca, mode: 'insensitive' } },
      { assunto: { contains: busca, mode: 'insensitive' } },
      { evento: { contains: busca, mode: 'insensitive' } },
    ]
  }

  const pagina = Math.max(1, filtro.pagina ?? 1)

  const [total, linhas, falhas] = await Promise.all([
    prisma.emailDelivery.count({ where }),
    prisma.emailDelivery.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        para: true,
        assunto: true,
        evento: true,
        status: true,
        erro: true,
        criadoEm: true,
        shipmentId: true,
        user: { select: { email: true } },
      },
    }),
    /*
      `status` aqui é texto livre, não enum: a coluna guarda o que o provedor
      devolveu. Contar "tudo que não é enviado" é mais honesto do que apostar
      numa palavra específica para falha.
    */
    prisma.emailDelivery.count({ where: { ...where, status: { not: 'ENVIADO' } } }),
  ])

  const envioIds = linhas.map((l) => l.shipmentId).filter((id): id is string => Boolean(id))
  const envios = envioIds.length
    ? await prisma.shipment.findMany({
        where: { id: { in: envioIds } },
        select: { id: true, codigoRastreio: true },
      })
    : []
  const rastreioPorEnvio = new Map(envios.map((e) => [e.id, e.codigoRastreio]))

  return {
    emails: linhas.map((l) => ({
      id: l.id,
      para: l.para,
      assunto: l.assunto,
      evento: l.evento,
      status: l.status,
      erro: l.erro,
      criadoEm: l.criadoEm,
      conta: l.user.email,
      codigoRastreio: l.shipmentId ? (rastreioPorEnvio.get(l.shipmentId) ?? null) : null,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    falhas,
  }
}

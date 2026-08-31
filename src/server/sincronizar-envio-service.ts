import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import {
  garantirTransicao,
  transicoesValidas,
  type StatusShipment,
} from '@/domain/shipment/estados'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { CodigoEvento } from '@/domain/simulacao/tipos'

/**
 * Sincronização do status do envio com o relógio da simulação.
 *
 * A timeline nasce inteira na emissão, com cada evento já datado
 * (`emitir-etiqueta-service.ts`). Nada roda em segundo plano: é a leitura que
 * percebe que o tempo passou. Esta função é o ponto onde essa percepção vira
 * estado persistido — derivar na consulta mostra ao cliente, persistir é o
 * que faz listagens, filtros e webhooks de transição verem a mesma verdade.
 *
 * **Nenhum caminho daqui move dinheiro.** Por decisão do produto em
 * 31/08/2026, nem extravio nem cancelamento estornam: a única origem de
 * crédito em carteira é a recarga confirmada por administrador. Isso elimina
 * a classe inteira de defeitos de crédito duplicado — retentativa, corrida,
 * ordem de chamada — porque não há crédito algum a duplicar aqui.
 *
 * O status é sempre **derivado do último evento visível** (spec seção 5),
 * nunca escrito à mão em paralelo à timeline.
 */

/** Estados terminais: não avançam mais, aconteça o que acontecer no relógio. */
function estadoTerminal(status: StatusShipment): boolean {
  return transicoesValidas[status].length === 0
}

/**
 * Momento em que o envio entrou em cada status, para os campos de data do
 * `Shipment`. `DELIVERED` alcançado por devolução também marca
 * `devolvidoEm`, o que distingue "entregue ao destinatário" de "devolvido ao
 * remetente" sem precisar de um status a mais na máquina de estados.
 */
function datasDoStatus(
  status: StatusShipment,
  ocorridoEm: Date,
  porDevolucao: boolean,
): Prisma.ShipmentUpdateInput {
  switch (status) {
    case 'POSTED':
      return { postadoEm: ocorridoEm }
    case 'DELIVERED':
      return porDevolucao
        ? { entregueEm: ocorridoEm, devolvidoEm: ocorridoEm }
        : { entregueEm: ocorridoEm }
    default:
      return {}
  }
}

/**
 * Avança o status do envio até o do último evento já ocorrido e devolve o
 * status resultante.
 *
 * Percorre os eventos visíveis em ordem, aplicando uma transição por vez:
 * um salto de relógio que cobra a timeline inteira ainda passa por `POSTED`
 * antes de `DELIVERED`, porque `GENERATED → DELIVERED` não é transição
 * válida e a máquina de estados não é contornada por conveniência.
 *
 * Envio cancelado (ou em qualquer estado terminal) não avança: o relógio
 * pode ter passado por cima de toda a timeline, mas o cancelamento é
 * definitivo. Devolve o status atual sem tocar em nada.
 */
export async function sincronizarEnvio(
  shipmentId: string,
  agora: Date = new Date(),
): Promise<StatusShipment> {
  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      precoCobradoCentavos: true,
    },
  })

  if (!envio) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  if (estadoTerminal(envio.status)) {
    return envio.status
  }

  const eventos = await prisma.trackingEvent.findMany({
    where: { shipmentId, ocorridoEm: { lte: agora } },
    orderBy: { sequencia: 'asc' },
    select: { codigo: true, ocorridoEm: true },
  })

  let status = envio.status

  for (const evento of eventos) {
    const alvo = statusDoEvento(evento.codigo as CodigoEvento)

    if (alvo === status) {
      continue
    }

    if (!transicoesValidas[status].includes(alvo)) {
      // Evento que não corresponde a um avanço possível a partir do status
      // atual — timeline adulterada ou evento fora de ordem. Para aqui em
      // vez de forçar: melhor um status atrasado que um estado impossível.
      break
    }

    garantirTransicao(status, alvo)

    const porDevolucao = evento.codigo === 'DEVOLVIDO'

    await prisma.shipment.update({
      where: { id: envio.id, status },
      data: {
        status: alvo,
        ...datasDoStatus(alvo, evento.ocorridoEm, porDevolucao),
      },
    })

    status = alvo

    if (estadoTerminal(status)) {
      break
    }
  }

  return status
}

/** Status que não avançam mais — usados para excluir envios da seleção. */
const STATUS_TERMINAIS: StatusShipment[] = (
  ['PENDING', 'RELEASED', 'GENERATED', 'POSTED', 'DELIVERED', 'CANCELLED', 'LOST'] as const
).filter(estadoTerminal)

/**
 * Sincroniza, de uma vez, os envios do usuário que o relógio já deixou
 * atrasados, e devolve quantos foram efetivamente atualizados.
 *
 * Existe para os caminhos que mostram vários envios de uma vez e precisam do
 * status persistido em dia — a consulta pública de rastreio só alcança um
 * envio por vez, o que ela consultou.
 *
 * O filtro está aqui, e não em quem chama, para que a disciplina contra o
 * N+1 exista num lugar só: **uma** consulta traz os candidatos com o último
 * evento visível de cada um, o status é derivado em memória e só os envios
 * cujo status persistido realmente divergiu abrem transação. Cliente com
 * cinquenta envios em dia não paga cinquenta transações por abrir a
 * carteira.
 */
export async function sincronizarEnviosPendentesDoUsuario(
  userId: string,
  agora: Date = new Date(),
): Promise<number> {
  const candidatos = await prisma.shipment.findMany({
    where: {
      userId,
      status: { notIn: STATUS_TERMINAIS },
      trackingEvents: { some: { ocorridoEm: { lte: agora } } },
    },
    select: {
      id: true,
      status: true,
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
        take: 1,
        select: { codigo: true },
      },
    },
  })

  const desatualizados = candidatos.filter((envio) => {
    const ultimo = envio.trackingEvents.at(0)
    if (!ultimo) {
      return false
    }

    return statusDoEvento(ultimo.codigo as CodigoEvento) !== envio.status
  })

  let sincronizados = 0

  for (const envio of desatualizados) {
    await sincronizarEnvio(envio.id, agora)
    sincronizados += 1
  }

  return sincronizados
}

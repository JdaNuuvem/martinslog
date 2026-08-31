import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import {
  deveEstornar,
  garantirTransicao,
  transicoesValidas,
  type StatusShipment,
} from '@/domain/shipment/estados'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { CodigoEvento } from '@/domain/simulacao/tipos'
import { creditarCarteira } from './wallet-service'

/**
 * Sincronização do status do envio com o relógio da simulação.
 *
 * A timeline nasce inteira na emissão, com cada evento já datado
 * (`emitir-etiqueta-service.ts`). Nada roda em segundo plano: é a leitura que
 * percebe que o tempo passou. Esta função é o ponto onde essa percepção
 * vira estado persistido — e é por isso que ela existe apesar de
 * `rastreio-service.ts` já derivar o status na consulta pública: derivar
 * mostra ao cliente, persistir é o que dispara o estorno do extravio.
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
 * Atualiza o envio até o status do último evento já ocorrido e devolve o
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
 *
 * Sincronizar duas vezes é seguro. Ao chegar em `LOST`, o estorno usa
 * `creditarCarteira` com referência `SHIPMENT`/id do envio, e o índice único
 * `(refTipo, refId, tipo)` do `LedgerEntry` é o que garante crédito único —
 * a invariante fica no banco, não num `if` que duas execuções simultâneas
 * atravessariam juntas.
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
  let estornou = false

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
    const precisaEstornar = deveEstornar(status, alvo)

    await prisma.shipment.update({
      where: { id: envio.id, status },
      data: {
        status: alvo,
        ...datasDoStatus(alvo, evento.ocorridoEm, porDevolucao),
      },
    })

    status = alvo
    estornou = estornou || precisaEstornar

    if (estadoTerminal(status)) {
      break
    }
  }

  if (estornou) {
    await creditarCarteira(
      envio.userId,
      envio.precoCobradoCentavos,
      { tipo: 'SHIPMENT', id: envio.id },
      `Estorno do envio ${envio.id}`,
    )
  }

  return status
}

import type { Prisma } from '@prisma/client'
import { ValorInvalidoError } from '@/domain/errors'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { StatusShipment } from '@/domain/shipment/estados'

type Executor = Prisma.TransactionClient

export type EventoAntecipado = {
  codigo: string
  titulo: string
  /** Quando ele estava marcado para acontecer, antes da antecipação. */
  ocorridoEmAnterior: Date
  statusAnterior: StatusShipment
  /** Status do envio depois da antecipação; igual ao anterior quando não muda. */
  statusNovo: StatusShipment
  eventosDeslocados: number
}

/**
 * Puxa o próximo evento pendente da linha do tempo para o instante atual.
 *
 * A timeline nasce inteira na emissão, com os eventos já datados no futuro; a
 * consulta corta em `agora`. Antecipar, portanto, não é "criar o próximo
 * evento": é mover a data dele para agora.
 *
 * **Os eventos seguintes andam junto, pelo mesmo deslocamento.** Mover só um
 * deixaria o percurso comprimido — a etapa seguinte, que estava a três dias
 * do evento antecipado, passaria a acontecer daqui a algumas horas. Preservar
 * o intervalo entre etapas é o que mantém o percurso parecido com o que a
 * conta desenhou.
 *
 * Roda dentro da transação de quem chama, que também é quem registra a
 * auditoria — a mecânica é a mesma para o administrador e para o dono do
 * envio, mas o rastro que cada um deixa não é.
 */
export async function anteciparProximoEvento(
  tx: Executor,
  shipmentId: string,
  statusAtual: StatusShipment,
  agora: Date,
): Promise<EventoAntecipado> {
  const proximo = await tx.trackingEvent.findFirst({
    where: { shipmentId, ocorridoEm: { gt: agora } },
    orderBy: { sequencia: 'asc' },
  })

  if (!proximo) {
    throw new ValorInvalidoError(
      'Este envio já percorreu todas as etapas do fluxo: não há próxima etapa para antecipar.',
    )
  }

  const deslocamentoMs = proximo.ocorridoEm.getTime() - agora.getTime()

  await tx.trackingEvent.update({
    where: { id: proximo.id },
    data: { ocorridoEm: agora, forcado: true },
  })

  const seguintes = await tx.trackingEvent.findMany({
    where: { shipmentId, sequencia: { gt: proximo.sequencia } },
    select: { id: true, ocorridoEm: true },
  })

  for (const seguinte of seguintes) {
    await tx.trackingEvent.update({
      where: { id: seguinte.id },
      data: { ocorridoEm: new Date(seguinte.ocorridoEm.getTime() - deslocamentoMs) },
    })
  }

  // Um status criado pela conta pode não ter tradução conhecida aqui. Nesse
  // caso o evento é antecipado do mesmo jeito — é a ação que foi pedida — e o
  // status do envio fica como está, em vez de gravar um valor inventado ou
  // recusar a operação inteira.
  let alvo: StatusShipment | null
  try {
    alvo = statusDoEvento(proximo.codigo)
  } catch {
    alvo = null
  }

  const dados: Prisma.ShipmentUpdateInput = {}

  if (alvo !== null && alvo !== statusAtual) {
    dados.status = alvo
    if (alvo === 'POSTED') dados.postadoEm = agora
    if (alvo === 'DELIVERED') dados.entregueEm = agora
    if (proximo.codigo === 'DEVOLVIDO') dados.devolvidoEm = agora
  }

  if (Object.keys(dados).length > 0) {
    await tx.shipment.update({ where: { id: shipmentId }, data: dados })
  }

  return {
    codigo: proximo.codigo,
    titulo: proximo.titulo,
    ocorridoEmAnterior: proximo.ocorridoEm,
    statusAnterior: statusAtual,
    statusNovo: alvo ?? statusAtual,
    eventosDeslocados: seguintes.length,
  }
}

import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { anteciparProximoEvento } from './antecipar-evento'

export type EtapaAvancada = {
  codigo: string
  titulo: string
  status: string
}

/**
 * Avança o envio do próprio usuário para a próxima etapa do percurso.
 *
 * A linha do tempo é gravada inteira na emissão, com os eventos datados no
 * futuro; esta ação puxa o próximo deles para agora e desloca os seguintes
 * pelo mesmo tanto, preservando os intervalos que a conta desenhou no fluxo.
 *
 * É a mesma mecânica do botão de simulação do administrador, com duas
 * diferenças que importam: só age sobre envio do próprio usuário, e a
 * auditoria registra quem de fato pediu — a conta dona, não um operador.
 *
 * Envio de outro usuário devolve "não encontrado", nunca "proibido", como no
 * resto da API: quem chuta um id não descobre se ele existe.
 */
export async function avancarEtapa(
  userId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<EtapaAvancada> {
  return prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, userId: true, status: true, codigoRastreio: true },
    })

    if (!envio || envio.userId !== userId) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    if (envio.status === 'CANCELLED') {
      throw new ValorInvalidoError('Este envio foi cancelado e não percorre mais etapas.')
    }

    if (!envio.codigoRastreio) {
      throw new ValorInvalidoError(
        'Este envio ainda não tem etiqueta emitida, então não há percurso para avançar.',
      )
    }

    const antecipado = await anteciparProximoEvento(tx, envio.id, envio.status, agora)

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        acao: 'ENVIO_AVANCAR_ETAPA',
        entidade: 'Shipment',
        entidadeId: envio.id,
        antes: {
          status: envio.status,
          proximoEvento: antecipado.codigo,
          ocorridoEm: antecipado.ocorridoEmAnterior.toISOString(),
        },
        depois: {
          status: antecipado.statusNovo,
          ocorridoEm: agora.toISOString(),
          eventosDeslocados: antecipado.eventosDeslocados,
        },
      },
    })

    return {
      codigo: antecipado.codigo,
      titulo: antecipado.titulo,
      status: antecipado.statusNovo,
    }
  })
}

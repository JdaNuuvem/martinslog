import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { CodigoEvento } from '@/domain/simulacao/tipos'
import type { RastreioResposta } from '@/lib/rastreio-schema'
import { sincronizarStatus } from './sincronizar-envio-service'

/**
 * Consulta pública de um envio pelo código de rastreio
 * (docs/superpowers/specs/2026-08-31-simulacao-transporte.md, seção 7): quem
 * tem o código consulta sem login, como em qualquer transportadora.
 *
 * O que sustenta isso é o que a função NÃO devolve: nome, documento e
 * endereço de remetente e destinatário nunca saem daqui — apenas serviço,
 * prazo, status e a cidade/UF de cada evento. Quem descobre um código não
 * descobre quem mora onde.
 *
 * A timeline é gerada inteira na emissão da etiqueta, com eventos já datados
 * no futuro. A consulta corta em `agora`: evento futuro não aparece nem
 * esmaecido.
 */
export async function rastrearEnvio(
  codigoRastreio: string,
  agora: Date = new Date(),
): Promise<RastreioResposta> {
  // A consulta sincroniza o status persistido antes de ler. Sem isto, o
  // `Shipment.status` no banco fica congelado no valor da emissão para
  // sempre: nada mais no sistema percebe a passagem do tempo, e listagens,
  // filtros e relatórios que leem o campo mostram um envio entregue como
  // recém-emitido.
  //
  // Usa `sincronizarStatus`, e não `sincronizarEnvio`: esta rota é anônima
  // e protegida apenas por rate limit, então não pode ser o gatilho do
  // estorno de extravio. Mover status é idempotente e barato; mover dinheiro
  // fica com os caminhos autenticados.
  const envioParaSincronizar = await prisma.shipment.findFirst({
    where: { codigoRastreio },
    select: { id: true },
  })

  if (envioParaSincronizar) {
    await sincronizarStatus(envioParaSincronizar.id, agora)
  }

  const envio = await prisma.shipment.findFirst({
    where: { codigoRastreio },
    include: {
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
      },
    },
  })

  if (!envio || !envio.codigoRastreio) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${codigoRastreio}`)
  }

  const ultimoVisivel = envio.trackingEvents[0]

  return {
    codigoRastreio: envio.codigoRastreio,
    // O status persistido pode estar atrás do relógio até a próxima
    // sincronização; o último evento visível é a fonte da verdade do que o
    // cliente pode ver agora.
    status: ultimoVisivel ? statusDoEvento(ultimoVisivel.codigo as CodigoEvento) : envio.status,
    servico: envio.service.nome,
    prazoDias: envio.service.prazoBase,
    criadoEm: envio.criadoEm.toISOString(),
    eventos: envio.trackingEvents.map((evento) => ({
      sequencia: evento.sequencia,
      codigo: evento.codigo,
      titulo: evento.titulo,
      descricao: evento.descricao,
      unidadeOrigem: evento.unidadeOrigem,
      unidadeDestino: evento.unidadeDestino,
      cidade: evento.cidade,
      uf: evento.uf,
      ocorridoEm: evento.ocorridoEm.toISOString(),
    })),
  }
}

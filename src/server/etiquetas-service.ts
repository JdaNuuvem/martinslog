import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { CancelamentoNaoPermitidoError, EnvioNaoEncontradoError } from '@/domain/errors'
import { podeCancelar, type StatusShipment } from '@/domain/shipment/estados'
import { obterStatusPorCodigo } from '@/server/status-rastreio-service'
import { enfileirarEvento } from './webhook-service'
import { derivarStatusVisivel } from './status-derivado'
import type {
  AbaEtiquetas,
  EtiquetaResumo,
  ListaEtiquetasResposta,
} from '@/lib/etiquetas-schema'

/**
 * Tela de etiquetas do cliente: a gestão dos próprios envios.
 *
 * Diferente da listagem de rastreio (`meus-envios-service.ts`), que responde
 * "onde está meu pacote", esta responde "o que eu contratei e o que posso
 * fazer com isso" — por isso traz valor pago, abas por etapa operacional e a
 * ação de cancelar.
 *
 * Não há geração de PDF em nenhum ponto: por decisão do produto, a etiqueta
 * não é impressa por aqui.
 */

/** Status que cada aba agrupa. `todos` não filtra nada. */
const STATUS_POR_ABA: Readonly<Record<AbaEtiquetas, readonly StatusShipment[] | null>> = {
  todos: null,
  aguardando_postagem: ['PENDING', 'RELEASED', 'GENERATED'],
  postados: ['POSTED'],
  entregues: ['DELIVERED'],
  cancelados: ['CANCELLED', 'LOST'],
}

export type FiltroEtiquetas = {
  aba?: AbaEtiquetas
  busca?: string
}

type EnderecoGravado = {
  nome?: string
  documento?: string
  cidade?: string
  uf?: string
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
}

type ProdutoGravado = {
  nome?: string
  quantidade?: number
  valorUnitarioCentavos?: number
}

export type EtiquetaDetalhe = EtiquetaResumo & {
  remetente: EnderecoGravado
  destinatario: EnderecoGravado
  produtos: ProdutoGravado[]
  valorDeclaradoCentavos: number
  descontoCentavos: number
  precoBalcaoCentavos: number
  eventos: {
    sequencia: number
    codigo: string
    titulo: string
    descricao: string
    cidade: string
    uf: string
    ocorridoEm: string
  }[]
}

function cabeNaAba(status: StatusShipment, aba: AbaEtiquetas): boolean {
  const permitidos = STATUS_POR_ABA[aba]
  return permitidos === null || permitidos.includes(status)
}

/**
 * Casa a busca contra código de rastreio e nome do destinatário.
 *
 * O filtro roda em memória, e não no banco, porque o destinatário é um JSON
 * copiado dentro do envio (`Shipment.destinatario`) — não há índice para
 * buscar por nome ali. A lista é de um cliente só, então o custo é pequeno;
 * se um dia um cliente tiver milhares de envios, isso vira paginação no
 * banco com uma coluna dedicada, não um `LIKE` em JSON.
 */
function casaComBusca(etiqueta: EtiquetaResumo, termo: string): boolean {
  if (!termo) {
    return true
  }

  const alvo = termo.toLowerCase()
  return (
    (etiqueta.codigoRastreio ?? '').toLowerCase().includes(alvo) ||
    etiqueta.destinatarioNome.toLowerCase().includes(alvo)
  )
}

/**
 * Lista as etiquetas do usuário, já filtradas por aba e busca, com a
 * contagem de cada aba.
 *
 * A contagem **ignora a busca** de propósito: os números das abas descrevem a
 * conta inteira. Se eles acompanhassem o texto digitado, o cliente veria
 * "Entregues (0)" enquanto busca por outro envio e concluiria que não tem
 * nenhuma entrega.
 */
export async function listarEtiquetas(
  userId: string,
  filtro: FiltroEtiquetas = {},
  agora: Date = new Date(),
): Promise<ListaEtiquetasResposta> {
  const aba = filtro.aba ?? 'todos'
  const busca = (filtro.busca ?? '').trim()

  const statusPorCodigo = await obterStatusPorCodigo(userId)

  const envios = await prisma.shipment.findMany({
    where: { userId },
    include: {
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
        take: 1,
      },
    },
    orderBy: { criadoEm: 'desc' },
  })

  const resumos: EtiquetaResumo[] = envios.map((envio) => {
    const ultimo = envio.trackingEvents[0]
    const destinatario = envio.destinatario as EnderecoGravado | null
    const status = derivarStatusVisivel(ultimo?.codigo, envio.status, statusPorCodigo)

    return {
      id: envio.id,
      codigoRastreio: envio.codigoRastreio,
      status,
      ultimoEvento: ultimo?.titulo ?? null,
      ocorridoEm: ultimo?.ocorridoEm.toISOString() ?? null,
      destinatarioNome: destinatario?.nome ?? 'Destinatário',
      destinoCidade: destinatario?.cidade ?? null,
      destinoUf: destinatario?.uf ?? null,
      servico: envio.service.nome,
      prazoDias: envio.service.prazoBase,
      valorCentavos: envio.precoCobradoCentavos,
      criadoEm: envio.criadoEm.toISOString(),
      podeCancelar: podeCancelar(status),
    }
  })

  const contagem = Object.fromEntries(
    (Object.keys(STATUS_POR_ABA) as AbaEtiquetas[]).map((chave) => [
      chave,
      resumos.filter((etiqueta) => cabeNaAba(etiqueta.status as StatusShipment, chave)).length,
    ]),
  ) as Record<AbaEtiquetas, number>

  return {
    etiquetas: resumos.filter(
      (etiqueta) =>
        cabeNaAba(etiqueta.status as StatusShipment, aba) && casaComBusca(etiqueta, busca),
    ),
    contagem,
  }
}

/**
 * Detalhe de uma etiqueta do usuário, com a timeline já visível.
 *
 * Envio inexistente e envio de outro usuário resultam no mesmo
 * `EnvioNaoEncontradoError`, pelo mesmo motivo de `enderecos-service`: o
 * chamador não distingue "não existe" de "não é seu", então não descobre ids
 * válidos por tentativa.
 */
export async function obterEtiqueta(
  userId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<EtiquetaDetalhe> {
  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
      },
    },
  })

  if (!envio || envio.userId !== userId) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  const statusPorCodigo = await obterStatusPorCodigo(userId)
  const ultimo = envio.trackingEvents[0]
  const status = derivarStatusVisivel(ultimo?.codigo, envio.status, statusPorCodigo)
  const destinatario = (envio.destinatario as EnderecoGravado | null) ?? {}

  return {
    id: envio.id,
    codigoRastreio: envio.codigoRastreio,
    status,
    ultimoEvento: ultimo?.titulo ?? null,
    ocorridoEm: ultimo?.ocorridoEm.toISOString() ?? null,
    destinatarioNome: destinatario.nome ?? 'Destinatário',
    destinoCidade: destinatario.cidade ?? null,
    destinoUf: destinatario.uf ?? null,
    servico: envio.service.nome,
    prazoDias: envio.service.prazoBase,
    valorCentavos: envio.precoCobradoCentavos,
    criadoEm: envio.criadoEm.toISOString(),
    podeCancelar: podeCancelar(status),
    remetente: (envio.remetente as EnderecoGravado | null) ?? {},
    destinatario,
    produtos: (envio.produtos as ProdutoGravado[] | null) ?? [],
    valorDeclaradoCentavos: envio.valorDeclaradoCentavos,
    descontoCentavos: envio.descontoCentavos,
    precoBalcaoCentavos: envio.precoBalcaoCentavos,
    eventos: envio.trackingEvents.map((evento) => ({
      sequencia: evento.sequencia,
      codigo: evento.codigo,
      titulo: evento.titulo,
      descricao: evento.descricao,
      cidade: evento.cidade,
      uf: evento.uf,
      ocorridoEm: evento.ocorridoEm.toISOString(),
    })),
  }
}

/**
 * Cancela um envio do próprio usuário.
 *
 * **Não devolve dinheiro.** Por decisão do produto em 31/08/2026, nenhum
 * desfecho estorna — nem extravio, nem cancelamento. A interface avisa isso
 * antes de confirmar, porque um cliente que cancela achando que recupera o
 * valor foi enganado pela tela, não pela regra.
 *
 * Os eventos **futuros** são descartados e os já ocorridos preservados: o
 * cliente pode ter lido a postagem, e apagá-la reescreveria o que ele viu. O
 * cancelamento grava `AuditLog` mesmo sendo ação do cliente, e não de
 * administrador, porque é irreversível e destrói valor — quando alguém
 * reclamar, o registro de quem cancelou e quando é a única resposta possível.
 *
 * A condição `status` no `update` é o que impede cancelamento duplo sob duas
 * requisições simultâneas: a segunda não encontra a linha no estado esperado.
 */
export async function cancelarEtiqueta(
  userId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        userId: true,
        status: true,
        codigoRastreio: true,
        precoCobradoCentavos: true,
      },
    })

    if (!envio || envio.userId !== userId) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    if (!podeCancelar(envio.status)) {
      throw new CancelamentoNaoPermitidoError(
        'Este envio não pode mais ser cancelado: ele já saiu para o fluxo de entrega.',
      )
    }

    const atualizados = await tx.shipment.updateMany({
      where: { id: envio.id, status: envio.status },
      data: { status: 'CANCELLED', canceladoEm: agora },
    })

    if (atualizados.count !== 1) {
      throw new CancelamentoNaoPermitidoError(
        'Este envio acabou de mudar de situação. Recarregue a página e tente de novo.',
      )
    }

    // Só o futuro: o passado que o cliente já leu permanece.
    await tx.trackingEvent.deleteMany({
      where: { shipmentId: envio.id, ocorridoEm: { gt: agora } },
    })

    // Depois do cancelamento confirmado e dentro da mesma transação: um
    // rollback leva a notificação junto, e o cliente não é avisado de um
    // cancelamento que não aconteceu. Só grava linhas, sem I/O de rede.
    await enfileirarEvento(envio.id, 'order.cancelled', tx)

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        acao: 'ENVIO_CANCELADO',
        entidade: 'Shipment',
        entidadeId: envio.id,
        antes: { status: envio.status } as Prisma.InputJsonValue,
        depois: {
          status: 'CANCELLED',
          canceladoEm: agora.toISOString(),
          codigoRastreio: envio.codigoRastreio,
          // Registrado porque não é estornado: se a política mudar, é este
          // número que dirá quanto devolver a quem.
          valorNaoEstornadoCentavos: envio.precoCobradoCentavos,
        } as Prisma.InputJsonValue,
      },
    })
  })
}

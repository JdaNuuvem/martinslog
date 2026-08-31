import { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, RotaNaoAtendidaError } from '@/domain/errors'
import type { OpcaoCotacao } from '@/domain/pricing/cotacao'
import { gerarCotacao, type FormatoEmbalagem } from '@/server/cotacao-service'
import { criarEnvio, pagarEnvio, type EnderecoEnvio, type ProdutoDeclarado } from '@/server/shipment-service'
import { emitirEtiqueta } from '@/server/emitir-etiqueta-service'
import { cancelarEtiqueta } from '@/server/etiquetas-service'
import { enfileirarEvento } from '@/server/webhook-service'

/**
 * Criação, cancelamento e exclusão de etiquetas **em nome de um cliente**,
 * pelo painel administrativo.
 *
 * Tudo aqui atravessa os mesmos serviços que o cliente usaria
 * (`gerarCotacao` → `criarEnvio` → `emitirEtiqueta`), e não um atalho que
 * escreva `Shipment` na mão. O motivo é preço: `criarEnvio` recusa qualquer
 * valor que não venha de uma `Quote` gravada no servidor, e manter o
 * administrador dentro dessa trilha significa que um envio criado pelo painel
 * é indistinguível, em dados, de um criado pelo cliente — mesma tarifa, mesmo
 * `quoteId`, mesma timeline.
 *
 * A única diferença deliberada é a cobrança: o administrador escolhe se o
 * envio debita a carteira do cliente ou é cortesia (ver `cobrarSaldo`).
 */

export type EntradaEnvioAdmin = {
  remetente: EnderecoEnvio
  destinatario: EnderecoEnvio
  produtos: ProdutoDeclarado[]
  pesoG: number
  alturaCm: number
  larguraCm: number
  comprimentoCm: number
  formato: FormatoEmbalagem
  /** Opcional: sem ele, usa a opção disponível mais barata da cotação. */
  servicoId?: string
  /** `false` libera o envio sem tocar na carteira (cortesia/estorno operacional). */
  cobrarSaldo: boolean
}

export type EnvioAdminCriado = {
  id: string
  codigoRastreio: string | null
  precoCobradoCentavos: number
  cobrado: boolean
}

function escolherOpcao(opcoes: OpcaoCotacao[], servicoId?: string): OpcaoCotacao {
  const disponiveis = opcoes.filter((opcao) => opcao.disponivel)

  if (servicoId) {
    const escolhida = disponiveis.find((opcao) => opcao.servicoId === servicoId)
    if (!escolhida) {
      throw new RotaNaoAtendidaError(
        'O serviço escolhido não atende esta rota com este peso. Escolha outro serviço.',
      )
    }
    return escolhida
  }

  const maisBarata = disponiveis.reduce<OpcaoCotacao | null>(
    (melhor, opcao) =>
      melhor === null || opcao.precoFinalCentavos < melhor.precoFinalCentavos ? opcao : melhor,
    null,
  )

  if (!maisBarata) {
    throw new RotaNaoAtendidaError('Nenhum serviço atende esta rota com este peso.')
  }

  return maisBarata
}

/**
 * Libera um envio `PENDING` sem debitar a carteira — o caminho de cortesia.
 *
 * Repete a transição de `pagarEnvio` (incluindo o `order.released`, que o
 * cliente espera receber de qualquer envio liberado) e omite exatamente uma
 * coisa: o lançamento no ledger. Nada de "débito de R$ 0,00" para fingir
 * simetria; um envio sem cobrança não tem lançamento, e o `AuditLog` diz quem
 * decidiu isso.
 *
 * O `updateMany` condicionado a `PENDING` protege contra a corrida com um
 * cancelamento simultâneo, pelo mesmo motivo descrito em `pagarEnvio`.
 */
async function liberarSemCobranca(
  actorUserId: string,
  shipmentId: string,
  motivo: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const liberados = await tx.shipment.updateMany({
      where: { id: shipmentId, status: 'PENDING' },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })

    if (liberados.count !== 1) {
      throw new EnvioNaoEncontradoError(
        `Envio ${shipmentId} não está mais PENDING e não pôde ser liberado.`,
      )
    }

    await enfileirarEvento(shipmentId, 'order.released', tx)

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: 'ENVIO_LIBERADO_SEM_COBRANCA',
        entidade: 'Shipment',
        entidadeId: shipmentId,
        antes: { status: 'PENDING' } as Prisma.InputJsonValue,
        depois: { status: 'RELEASED', motivo } as Prisma.InputJsonValue,
      },
    })
  })
}

/**
 * Cria uma etiqueta para o cliente `userId`: cota a rota em nome dele, cria o
 * envio, libera (cobrando ou não) e emite o código de rastreio.
 *
 * A emissão fica fora da transação de liberação, como em `pagarEnvio`: se
 * falhar, o envio permanece `RELEASED` sem código e é reemitível por
 * `POST /api/envios/[id]/etiqueta`, sem que o débito eventual seja desfeito.
 * Por isso `codigoRastreio` pode voltar `null` — é estado válido, não erro.
 */
export async function criarEtiquetaParaUsuario(
  actorUserId: string,
  userId: string,
  entrada: EntradaEnvioAdmin,
  motivo: string,
): Promise<EnvioAdminCriado> {
  const cotacao = await gerarCotacao(
    {
      cepOrigem: entrada.remetente.cep,
      cepDestino: entrada.destinatario.cep,
      pesoRealG: entrada.pesoG,
      alturaCm: entrada.alturaCm,
      larguraCm: entrada.larguraCm,
      comprimentoCm: entrada.comprimentoCm,
      formato: entrada.formato,
    },
    { userId, anonSessionId: null },
  )

  const opcao = escolherOpcao(cotacao.opcoes, entrada.servicoId)

  const envio = await criarEnvio(userId, {
    quoteId: cotacao.quoteId,
    servicoId: opcao.servicoId,
    remetente: entrada.remetente,
    destinatario: entrada.destinatario,
    produtos: entrada.produtos,
  })

  if (entrada.cobrarSaldo) {
    // Propaga `SaldoInsuficienteError`: o envio fica `PENDING` e a rota diz
    // ao administrador que falta saldo, em vez de virar cortesia em silêncio.
    await pagarEnvio(userId, envio.id)
  } else {
    await liberarSemCobranca(actorUserId, envio.id, motivo)
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      acao: 'ENVIO_CRIADO_PELO_ADMIN',
      entidade: 'Shipment',
      entidadeId: envio.id,
      antes: Prisma.JsonNull,
      depois: {
        userId,
        quoteId: cotacao.quoteId,
        servicoId: opcao.servicoId,
        precoCobradoCentavos: envio.precoCobradoCentavos,
        cobrado: entrada.cobrarSaldo,
        motivo,
      } as Prisma.InputJsonValue,
    },
  })

  let codigoRastreio: string | null = null
  if (!entrada.cobrarSaldo) {
    // Com cobrança, `pagarEnvio` já emitiu (e já engoliu a falha de emissão).
    try {
      codigoRastreio = (await emitirEtiqueta(envio.id)).codigoRastreio
    } catch (error) {
      console.error('Falha ao emitir etiqueta criada pelo painel administrativo', {
        shipmentId: envio.id,
        cause: error,
      })
    }
  } else {
    const emitido = await prisma.shipment.findUnique({
      where: { id: envio.id },
      select: { codigoRastreio: true },
    })
    codigoRastreio = emitido?.codigoRastreio ?? null
  }

  return {
    id: envio.id,
    codigoRastreio,
    precoCobradoCentavos: envio.precoCobradoCentavos,
    cobrado: entrada.cobrarSaldo,
  }
}

/**
 * Cancela a etiqueta de um cliente pelo painel.
 *
 * Reusa `cancelarEtiqueta` passando o dono do envio, e não o administrador:
 * a função checa posse, e forjar essa checagem aqui duplicaria a regra de
 * quais status podem ser cancelados. O `AuditLog` extra registra que a
 * decisão foi administrativa — o log de dentro de `cancelarEtiqueta` atribui
 * o ato ao cliente, o que sozinho contaria a história errada.
 */
export async function cancelarEtiquetaComoAdmin(
  actorUserId: string,
  shipmentId: string,
  motivo: string,
): Promise<void> {
  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { userId: true, status: true },
  })

  if (!envio) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  await cancelarEtiqueta(envio.userId, shipmentId)

  await prisma.auditLog.create({
    data: {
      actorUserId,
      acao: 'ENVIO_CANCELADO_PELO_ADMIN',
      entidade: 'Shipment',
      entidadeId: shipmentId,
      antes: { status: envio.status } as Prisma.InputJsonValue,
      depois: { status: 'CANCELLED', userId: envio.userId, motivo } as Prisma.InputJsonValue,
    },
  })
}

/**
 * Apaga o envio do banco, junto com sua timeline (`TrackingEvent` cai por
 * cascade).
 *
 * **Destrói histórico e não tem volta** — por isso o padrão do painel é
 * cancelar, e esta função existe só para o caso de envio criado por engano
 * (teste, duplicata) que não deveria constar em lugar nenhum.
 *
 * O que sobrevive de propósito:
 *
 * - **O ledger.** Se o envio foi pago, o débito continua lá. Apagar o
 *   lançamento mudaria o saldo do cliente sem contrapartida e quebraria a
 *   corrente de `saldoAposCentavos` do extrato inteiro. Quem quiser devolver
 *   o dinheiro usa o ajuste de saldo, que é outro lançamento.
 * - **O `AuditLog`,** que guarda o envio inteiro em `antes`: é o único
 *   registro que resta de que ele existiu.
 * - **As entregas de webhook já enfileiradas,** que não referenciam o envio
 *   por chave estrangeira e carregam o payload próprio.
 */
export async function excluirEnvio(actorUserId: string, shipmentId: string, motivo: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({ where: { id: shipmentId } })

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: 'ENVIO_EXCLUIDO',
        entidade: 'Shipment',
        entidadeId: envio.id,
        antes: JSON.parse(JSON.stringify(envio)) as Prisma.InputJsonValue,
        depois: { excluido: true, motivo } as Prisma.InputJsonValue,
      },
    })

    await tx.shipment.delete({ where: { id: envio.id } })
  })
}

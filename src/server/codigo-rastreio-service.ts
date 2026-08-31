import { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { montarCodigoRastreio, prefixoDoServico } from '@/domain/shipment/codigo-rastreio'

/**
 * Atribuição do código de rastreio a um envio.
 *
 * O código só nasce quando a etiqueta é emitida (`GENERATED`) — antes disso
 * `Shipment.codigoRastreio` é nulo, conforme a seção 5.4 da spec. Este
 * módulo cuida só da geração e da gravação: quem move o status e valida a
 * transição é o serviço de emissão.
 */

/** Cliente Prisma ou cliente de transação — a gravação acompanha quem chama. */
type ClientePrisma = Prisma.TransactionClient | typeof prisma

/**
 * Quantas vezes tentar um sequencial novo diante de um código já em uso.
 * Colisão só acontece se um código tiver entrado no banco por fora da
 * sequência (importação, correção manual); com a sequência intacta, a
 * primeira tentativa sempre serve.
 */
const TENTATIVAS_MAXIMAS = 5

/**
 * Consome o próximo valor da sequência do banco.
 *
 * Roda **fora** da transação de quem chama, de propósito. `nextval` não é
 * transacional: o número consumido não volta ao poço num rollback, e é
 * justamente isso que se quer — um código já montado (e possivelmente
 * impresso) nunca deve ser reemitido para outro envio. Manter a chamada
 * fora da transação também evita que uma colisão de unicidade envenene a
 * transação do chamador e impeça a nova tentativa.
 */
async function proximoSequencial(): Promise<number> {
  const linhas = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('tracking_code_seq') AS nextval
  `

  const valor = linhas[0]?.nextval
  if (valor === undefined) {
    throw new Error('Sequência tracking_code_seq não devolveu valor')
  }

  return Number(valor)
}

/**
 * Gera um código de rastreio livre para o serviço informado, sem gravá-lo em
 * lugar nenhum. A verificação de disponibilidade é só uma folga: a garantia
 * de unicidade real é o índice único de `Shipment.codigoRastreio`.
 */
export async function gerarCodigoRastreio(codigoServico: string): Promise<string> {
  const prefixo = prefixoDoServico(codigoServico)

  for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS; tentativa += 1) {
    const codigo = montarCodigoRastreio(prefixo, await proximoSequencial())

    const emUso = await prisma.shipment.count({ where: { codigoRastreio: codigo } })
    if (emUso === 0) {
      return codigo
    }
  }

  throw new Error(
    `Não foi possível gerar um código de rastreio livre após ${TENTATIVAS_MAXIMAS} tentativas`,
  )
}

/**
 * Gera e grava o código de rastreio do envio, devolvendo o código final.
 *
 * Idempotente: um envio que já tem código devolve o mesmo código e não
 * consome outro sequencial. Isso importa porque a emissão da etiqueta é
 * regenerável — a spec manda que a falha ao gerar o PDF não desfaça o
 * pagamento, então a mesma emissão pode ser tentada várias vezes, e o
 * cliente não pode ver o código mudar entre as tentativas.
 *
 * A gravação usa o cliente recebido, de modo que ela entre na transação de
 * quem chama (a emissão grava código, status e `geradoEm` juntos, ou nada).
 * O `UPDATE` é condicionado a `codigoRastreio: null`: se outra transação
 * ganhou a corrida e já gravou um código, esta não o sobrescreve — devolve o
 * que ficou gravado.
 */
export async function atribuirCodigoRastreio(
  cliente: ClientePrisma,
  shipmentId: string,
): Promise<string> {
  const envio = await cliente.shipment.findUnique({
    where: { id: shipmentId },
    select: { codigoRastreio: true, service: { select: { codigo: true } } },
  })

  if (!envio) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  if (envio.codigoRastreio) {
    return envio.codigoRastreio
  }

  const codigo = await gerarCodigoRastreio(envio.service.codigo)

  const atualizados = await cliente.shipment.updateMany({
    where: { id: shipmentId, codigoRastreio: null },
    data: { codigoRastreio: codigo },
  })

  if (atualizados.count === 1) {
    return codigo
  }

  // Perdeu a corrida: alguém gravou um código entre a leitura e o UPDATE.
  // Vale o código do vencedor — o sequencial consumido aqui simplesmente
  // se perde, que é o preço certo por nunca reaproveitar número.
  const atual = await cliente.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: { codigoRastreio: true },
  })

  if (!atual.codigoRastreio) {
    throw new Error(`Código de rastreio não gravado para o envio ${shipmentId}`)
  }

  return atual.codigoRastreio
}

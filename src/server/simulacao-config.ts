import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/** Id do registro único — a configuração da simulação é global. */
export const ID_CONFIG_SIMULACAO = 'singleton'

export interface ConfigSimulacao {
  /** 1 = tempo real; 24 = um dia em uma hora; 288 = um dia em cinco minutos. */
  fatorVelocidade: number
  /** Nome do operador nos nomes de unidade da timeline. */
  operador: string
}

/**
 * Cliente Prisma ou transação: a emissão da etiqueta lê a configuração
 * dentro da mesma transação que grava o envio e os eventos.
 */
type Executor = Prisma.TransactionClient | typeof prisma

/**
 * Lê a configuração global da simulação.
 *
 * A migration já insere o registro `singleton`, mas o `upsert` mantém a
 * função utilizável em um banco recém-criado sem seed — ler configuração
 * nunca deve derrubar a emissão de uma etiqueta.
 *
 * O valor lido aqui é **copiado** para `Shipment.fatorSimulacao` na
 * geração (spec seção 2). Nunca leia esta configuração na consulta de um
 * envio: mudar a velocidade global reescreveria a linha do tempo de quem já
 * está em trânsito.
 */
export async function obterConfigSimulacao(
  executor: Executor = prisma,
): Promise<ConfigSimulacao> {
  const config = await executor.simulacaoConfig.upsert({
    where: { id: ID_CONFIG_SIMULACAO },
    update: {},
    create: { id: ID_CONFIG_SIMULACAO },
    select: { fatorVelocidade: true, operador: true },
  })

  return config
}

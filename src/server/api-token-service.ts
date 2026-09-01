import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { AmbienteApiToken } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'

/**
 * Prefixo visível do token, distinto por ambiente — para o lojista notar de
 * imediato, só de olhar a chave colada, se pegou a de sandbox ou a de
 * produção (requisito da Task 4.1).
 */
const PREFIXOS: Record<AmbienteApiToken, string> = {
  SANDBOX: 'frete_test_',
  PRODUCAO: 'frete_live_',
}

const BYTES_SEGREDO = 32

export type TokenCriado = {
  id: string
  nome: string
  ambiente: AmbienteApiToken
  ultimoUsoEm: null
  revogadoEm: null
  criadoEm: Date
  /** Valor em claro — só existe neste retorno. Nunca gravado, nunca relido. */
  tokenClaro: string
}

export type TokenListado = {
  id: string
  nome: string
  ambiente: AmbienteApiToken
  ultimoUsoEm: Date | null
  revogadoEm: Date | null
  criadoEm: Date
}

export type TokenAutenticado = {
  tokenId: string
  userId: string
  ambiente: AmbienteApiToken
  /**
   * Loja dona do token, quando ele foi criado dentro de um perfil.
   *
   * É o que faz o envio e o pedido nascerem sabendo por qual WhatsApp avisar o
   * comprador, sem o integrador repetir a loja em toda requisição — e um campo
   * repetido a cada chamada é um campo que uma hora vem trocado.
   *
   * Nulo nos tokens antigos, que valem para a conta inteira. Sem perfil não há
   * mensagem, que é melhor do que mensagem pelo número de outra loja.
   */
  perfilId: string | null
}

function hashToken(tokenClaro: string): string {
  return createHash('sha256').update(tokenClaro).digest('hex')
}

/**
 * Gera o segredo com `randomBytes` (nunca `Math.random`) e prefixa por
 * ambiente. O prefixo é só um rótulo — a entropia inteira está nos 32 bytes
 * aleatórios que seguem ele.
 */
function gerarTokenClaro(ambiente: AmbienteApiToken): string {
  return `${PREFIXOS[ambiente]}${randomBytes(BYTES_SEGREDO).toString('hex')}`
}

/**
 * Cria um token de API para a conta. O valor em claro (`tokenClaro`) volta
 * uma única vez, aqui — só o hash SHA-256 fica gravado. Depois desta
 * chamada, nada no sistema (listagem, log, mensagem de erro) volta a expor
 * o valor original.
 */
export async function criarToken(
  userId: string,
  nome: string,
  ambiente: AmbienteApiToken,
): Promise<TokenCriado> {
  const tokenClaro = gerarTokenClaro(ambiente)
  const tokenHash = hashToken(tokenClaro)

  const criado = await prisma.apiToken.create({
    data: { userId, nome, tokenHash, ambiente },
  })

  return {
    id: criado.id,
    nome: criado.nome,
    ambiente: criado.ambiente,
    ultimoUsoEm: null,
    revogadoEm: null,
    criadoEm: criado.criadoEm,
    tokenClaro,
  }
}

/**
 * Lista os tokens da conta. Nunca seleciona `tokenHash` — mesmo o hash não
 * tem por que sair desta função.
 */
export async function listarTokens(userId: string): Promise<TokenListado[]> {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      nome: true,
      ambiente: true,
      ultimoUsoEm: true,
      revogadoEm: true,
      criadoEm: true,
    },
    orderBy: { criadoEm: 'desc' },
  })
}

/**
 * Revoga um token da conta. Idempotente: revogar de novo não é erro, só não
 * muda `revogadoEm` de novo. Token de outra conta é tratado como
 * inexistente (mesmo padrão de `buscarOpcaoDaCotacao` em
 * `shipment-service.ts`) — o dono nunca aprende, pela resposta, que aquele
 * id existe em outra conta.
 */
export async function revogarToken(userId: string, tokenId: string): Promise<void> {
  const token = await prisma.apiToken.findUnique({ where: { id: tokenId } })
  if (!token || token.userId !== userId) {
    throw new NaoAutorizadoError(`Token não encontrado: ${tokenId}`)
  }

  if (token.revogadoEm) {
    return
  }

  await prisma.apiToken.update({
    where: { id: tokenId },
    data: { revogadoEm: new Date() },
  })
}

/**
 * Autentica um token em claro recebido em `Authorization: Bearer`.
 *
 * O hash do valor recebido é buscado por igualdade no índice único de
 * `tokenHash` — a busca em si não vaza tempo proporcional a nenhum segredo
 * porque o hash já difunde o valor original por completo. Ainda assim, a
 * comparação final entre o hash calculado e o hash gravado usa
 * `timingSafeEqual`, não `===`, para nunca depender de curto-circuito de
 * string em nenhuma camada — nem a query, nem o código aqui, comparam o
 * segredo caractere a caractere.
 *
 * Token inexistente ou revogado devolve `null` — o chamador (rota HTTP)
 * decide o código de erro; este módulo não conhece HTTP.
 */
export async function autenticarToken(tokenClaro: string): Promise<TokenAutenticado | null> {
  const tokenHash = hashToken(tokenClaro)

  const encontrado = await prisma.apiToken.findUnique({ where: { tokenHash } })
  if (!encontrado) {
    return null
  }

  const bufferEncontrado = Buffer.from(encontrado.tokenHash, 'hex')
  const bufferCalculado = Buffer.from(tokenHash, 'hex')
  if (
    bufferEncontrado.length !== bufferCalculado.length ||
    !timingSafeEqual(bufferEncontrado, bufferCalculado)
  ) {
    return null
  }

  if (encontrado.revogadoEm) {
    return null
  }

  await prisma.apiToken.update({
    where: { id: encontrado.id },
    data: { ultimoUsoEm: new Date() },
  })

  return {
    tokenId: encontrado.id,
    userId: encontrado.userId,
    ambiente: encontrado.ambiente,
    perfilId: encontrado.perfilId,
  }
}

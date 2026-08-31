import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { aplicarDebito } from '@/domain/wallet/ledger'
import { garantirTransicao, type StatusShipment } from '@/domain/shipment/estados'
import type { OpcaoCotacao } from '@/domain/pricing/cotacao'
import {
  CarteiraNaoEncontradaError,
  CotacaoExpiradaError,
  EnvioNaoEncontradoError,
  NaoAutorizadoError,
} from '@/domain/errors'

/**
 * Endereço copiado para dentro do envio (`Shipment.remetente` /
 * `Shipment.destinatario`). É uma cópia deliberada, não uma referência a
 * `Address`: uma etiqueta já emitida não pode mudar porque o cliente editou
 * ou arquivou o endereço original depois. Ver requisito 6 do brief da
 * Task 13.
 */
export type EnderecoEnvio = {
  documento?: string
  nome: string
  email?: string
  telefone?: string
  cep: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  cidade: string
  uf: string
}

export type ProdutoDeclarado = {
  nome: string
  quantidade: number
  valorUnitarioCentavos: number
}

/**
 * Entrada de `criarEnvio`. Propositalmente NÃO tem nenhum campo de preço —
 * `precoCobradoCentavos` só pode vir da `Quote` já salva no servidor (ver
 * requisito 3 do brief). Mesmo que o body HTTP traga um campo de preço, o
 * schema Zod da borda (`src/app/api/envios/route.ts`) descarta chaves
 * desconhecidas e este tipo não teria onde colocá-lo.
 */
export type EntradaEnvio = {
  quoteId: string
  servicoId: string
  remetente: EnderecoEnvio
  destinatario: EnderecoEnvio
  produtos: ProdutoDeclarado[]
}

export type EnvioCriado = {
  id: string
  status: StatusShipment
  precoBalcaoCentavos: number
  precoCobradoCentavos: number
  descontoCentavos: number
  valorDeclaradoCentavos: number
}

export type PreviaEnvio = {
  servicoId: string
  servicoNome: string
  carrierNome: string
  precoBalcaoCentavos: number
  precoCobradoCentavos: number
  descontoCentavos: number
  prazoDias: number
}

function somarValorDeclarado(produtos: ProdutoDeclarado[]): number {
  return produtos.reduce((total, produto) => total + produto.quantidade * produto.valorUnitarioCentavos, 0)
}

/**
 * Busca a cotação do usuário e a opção de serviço escolhida dentro dela.
 * Nunca confia em nada vindo do cliente além de `quoteId`/`servicoId`: o
 * preço sempre vem do `opcoes` gravado no momento da cotação.
 *
 * Cotação inexistente OU pertencente a outro usuário resultam no mesmo
 * `EnvioNaoEncontradoError` (→ 404) — o chamador nunca distingue "não
 * existe" de "não é sua", pelo mesmo motivo de `buscarEnderecoDoUsuario`
 * em `enderecos-service.ts`.
 */
async function buscarOpcaoDaCotacao(
  userId: string,
  quoteId: string,
  servicoId: string,
): Promise<OpcaoCotacao> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } })

  if (!quote || quote.userId !== userId) {
    throw new EnvioNaoEncontradoError(`Cotação não encontrada: ${quoteId}`)
  }

  if (quote.expiraEm.getTime() <= Date.now()) {
    throw new CotacaoExpiradaError('Esta cotação expirou. Gere uma nova cotação para continuar.')
  }

  const opcoes = quote.opcoes as unknown as OpcaoCotacao[]
  const opcao = opcoes.find((o) => o.servicoId === servicoId && o.disponivel)

  if (!opcao) {
    throw new EnvioNaoEncontradoError(
      `Serviço ${servicoId} não está disponível na cotação ${quoteId}.`,
    )
  }

  return opcao
}

/**
 * Devolve a prévia de preço de um envio (o que a etapa de revisão mostra
 * antes de confirmar), sem criar nada. Usa exatamente a mesma resolução de
 * preço de `criarEnvio` — nunca um cálculo paralelo que possa divergir.
 */
export async function obterPreviaEnvio(
  userId: string,
  quoteId: string,
  servicoId: string,
): Promise<PreviaEnvio> {
  const opcao = await buscarOpcaoDaCotacao(userId, quoteId, servicoId)
  return {
    servicoId: opcao.servicoId,
    servicoNome: opcao.servicoNome,
    carrierNome: opcao.carrierNome,
    precoBalcaoCentavos: opcao.precoBalcaoCentavos,
    precoCobradoCentavos: opcao.precoFinalCentavos,
    descontoCentavos: opcao.descontoCentavos,
    prazoDias: opcao.prazoDias,
  }
}

/**
 * Cria um envio em `PENDING`. O preço cobrado vem exclusivamente da opção
 * escolhida dentro da `Quote` salva (`buscarOpcaoDaCotacao`) — nunca do
 * `entrada` informado pelo chamador, que não tem campo de preço algum.
 * Remetente e destinatário são gravados como cópia JSON (requisito 6).
 */
export async function criarEnvio(userId: string, entrada: EntradaEnvio): Promise<EnvioCriado> {
  const opcao = await buscarOpcaoDaCotacao(userId, entrada.quoteId, entrada.servicoId)
  const valorDeclaradoCentavos = somarValorDeclarado(entrada.produtos)

  const envio = await prisma.shipment.create({
    data: {
      userId,
      quoteId: entrada.quoteId,
      serviceId: entrada.servicoId,
      status: 'PENDING',
      remetente: entrada.remetente as unknown as Prisma.InputJsonValue,
      destinatario: entrada.destinatario as unknown as Prisma.InputJsonValue,
      precoBalcaoCentavos: opcao.precoBalcaoCentavos,
      precoCobradoCentavos: opcao.precoFinalCentavos,
      descontoCentavos: opcao.descontoCentavos,
      opcionais: {},
      valorDeclaradoCentavos,
      produtos: entrada.produtos as unknown as Prisma.InputJsonValue,
    },
  })

  return {
    id: envio.id,
    status: envio.status,
    precoBalcaoCentavos: envio.precoBalcaoCentavos,
    precoCobradoCentavos: envio.precoCobradoCentavos,
    descontoCentavos: envio.descontoCentavos,
    valorDeclaradoCentavos: envio.valorDeclaradoCentavos,
  }
}

/**
 * Debita a carteira do usuário pelo preço do envio e move o envio de
 * `PENDING` para `RELEASED`, de forma atômica.
 *
 * O `SELECT ... FOR UPDATE` na linha da `Wallet` é o que serializa dois
 * pagamentos concorrentes: a segunda transação só enxerga a linha depois
 * que a primeira commitou (ou abortou), então lê o saldo já atualizado —
 * sem isso, as duas leriam o mesmo saldo "antigo" e as duas debitariam,
 * deixando o saldo negativo. Segue o mesmo padrão de
 * `obterCarteiraBloqueada` em `wallet-service.ts`.
 *
 * Pagar duas vezes o mesmo envio debita uma vez só: na segunda chamada,
 * `envio.status` já é `RELEASED` e `garantirTransicao` lança
 * `TransicaoInvalidaError` antes de qualquer débito.
 */
export async function pagarEnvio(userId: string, shipmentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    })

    const linhas = await tx.$queryRaw<{ id: string; saldoCentavos: number }[]>`
      SELECT id, "saldoCentavos" FROM wallets WHERE id = ${wallet.id} FOR UPDATE
    `
    const carteira = linhas[0]
    if (!carteira) {
      throw new CarteiraNaoEncontradaError(`Carteira não encontrada para o usuário ${userId}.`)
    }

    const envio = await tx.shipment.findUnique({ where: { id: shipmentId } })
    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }
    if (envio.userId !== userId) {
      throw new NaoAutorizadoError('Este envio pertence a outro usuário.')
    }

    garantirTransicao(envio.status, 'RELEASED')

    const lancamento = aplicarDebito(carteira.saldoCentavos, envio.precoCobradoCentavos)

    await tx.ledgerEntry.create({
      data: {
        walletId: carteira.id,
        tipo: lancamento.tipo,
        valorCentavos: lancamento.valorCentavos,
        saldoAposCentavos: lancamento.saldoAposCentavos,
        refTipo: 'SHIPMENT',
        refId: envio.id,
        descricao: `Pagamento do envio ${envio.id}`,
      },
    })

    await tx.wallet.update({
      where: { id: carteira.id },
      data: { saldoCentavos: lancamento.saldoAposCentavos },
    })

    await tx.shipment.update({
      where: { id: envio.id },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })
  })
}

import { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { aplicarDebito } from '@/domain/wallet/ledger'
import { garantirTransicao, type StatusShipment } from '@/domain/shipment/estados'
import type { OpcaoCotacao } from '@/domain/pricing/cotacao'
import { normalizarCep } from '@/domain/pricing/cep'
import { PRECO_ETIQUETA_CENTAVOS } from '@/domain/pricing/etiqueta'
import {
  CarteiraNaoEncontradaError,
  CotacaoExpiradaError,
  CotacaoNaoCorrespondeError,
  CotacaoNaoEncontradaError,
  EnvioNaoEncontradoError,
  NaoAutorizadoError,
  TransicaoInvalidaError,
} from '@/domain/errors'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { enfileirarEvento } from './webhook-service'
import { enfileirarSms } from './sms-service'

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
  /**
   * `true` para envios criados pela API pública com um `ApiToken` de
   * ambiente SANDBOX (ver `src/server/api-publica-service.ts`). Só marca a
   * linha — não muda nenhum cálculo de preço nem a validação de endereço.
   * Default `false`: o fluxo do painel nunca passa este campo.
   */
  sandbox?: boolean
  /**
   * Loja que originou o envio, quando a chamada veio de um token de perfil.
   *
   * Só grava o vínculo — é o que permite avisar o comprador pelo WhatsApp da
   * marca certa quando o status mudar. Envio sem perfil não gera mensagem
   * nenhuma, que é o comportamento correto: melhor não avisar do que avisar
   * pelo número de outra loja.
   */
  perfilId?: string | null
}

export type EnvioCriado = {
  id: string
  status: StatusShipment
  precoBalcaoCentavos: number
  /** Frete calculado. Informativo — não é o que sai da carteira. */
  precoFreteCentavos: number
  /** O que a plataforma cobra por esta etiqueta. */
  precoCobradoCentavos: number
  descontoCentavos: number
  valorDeclaradoCentavos: number
  sandbox: boolean
}

export type PreviaEnvio = {
  servicoId: string
  servicoNome: string
  carrierNome: string
  precoBalcaoCentavos: number
  /** Frete calculado pela tabela, exibido na revisão e na etiqueta. */
  precoFreteCentavos: number
  /** O que será debitado da carteira ao gerar a etiqueta. */
  precoCobradoCentavos: number
  descontoCentavos: number
  prazoDias: number
}

function somarValorDeclarado(produtos: ProdutoDeclarado[]): number {
  return produtos.reduce((total, produto) => total + produto.quantidade * produto.valorUnitarioCentavos, 0)
}

type QuoteComOpcoes = Awaited<ReturnType<typeof prisma.quote.findUnique>>

/**
 * Busca a cotação do usuário e a opção de serviço escolhida dentro dela.
 * Nunca confia em nada vindo do cliente além de `quoteId`/`servicoId`: o
 * preço sempre vem do `opcoes` gravado no momento da cotação.
 *
 * Cotação inexistente OU pertencente a outro usuário resultam no mesmo
 * `CotacaoNaoEncontradaError` (→ 404) — o chamador nunca distingue "não
 * existe" de "não é sua", pelo mesmo motivo de `buscarEnderecoDoUsuario`
 * em `enderecos-service.ts`.
 */
async function buscarOpcaoDaCotacao(
  userId: string,
  quoteId: string,
  servicoId: string,
): Promise<{ quote: NonNullable<QuoteComOpcoes>; opcao: OpcaoCotacao }> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } })

  if (!quote || quote.userId !== userId) {
    throw new CotacaoNaoEncontradaError(`Cotação não encontrada: ${quoteId}`)
  }

  if (quote.expiraEm.getTime() <= Date.now()) {
    throw new CotacaoExpiradaError('Esta cotação expirou. Gere uma nova cotação para continuar.')
  }

  const opcoes = quote.opcoes as unknown as OpcaoCotacao[]
  const opcao = opcoes.find((o) => o.servicoId === servicoId && o.disponivel)

  if (!opcao) {
    throw new CotacaoNaoEncontradaError(
      `Serviço ${servicoId} não está disponível na cotação ${quoteId}.`,
    )
  }

  return { quote, opcao }
}

/**
 * Confere que o remetente e o destinatário informados são os mesmos CEPs
 * que geraram o preço da cotação. Sem isso, dá para cotar uma rota barata
 * (ex.: SP → RJ) e criar o envio com um destino bem mais caro (ex.: SP →
 * Manaus), pagando a tarifa errada — a cotação só sabe o preço da rota que
 * ela mesma calculou, `criarEnvio` não recalcula nada.
 *
 * A cotação hoje não guarda peso/dimensões próprios do envio — `Shipment`
 * sempre herda peso/dimensões implicitamente da cotação (não há campo de
 * peso/dimensões em `EntradaEnvio`), então não há como o cliente declarar
 * peso ou dimensões diferentes dos cotados. Só o CEP precisa ser validado
 * aqui.
 */
function validarEnderecosContraCotacao(
  quote: NonNullable<QuoteComOpcoes>,
  remetente: EnderecoEnvio,
  destinatario: EnderecoEnvio,
): void {
  const cepOrigemEnvio = normalizarCep(remetente.cep)
  const cepDestinoEnvio = normalizarCep(destinatario.cep)
  const cepOrigemCotacao = normalizarCep(quote.cepOrigem)
  const cepDestinoCotacao = normalizarCep(quote.cepDestino)

  if (cepOrigemEnvio !== cepOrigemCotacao || cepDestinoEnvio !== cepDestinoCotacao) {
    throw new CotacaoNaoCorrespondeError(
      'Os endereços de remetente e/ou destinatário não conferem com os CEPs desta cotação. Gere uma nova cotação para esta rota.',
    )
  }
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
  const { opcao } = await buscarOpcaoDaCotacao(userId, quoteId, servicoId)
  return {
    servicoId: opcao.servicoId,
    servicoNome: opcao.servicoNome,
    carrierNome: opcao.carrierNome,
    precoBalcaoCentavos: opcao.precoBalcaoCentavos,
    precoFreteCentavos: opcao.precoFinalCentavos,
    precoCobradoCentavos: PRECO_ETIQUETA_CENTAVOS,
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
  const { quote, opcao } = await buscarOpcaoDaCotacao(userId, entrada.quoteId, entrada.servicoId)
  validarEnderecosContraCotacao(quote, entrada.remetente, entrada.destinatario)
  const valorDeclaradoCentavos = somarValorDeclarado(entrada.produtos)

  const envio = await prisma.$transaction(async (tx) => {
    const criado = await tx.shipment.create({
      data: {
        userId,
        quoteId: entrada.quoteId,
        serviceId: entrada.servicoId,
        status: 'PENDING',
        remetente: entrada.remetente as unknown as Prisma.InputJsonValue,
        destinatario: entrada.destinatario as unknown as Prisma.InputJsonValue,
        precoBalcaoCentavos: opcao.precoBalcaoCentavos,
        // O frete calculado fica gravado como informação da etiqueta; o que
        // a plataforma cobra é o valor fixo por etiqueta gerada, e é ele que
        // `pagarEnvio` debita.
        precoFreteCentavos: opcao.precoFinalCentavos,
        precoCobradoCentavos: PRECO_ETIQUETA_CENTAVOS,
        descontoCentavos: opcao.descontoCentavos,
        opcionais: {},
        valorDeclaradoCentavos,
        produtos: entrada.produtos as unknown as Prisma.InputJsonValue,
        sandbox: entrada.sandbox ?? false,
        perfilId: entrada.perfilId ?? null,
      },
    })

    // Na mesma transação do envio: se a criação der rollback, não sobra
    // notificação de um envio que não existe. Só grava linhas — nenhuma
    // requisição de rede acontece aqui.
    await enfileirarEvento(criado.id, 'order.created', tx)

    return criado
  })

  return {
    id: envio.id,
    status: envio.status,
    precoBalcaoCentavos: envio.precoBalcaoCentavos,
    precoFreteCentavos: envio.precoFreteCentavos,
    precoCobradoCentavos: envio.precoCobradoCentavos,
    descontoCentavos: envio.descontoCentavos,
    valorDeclaradoCentavos: envio.valorDeclaradoCentavos,
    sandbox: envio.sandbox,
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
 *
 * O `update` final do envio é condicional em `status: 'PENDING'`
 * (`updateMany`, não `update` por `id`): pagar e cancelar o mesmo envio ao
 * mesmo tempo não disputam o lock da carteira (cancelar não toca na
 * carteira), então sem essa condição as duas operações liam `PENDING` e as
 * duas escreviam por cima uma da outra em silêncio — o cancelamento
 * "sumia" sem erro nenhum. Com a condição, quem perde a corrida encontra
 * zero linhas afetadas e cai no branch de `TransicaoInvalidaError` abaixo,
 * em vez de sobrescrever silenciosamente o resultado do outro.
 *
 * Também recusa pagar um envio cuja cotação já expirou entre a criação do
 * envio (`PENDING`) e a tentativa de pagamento — sem isso, um envio parado
 * por meses continuaria pagável pela tarifa congelada de uma cotação
 * havia muito vencida.
 */
/**
 * Emite a etiqueta do envio recém-pago, fora da transação de pagamento.
 *
 * Chamada depois do `$transaction` de `pagarEnvio` já ter commitado — nunca
 * de dentro dela. Se `emitirEtiqueta` falhar (banco fora do ar, bug no
 * gerador de roteiro, o que for), o pagamento já está gravado e não pode
 * voltar: o cliente que teve o saldo debitado não pode ver o débito sumir
 * porque a emissão tropeçou. A falha aqui vai só para log estruturado — o
 * envio fica em `RELEASED`, pago e sem código, e a rota
 * `POST /api/envios/[id]/etiqueta` (ou uma tarefa administrativa) reemite
 * depois chamando `emitirEtiqueta` de novo; como o envio continua
 * `RELEASED`, a chamada não é recusada por `garantirTransicao`.
 */
async function emitirEtiquetaAposPagamento(shipmentId: string): Promise<void> {
  try {
    await emitirEtiqueta(shipmentId)
  } catch (error) {
    console.error('Falha ao emitir etiqueta após pagamento do envio', {
      shipmentId,
      cause: error,
    })
  }
}

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

    const dono = await tx.user.findUnique({
      where: { id: userId },
      select: { isentoCobranca: true },
    })
    const isento = dono?.isentoCobranca === true

    const envio = await tx.shipment.findUnique({ where: { id: shipmentId } })
    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }
    if (envio.userId !== userId) {
      throw new NaoAutorizadoError('Este envio pertence a outro usuário.')
    }

    garantirTransicao(envio.status, 'RELEASED')

    // Envio sandbox nunca paga pelo caminho real de dinheiro: quem cria um
    // envio de teste pela API pública usa `pagarEnvioSandbox`
    // (`api-publica-service.ts`), que nem toca a `Wallet`. Se este caminho
    // fosse chamado por engano sobre um envio sandbox, ele recusa aqui em
    // vez de debitar saldo real por um pedido de teste.
    if (envio.sandbox) {
      throw new TransicaoInvalidaError(
        `Envio ${envio.id} é sandbox e não pode ser pago pelo fluxo real de carteira.`,
      )
    }

    if (envio.quoteId) {
      const quote = await tx.quote.findUnique({ where: { id: envio.quoteId } })
      if (quote && quote.expiraEm.getTime() <= Date.now()) {
        throw new CotacaoExpiradaError(
          'A cotação que gerou este envio expirou. Cancele e gere uma nova cotação para continuar.',
        )
      }
    }

    /*
      Conta isenta não paga e não gera lançamento.

      Não é saldo infinito: creditar a carteira de mentira inventaria
      receita no extrato, e o financeiro passaria a somar dinheiro que
      ninguém pagou. Sem lançamento, `houveCobranca` responde falso e a API
      devolve `charged: false` — que é a verdade.

      Tudo o mais é idêntico ao caminho pago: posse, recusa de sandbox,
      cotação vencida, transição e emissão da etiqueta. A isenção tira o
      dinheiro do caminho, não as regras.
    */
    if (!isento) {
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
    }

    const resultado = await tx.shipment.updateMany({
      where: { id: envio.id, status: 'PENDING' },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })

    if (resultado.count === 0) {
      throw new TransicaoInvalidaError(
        `Envio ${envio.id} não está mais PENDING (alterado por outra operação concorrente, como um cancelamento).`,
      )
    }

    // Depois da transição confirmada, dentro da mesma transação: um rollback
    // do débito leva a notificação junto, e o cliente nunca é avisado de um
    // pagamento que não aconteceu.
    await enfileirarEvento(envio.id, 'order.released', tx)
  })

  // Fora da transação de pagamento, de propósito: ver o comentário de
  // `emitirEtiquetaAposPagamento`. Uma falha aqui nunca desfaz o débito
  // acima nem derruba esta chamada — `pagarEnvio` sempre resolve depois que
  // o pagamento em si foi gravado.
  await emitirEtiquetaAposPagamento(shipmentId)

  await avisarCompradorPorSms(shipmentId)
}

/**
 * Avisa o comprador, por SMS, de que o pagamento entrou.
 *
 * Roda depois da etiqueta para que o código de rastreio já exista quando a
 * mensagem for composta — o aviso vale bem mais com o link do que sem.
 *
 * Nunca lança e nunca derruba o pagamento. Aviso ao comprador é um extra do
 * envio: uma falha aqui não pode desfazer um débito que já aconteceu nem
 * devolver erro a quem pagou corretamente. É a mesma regra do aviso por
 * e-mail, algumas linhas acima em `sincronizar-envio-service`.
 *
 * O telefone sai do destinatário do próprio envio — o mesmo que a loja mandou
 * em `/cart`. Não há campo novo a preencher nem integração a mudar do lado de
 * quem já integrou.
 */
async function avisarCompradorPorSms(shipmentId: string): Promise<void> {
  try {
    const envio = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { perfilId: true, sandbox: true, destinatario: true },
    })

    // Sem perfil não há loja dona da mensagem, e envio de teste não avisa
    // ninguém: o comprador de um pedido que não existe não pode receber SMS.
    if (!envio || !envio.perfilId || envio.sandbox) return

    const destinatario = envio.destinatario as { telefone?: string | null } | null
    const telefone = destinatario?.telefone?.trim()
    if (!telefone) return

    await enfileirarSms({
      perfilId: envio.perfilId,
      evento: 'PEDIDO_PAGO',
      para: telefone,
      shipmentId,
      valores: {},
    })
  } catch (error) {
    console.error('Falha ao enfileirar o aviso de pagamento por SMS', { cause: error })
  }
}

/**
 * Reemite a etiqueta de um envio que ficou `RELEASED` (pago) sem código de
 * rastreio — o caminho de retentativa para quando
 * `emitirEtiquetaAposPagamento` falhou depois do pagamento.
 *
 * É a mesma `emitirEtiqueta`, exposta por aqui só para nomear a intenção de
 * "retentar" no chamador. Um envio já `GENERATED` continua sendo recusado
 * por `garantirTransicao` dentro dela — de propósito, não duplica código
 * nem timeline.
 */
export async function reemitirEtiqueta(shipmentId: string): Promise<{ codigoRastreio: string }> {
  return emitirEtiqueta(shipmentId)
}

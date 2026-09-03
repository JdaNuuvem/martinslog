import { randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import type { AmbienteApiToken, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { garantirTransicao } from '@/domain/shipment/estados'
import {
  EnvioNaoEncontradoError,
  LimiteRequisicoesExcedidoError,
  TokenInvalidoError,
  TransicaoInvalidaError,
} from '@/domain/errors'
import { autenticarToken, type TokenAutenticado } from '@/server/api-token-service'
import { consumirCota } from '@/server/rate-limit'
import { gerarCotacao, type SolicitacaoCotacao } from '@/server/cotacao-service'
import { criarEnvio, type EntradaEnvio, pagarEnvio } from '@/server/shipment-service'
import { enfileirarEvento, type Evento } from '@/server/webhook-service'

/**
 * Camada de adaptação da API pública (`/api/v0`), que espelha os contratos
 * do SuperFrete para portabilidade de plugins existentes. Não reimplementa
 * nenhuma regra de negócio — reúsa `gerarCotacao`/`criarEnvio`/`pagarEnvio`
 * exatamente como o painel os usa. O que existe aqui é só tradução de forma
 * (JSON do contrato externo) e o desvio de dinheiro real do fluxo sandbox.
 */

const POLITICA_COTA_TOKEN = { escopo: 'api-v0', limite: 60, janelaMs: 60_000 }

export type ContextoApi = TokenAutenticado

/**
 * Lê `Authorization: Bearer <token>`, autentica contra `ApiToken` e aplica
 * o limite de requisições **por token** (não por IP — uma integração ativa
 * de uma loja não pode derrubar a cota de outra loja atrás do mesmo
 * servidor/proxy). Token ausente, inválido ou revogado lança
 * `TokenInvalidoError`; cota excedida lança `LimiteRequisicoesExcedidoError`.
 */
export async function autenticarRequisicao(request: NextRequest): Promise<ContextoApi> {
  const cabecalho = request.headers.get('authorization') ?? ''
  const [esquema, valor] = cabecalho.split(' ')

  if (esquema?.toLowerCase() !== 'bearer' || !valor) {
    throw new TokenInvalidoError('Informe o token no cabeçalho Authorization: Bearer <token>.')
  }

  const autenticado = await autenticarToken(valor.trim())
  if (!autenticado) {
    throw new TokenInvalidoError('Token inválido ou revogado.')
  }

  const cota = consumirCota(POLITICA_COTA_TOKEN, autenticado.tokenId)
  if (!cota.permitido) {
    throw new LimiteRequisicoesExcedidoError(
      `Limite de requisições excedido para este token. Tente novamente em ${cota.reabreEmSegundos}s.`,
    )
  }

  return autenticado
}

export type ItemCalculadora = {
  id: string
  name: string
  price: string
  discount: string
  delivery_time: number
  company: { name: string }
}

/**
 * `POST /api/v0/calculator`. O `id` de cada opção é `quoteId:servicoId` —
 * o par que `criarCarrinho` precisa para gravar o envio sem recalcular
 * preço nenhum (o preço sempre vem da `Quote` salva por `gerarCotacao`,
 * nunca do corpo desta requisição).
 */
export async function calcularCotacao(
  solicitacao: SolicitacaoCotacao,
  userId: string,
): Promise<ItemCalculadora[]> {
  const resultado = await gerarCotacao(solicitacao, { userId, anonSessionId: null })

  return resultado.opcoes
    .filter((opcao) => opcao.disponivel)
    .map((opcao) => ({
      id: `${resultado.quoteId}:${opcao.servicoId}`,
      name: opcao.servicoNome,
      price: (opcao.precoFinalCentavos / 100).toFixed(2),
      discount: (opcao.descontoCentavos / 100).toFixed(2),
      delivery_time: opcao.prazoDias,
      company: { name: opcao.carrierNome },
    }))
}

export type EntradaCarrinho = {
  service: string
  remetente: EntradaEnvio['remetente']
  destinatario: EntradaEnvio['destinatario']
  produtos: EntradaEnvio['produtos']
  /** Código do pedido na loja, para o comprador ver um código só. */
  external_id?: string
}

/**
 * Item do carrinho.
 *
 * `price` é o **frete** do envio, que é o que o integrador mostra ao
 * comprador dele. `label_fee` é o que a plataforma cobra do lojista por
 * etiqueta gerada — número diferente, com dono diferente, e misturar os dois
 * num campo só fez a API responder R$ 1,00 onde deveria estar o transporte.
 *
 * `charged` diz se a taxa **foi cobrada de fato**. Sem ele, `label_fee`
 * responde 1.00 tanto para um envio pago quanto para um de sandbox ou ainda
 * pendente, e quem somasse o campo contaria dinheiro que nunca saiu.
 */
export type ItemCarrinho = {
  id: string
  price: string
  label_fee: string
  charged: boolean
  status: string
  /** A referência que a loja mandou. Nulo quando não mandou. */
  external_id: string | null
}

function dividirIdServico(service: string): { quoteId: string; servicoId: string } {
  const separador = service.indexOf(':')
  if (separador === -1) {
    throw new EnvioNaoEncontradoError(`Identificador de serviço inválido: ${service}`)
  }
  return { quoteId: service.slice(0, separador), servicoId: service.slice(separador + 1) }
}


/**
 * `POST /api/v0/cart`. Cria o envio reusando `criarEnvio` — preço sempre
 * vem da `Quote`, nunca do corpo. Em sandbox, o envio nasce marcado
 * (`Shipment.sandbox`) e a notificação `order.created` (se o lojista tiver
 * webhook cadastrado) sai com `sandbox: true` no payload.
 */
export async function criarCarrinho(
  contexto: ContextoApi,
  entrada: EntradaCarrinho,
): Promise<ItemCarrinho> {
  const { quoteId, servicoId } = dividirIdServico(entrada.service)
  const sandbox = contexto.ambiente === 'SANDBOX'

  const envio = await criarEnvio(contexto.userId, {
    quoteId,
    servicoId,
    remetente: entrada.remetente,
    destinatario: entrada.destinatario,
    produtos: entrada.produtos,
    referenciaExterna: entrada.external_id ?? null,
    sandbox,
    // Vem do token, não do corpo: um perfil informado a cada requisição é um
    // perfil que uma hora vai vir trocado, e o comprador receberia a mensagem
    // pelo WhatsApp de outra loja sem que nada acusasse o erro.
    perfilId: contexto.perfilId,
  })

  return {
    id: envio.id,
    price: (envio.precoFreteCentavos / 100).toFixed(2),
    label_fee: (envio.precoCobradoCentavos / 100).toFixed(2),
    charged: await houveCobranca(envio.id),
    status: envio.status,
    external_id: envio.referenciaExterna,
  }
}

/**
 * Paga um envio sandbox sem tocar a `Wallet` real. Não é uma versão
 * "mais fraca" de `pagarEnvio` — é deliberadamente outro caminho: nenhum
 * `LedgerEntry` é criado, nenhum saldo é lido ou escrito. O único efeito é
 * a transição de estado e um código de rastreio fictício, prefixado para
 * nunca ser confundido com um código real emitido por
 * `emitir-etiqueta-service.ts` (que este caminho nunca chama).
 */
async function pagarEnvioSandbox(userId: string, shipmentId: string): Promise<void> {
  const envio = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!envio || envio.userId !== userId) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }
  if (!envio.sandbox) {
    throw new TransicaoInvalidaError(
      `Envio ${shipmentId} não é sandbox — use o checkout real para pagá-lo.`,
    )
  }

  garantirTransicao(envio.status, 'RELEASED')

  const codigoSandbox = `SANDBOX${randomBytes(6).toString('hex').toUpperCase()}`

  const resultado = await prisma.shipment.updateMany({
    where: { id: shipmentId, status: 'PENDING' },
    data: { status: 'RELEASED', pagoEm: new Date(), codigoRastreio: codigoSandbox },
  })

  if (resultado.count === 0) {
    throw new TransicaoInvalidaError(
      `Envio ${shipmentId} não está mais PENDING (alterado por outra operação concorrente).`,
    )
  }

  await enfileirarEvento(shipmentId, 'order.released')
}

export type ResultadoCheckout = {
  status: string
  orders: { id: string; status: string }[]
}

/**
 * `POST /api/v0/checkout`. Cada envio da lista é resolvido pelo dono do
 * token, nunca por um id de usuário vindo do corpo — um token não paga
 * envio de outra conta (`EnvioNaoEncontradoError` → 404, o mesmo padrão
 * dos outros serviços desta base para "não existe" vs. "não é seu").
 *
 * Produção usa `pagarEnvio` (débito real, idêntico ao do painel). Sandbox
 * usa `pagarEnvioSandbox`, que nunca encosta na `Wallet`.
 */
export async function checkout(
  contexto: ContextoApi,
  orderIds: string[],
): Promise<ResultadoCheckout> {
  const orders: { id: string; status: string }[] = []

  for (const id of orderIds) {
    const envio = await prisma.shipment.findUnique({ where: { id } })
    if (!envio || envio.userId !== contexto.userId) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${id}`)
    }

    if (contexto.ambiente === 'SANDBOX') {
      await pagarEnvioSandbox(contexto.userId, id)
    } else {
      await pagarEnvio(contexto.userId, id)
    }

    // Relê o status após pagar: em produção, `pagarEnvio` tenta emitir a
    // etiqueta na sequência (`emitirEtiquetaAposPagamento`), e o envio pode
    // já estar em `GENERATED` quando esta função devolve — devolver
    // `RELEASED` fixo aqui mentiria sobre o estado real gravado no banco.
    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id } })
    orders.push({ id, status: atualizado.status })
  }

  return { status: 'approved', orders }
}

export type InfoEnvio = {
  id: string
  status: string
  tracking: string | null
  tracking_url: string | null
  /** A referência que a loja mandou no `/cart`. Nulo quando não mandou. */
  external_id: string | null
  /** Frete do envio: o valor do transporte, que o comprador do lojista vê. */
  price: string
  /** Taxa por etiqueta gerada. É o preço; `charged` diz se foi cobrado. */
  label_fee: string
  /** Se a taxa saiu da carteira de fato. Falso em sandbox e antes do pagamento. */
  charged: boolean
  sandbox: boolean
  /**
   * Quando a carga voltou ao remetente, em vez de chegar ao comprador.
   *
   * Existe porque devolução também vira `DELIVERED` e também dispara
   * `order.delivered`: sem este campo, a loja marcaria como entregue ao
   * cliente um pacote que está de volta no estoque dela.
   */
  returned_at: string | null
  created_at: string
}

/**
 * `GET /api/v0/order/info/:id`. Resolve o envio pelo dono do token — id de
 * outro lojista devolve `EnvioNaoEncontradoError` (404), nunca 403: a rota
 * não confirma nem nega, pela mensagem, que aquele id existe em outra
 * conta.
 */
export async function obterInfoEnvio(contexto: ContextoApi, shipmentId: string): Promise<InfoEnvio> {
  const envio = await prisma.shipment.findUnique({ where: { id: shipmentId } })
  if (!envio || envio.userId !== contexto.userId) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  return {
    id: envio.id,
    status: envio.status,
    tracking: envio.codigoRastreio,
    tracking_url: envio.codigoRastreio ? `/r/${envio.codigoRastreio}` : null,
    external_id: envio.referenciaExterna,
    price: (envio.precoFreteCentavos / 100).toFixed(2),
    label_fee: (envio.precoCobradoCentavos / 100).toFixed(2),
    charged: await houveCobranca(envio.id),
    sandbox: envio.sandbox,
    returned_at: envio.devolvidoEm?.toISOString() ?? null,
    created_at: envio.criadoEm.toISOString(),
  }
}

/**
 * Se a taxa deste envio saiu da carteira de fato.
 *
 * Consulta o `LedgerEntry`, e não a flag de sandbox nem o status: o livro-caixa
 * é a fonte de verdade sobre dinheiro, e derivar de qualquer outra coisa
 * criaria uma segunda versão da verdade que pode divergir dele. Sandbox não
 * gera lançamento, e um envio ainda `PENDING` também não — os dois respondem
 * falso pelo mesmo motivo, sem precisar de caso especial.
 */
async function houveCobranca(shipmentId: string): Promise<boolean> {
  const lancamentos = await prisma.ledgerEntry.count({
    where: { refTipo: 'SHIPMENT', refId: shipmentId, tipo: 'DEBITO' },
  })

  return lancamentos > 0
}

export type { AmbienteApiToken }

/* ===================== Histórico e entregas ===================== */

export type PassoHistorico = {
  status: string
  /** Código do catálogo de rastreio: `POSTADO`, `ENTREGUE`… */
  code: string
  title: string
  description: string
  city: string | null
  state: string | null
  occurred_at: string
}

export type HistoricoEnvio = {
  id: string
  status: string
  tracking: string | null
  external_id: string | null
  steps: PassoHistorico[]
}

/**
 * `GET /api/v0/order/history/:id` — tudo que já aconteceu com o envio.
 *
 * Existe para tirar da conta do integrador o trabalho de descobrir MUDANÇA por
 * repetição: sem isto, saber que algo andou exige consultar o estado atual de
 * novo e de novo, e essa consulta divide a mesma cota das chamadas que vendem.
 *
 * Devolve só o que JÁ ocorreu. A timeline é gravada inteira e datada na
 * emissão da etiqueta, então filtrar pelo relógio é o que impede a rota de
 * revelar ao comprador uma entrega que ainda não aconteceu.
 */
export async function obterHistorico(
  contexto: ContextoApi,
  shipmentId: string,
  agora = new Date(),
): Promise<HistoricoEnvio> {
  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      codigoRastreio: true,
      referenciaExterna: true,
    },
  })

  if (!envio || envio.userId !== contexto.userId) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  const passos = await prisma.trackingEvent.findMany({
    where: { shipmentId, ocorridoEm: { lte: agora } },
    orderBy: { ocorridoEm: 'asc' },
    select: {
      status: true,
      codigo: true,
      titulo: true,
      descricao: true,
      cidade: true,
      uf: true,
      ocorridoEm: true,
    },
  })

  return {
    id: envio.id,
    status: envio.status,
    tracking: envio.codigoRastreio,
    external_id: envio.referenciaExterna,
    steps: passos.map((p) => ({
      status: p.status,
      code: p.codigo,
      title: p.titulo,
      description: p.descricao,
      city: p.cidade || null,
      state: p.uf || null,
      occurred_at: p.ocorridoEm.toISOString(),
    })),
  }
}

export type EntregaWebhook = {
  event_id: string
  event: string
  status: 'entregue' | 'pendente' | 'desistiu'
  attempts: number
  http_status: number | null
  error: string | null
  created_at: string
  delivered_at: string | null
  payload: unknown
}

/**
 * `GET /api/v0/webhooks/deliveries` — o que tentamos entregar, e o que houve.
 *
 * É a rede de recuperação para quem ficou fora do ar além das seis tentativas:
 * sem ela, um evento perdido só é reconstruído varrendo pedido a pedido, e essa
 * varredura compete pela mesma cota das chamadas que vendem.
 *
 * O `payload` volta inteiro, exatamente como foi enviado — inclusive o
 * `event_id`, que é o que permite reprocessar sem duplicar o que já entrou.
 */
export async function listarEntregasWebhook(
  contexto: ContextoApi,
  filtro: { shipmentId?: string; desde?: Date; limite?: number },
): Promise<EntregaWebhook[]> {
  const limite = Math.min(Math.max(filtro.limite ?? 100, 1), 500)

  const entregas = await prisma.webhookDelivery.findMany({
    where: {
      // O dono do token, sempre. Nunca um id vindo do corpo.
      webhookApp: { userId: contexto.userId },
      ...(filtro.desde ? { criadoEm: { gte: filtro.desde } } : {}),
      /*
        O envio não é coluna da entrega: ele vive dentro do payload. Filtrar
        pelo JSON evita uma coluna nova só para consulta, e o volume por conta
        é pequeno o bastante para isso não pesar.
      */
      ...(filtro.shipmentId
        ? { payload: { path: ['data', 'id'], equals: filtro.shipmentId } }
        : {}),
    },
    orderBy: { criadoEm: 'desc' },
    take: limite,
  })

  return entregas.map((e) => ({
    event_id: e.id,
    event: e.evento,
    status: e.entregueEm ? 'entregue' : e.proximaTentativaEm ? 'pendente' : 'desistiu',
    attempts: e.tentativas,
    http_status: e.statusHttp,
    error: e.erro,
    created_at: e.criadoEm.toISOString(),
    delivered_at: e.entregueEm?.toISOString() ?? null,
    payload: e.payload,
  }))
}

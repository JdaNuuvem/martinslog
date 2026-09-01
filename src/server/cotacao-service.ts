import { prisma } from '@/infra/db/client'
import { cotar, EntradaCotacao, ItemCatalogo, ResultadoCotacao } from '@/domain/pricing/cotacao'
import { geoProvider as geoProviderPadrao, GeoProvider } from '@/infra/geo'
import { CotacaoExpiradaError, CepInvalidoError, CotacaoNaoEncontradaError } from '@/domain/errors'
import type { OpcaoCotacaoResposta } from '@/lib/cotacao-schema'

const VALIDADE_COTACAO_MS = 24 * 60 * 60 * 1000

export type FormatoEmbalagem = 'CAIXA' | 'ROLO' | 'ENVELOPE'

export type SolicitacaoCotacao = EntradaCotacao & {
  formato: FormatoEmbalagem
}

export type ContextoSessao = {
  userId: string | null
  anonSessionId: string | null
}

export type CotacaoPersistida = ResultadoCotacao & {
  quoteId: string
  anonSessionId: string | null
}

async function carregarCatalogo(): Promise<ItemCatalogo[]> {
  const servicos = await prisma.service.findMany({
    where: { ativo: true, carrier: { ativo: true } },
    include: {
      carrier: true,
      priceRules: {
        where: {
          ativo: true,
          vigenteDe: { lte: new Date() },
          OR: [{ vigenteAte: null }, { vigenteAte: { gte: new Date() } }],
        },
      },
    },
  })

  return servicos.map((servico) => ({
    servico: {
      id: servico.id,
      nome: servico.nome,
      carrierNome: servico.carrier.nome,
      limitePesoG: servico.limitePesoG,
    },
    regras: servico.priceRules.map((regra) => ({
      serviceId: regra.serviceId,
      cepOrigemIni: regra.cepOrigemIni,
      cepOrigemFim: regra.cepOrigemFim,
      cepDestinoIni: regra.cepDestinoIni,
      cepDestinoFim: regra.cepDestinoFim,
      pesoMinG: regra.pesoMinG,
      pesoMaxG: regra.pesoMaxG,
      precoBalcaoCentavos: regra.precoBalcaoCentavos,
      precoVendaCentavos: regra.precoVendaCentavos,
      prazoDias: regra.prazoDias,
    })),
  }))
}

/**
 * Garante uma AnonSession para o visitante sem login: reaproveita a existente
 * quando o id informado ainda existe no banco, ou cria uma nova.
 */
export async function garantirAnonSession(anonSessionIdAtual: string | null): Promise<string> {
  if (anonSessionIdAtual) {
    const existente = await prisma.anonSession.findUnique({ where: { id: anonSessionIdAtual } })
    if (existente) return existente.id
  }

  const nova = await prisma.anonSession.create({ data: {} })
  return nova.id
}

/**
 * Confere se os dois CEPs existem de fato, antes de o cliente montar o envio
 * inteiro em cima de um preço para um CEP inexistente.
 *
 * Resolve os dois em paralelo — cada consulta ao provedor custa ~2,5s em
 * cache frio, e somá-las em sequência penalizaria a rota mais quente do
 * produto. Usa `Promise.allSettled` (não `Promise.all`) para não deixar o
 * resultado depender de qual chamada rejeita primeiro: com `allSettled` os
 * dois desfechos ficam disponíveis e a decisão é explícita — qualquer CEP
 * inexistente (`CepInvalidoError`) recusa a cotação, mesmo que o outro CEP
 * tenha vindo de um provedor fora do ar.
 *
 * Indisponibilidade do provedor (`ServicoIndisponivelError` ou qualquer erro
 * que não seja `CepInvalidoError`) nunca bloqueia a cotação — apenas pula a
 * validação para aquele CEP e registra a causa em log estruturado.
 */
async function validarExistenciaCeps(
  cepOrigem: string,
  cepDestino: string,
  provider: GeoProvider,
): Promise<void> {
  const [resultadoOrigem, resultadoDestino] = await Promise.allSettled([
    provider.buscarPorCep(cepOrigem),
    provider.buscarPorCep(cepDestino),
  ])

  if (resultadoOrigem.status === 'rejected' && resultadoOrigem.reason instanceof CepInvalidoError) {
    throw new CepInvalidoError(`O CEP de origem informado não foi encontrado: ${cepOrigem}.`)
  }
  if (resultadoDestino.status === 'rejected' && resultadoDestino.reason instanceof CepInvalidoError) {
    throw new CepInvalidoError(`O CEP de destino informado não foi encontrado: ${cepDestino}.`)
  }

  if (resultadoOrigem.status === 'rejected') {
    console.warn('Validação de existência do CEP de origem pulada: provedor indisponível', {
      cep: cepOrigem,
      causa: resultadoOrigem.reason,
    })
  }
  if (resultadoDestino.status === 'rejected') {
    console.warn('Validação de existência do CEP de destino pulada: provedor indisponível', {
      cep: cepDestino,
      causa: resultadoDestino.reason,
    })
  }
}

export async function gerarCotacao(
  solicitacao: SolicitacaoCotacao,
  contexto: ContextoSessao,
  geoProvider: GeoProvider = geoProviderPadrao,
): Promise<CotacaoPersistida> {
  await validarExistenciaCeps(solicitacao.cepOrigem, solicitacao.cepDestino, geoProvider)

  const catalogo = await carregarCatalogo()
  const resultado = cotar(solicitacao, catalogo)

  let anonSessionId: string | null = null
  if (!contexto.userId) {
    anonSessionId = await garantirAnonSession(contexto.anonSessionId)
  }

  const quote = await prisma.quote.create({
    data: {
      userId: contexto.userId,
      anonSessionId,
      cepOrigem: solicitacao.cepOrigem,
      cepDestino: solicitacao.cepDestino,
      formato: solicitacao.formato,
      pesoG: solicitacao.pesoRealG,
      altura: solicitacao.alturaCm,
      largura: solicitacao.larguraCm,
      comprimento: solicitacao.comprimentoCm,
      pesoCubadoG: resultado.pesoCubadoG,
      pesoTaxavelG: resultado.pesoTaxavelG,
      opcionais: {},
      opcoes: resultado.opcoes,
      expiraEm: new Date(Date.now() + VALIDADE_COTACAO_MS),
    },
  })

  return { ...resultado, quoteId: quote.id, anonSessionId }
}

export type CotacaoSalva = {
  quoteId: string
  cepOrigem: string
  cepDestino: string
  formato: FormatoEmbalagem
  pesoG: number
  alturaCm: number
  larguraCm: number
  comprimentoCm: number
  opcoes: OpcaoCotacaoResposta[]
}

/**
 * Relê uma cotação já gerada, para quem chega ao wizard com o `quoteId` na
 * URL (cotou na home antes de entrar). Sem isso, as etapas seguintes não
 * sabem nem qual CEP foi cotado.
 *
 * Só devolve a cotação de quem a criou: a do usuário logado, ou — para quem
 * cotou como visitante e depois criou conta — a da sessão anônima que ainda
 * está no cookie. Um `quoteId` de terceiro responde como inexistente, e não
 * como proibido, para não confirmar que o id existe.
 */
export async function obterCotacao(
  quoteId: string,
  contexto: ContextoSessao,
): Promise<CotacaoSalva> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } })

  const dono =
    (contexto.userId !== null && quote?.userId === contexto.userId) ||
    (contexto.anonSessionId !== null && quote?.anonSessionId === contexto.anonSessionId)

  if (!quote || !dono) {
    throw new CotacaoNaoEncontradaError(`Cotação não encontrada: ${quoteId}`)
  }

  if (quote.expiraEm.getTime() <= Date.now()) {
    throw new CotacaoExpiradaError('Esta cotação expirou. Faça uma nova.')
  }

  return {
    quoteId: quote.id,
    cepOrigem: quote.cepOrigem,
    cepDestino: quote.cepDestino,
    formato: quote.formato as FormatoEmbalagem,
    pesoG: quote.pesoG,
    alturaCm: quote.altura,
    larguraCm: quote.largura,
    comprimentoCm: quote.comprimento,
    // `opcoes` é o JSON gravado na geração — a mesma lista que o cliente já
    // viu, sem recalcular preço aqui.
    opcoes: quote.opcoes as unknown as OpcaoCotacaoResposta[],
  }
}

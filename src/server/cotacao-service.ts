import { prisma } from '@/infra/db/client'
import { cotar, EntradaCotacao, ItemCatalogo, ResultadoCotacao } from '@/domain/pricing/cotacao'

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

export async function gerarCotacao(
  solicitacao: SolicitacaoCotacao,
  contexto: ContextoSessao,
): Promise<CotacaoPersistida> {
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

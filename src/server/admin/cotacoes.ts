import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import type { OpcaoCotacao } from '@/domain/pricing/cotacao'

/**
 * Listagem administrativa de cotações (`Quote`).
 *
 * Existe para responder "por que o cliente viu R$ 32 e agora vê R$ 41":
 * `Quote.opcoes` é o JSON congelado no instante da cotação — a única prova
 * do que foi de fato mostrado ao cliente, já que `PriceRule` muda com o
 * tempo e não guarda histórico. Por isso a leitura devolve o JSON quase
 * como está gravado, e não recalcula preço nenhum.
 *
 * Só leitura, pelo mesmo motivo de `usuarios.ts`: um módulo que sabidamente
 * não escreve é fácil de auditar.
 */

export type OpcaoCotacaoResumo = {
  servicoId: string
  servicoNome: string
  carrierNome: string
  disponivel: boolean
  observacao: string | null
  precoBalcaoCentavos: number
  precoFinalCentavos: number
  descontoCentavos: number
  descontoPercentual: number
  prazoDias: number
}

export type DonoCotacao =
  | { tipo: 'USUARIO'; id: string; nome: string; email: string }
  | { tipo: 'ANONIMO'; id: string }

export type CotacaoResumo = {
  id: string
  criadoEm: Date
  expiraEm: Date
  expirada: boolean
  cepOrigem: string
  cepDestino: string
  formato: string
  pesoG: number
  pesoCubadoG: number
  pesoTaxavelG: number
  altura: number
  largura: number
  comprimento: number
  opcoes: OpcaoCotacaoResumo[]
  dono: DonoCotacao
  shipmentId: string | null
  virouEnvio: boolean
}

export type FiltroCotacoes = {
  cep?: string
  de?: Date
  ate?: Date
  virouEnvio?: 'SIM' | 'NAO'
  pagina?: number
}

export type ListaCotacoes = {
  itens: CotacaoResumo[]
  pagina: number
  total: number
  totalPaginas: number
}

export const TAMANHO_PAGINA = 30

function montarWhere(filtro: FiltroCotacoes): Prisma.QuoteWhereInput {
  // Sem remover o hífen: o CEP é gravado como "01310-100", e um termo sem
  // hífen ("01310100") nunca seria substring disso. Quem busca digita o
  // prefixo com ou sem hífen — "01310" casa com os dois formatos.
  const cep = (filtro.cep ?? '').trim()

  return {
    ...(cep ? { OR: [{ cepOrigem: { contains: cep } }, { cepDestino: { contains: cep } }] } : {}),
    ...(filtro.de || filtro.ate
      ? {
          criadoEm: {
            ...(filtro.de ? { gte: filtro.de } : {}),
            ...(filtro.ate ? { lte: filtro.ate } : {}),
          },
        }
      : {}),
    ...(filtro.virouEnvio === 'SIM' ? { shipments: { some: {} } } : {}),
    ...(filtro.virouEnvio === 'NAO' ? { shipments: { none: {} } } : {}),
  }
}

/**
 * Lista cotações, mais recentes primeiro — incluindo as anônimas
 * (`AnonSession`), que são a maior parte do funil e é onde se perde venda
 * sem que apareça em nenhuma outra tela do painel.
 */
export async function listarCotacoes(filtro: FiltroCotacoes = {}): Promise<ListaCotacoes> {
  const pagina = Math.max(1, filtro.pagina ?? 1)
  const where = montarWhere(filtro)
  const agora = new Date()

  const [linhas, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      skip: (pagina - 1) * TAMANHO_PAGINA,
      take: TAMANHO_PAGINA,
      select: {
        id: true,
        criadoEm: true,
        expiraEm: true,
        cepOrigem: true,
        cepDestino: true,
        formato: true,
        pesoG: true,
        pesoCubadoG: true,
        pesoTaxavelG: true,
        altura: true,
        largura: true,
        comprimento: true,
        opcoes: true,
        userId: true,
        anonSessionId: true,
        user: { select: { id: true, nome: true, email: true } },
        shipments: { select: { id: true }, take: 1 },
      },
    }),
    prisma.quote.count({ where }),
  ])

  const itens: CotacaoResumo[] = linhas.map((linha) => {
    const dono: DonoCotacao = linha.user
      ? { tipo: 'USUARIO', id: linha.user.id, nome: linha.user.nome, email: linha.user.email }
      : { tipo: 'ANONIMO', id: linha.anonSessionId ?? '—' }

    return {
      id: linha.id,
      criadoEm: linha.criadoEm,
      expiraEm: linha.expiraEm,
      expirada: linha.expiraEm.getTime() <= agora.getTime(),
      cepOrigem: linha.cepOrigem,
      cepDestino: linha.cepDestino,
      formato: linha.formato,
      pesoG: linha.pesoG,
      pesoCubadoG: linha.pesoCubadoG,
      pesoTaxavelG: linha.pesoTaxavelG,
      altura: linha.altura,
      largura: linha.largura,
      comprimento: linha.comprimento,
      opcoes: (linha.opcoes as unknown as OpcaoCotacao[]) ?? [],
      dono,
      shipmentId: linha.shipments[0]?.id ?? null,
      virouEnvio: linha.shipments.length > 0,
    }
  })

  return {
    itens,
    pagina,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA)),
  }
}

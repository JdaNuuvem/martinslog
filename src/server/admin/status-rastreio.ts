import { Prisma, type StatusRastreio } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import {
  CODIGOS_PADRAO,
  normalizarCodigoStatus,
  resolverCatalogo,
  validarStatusCustomizado,
  type CatalogoResolvido,
  type LinhaStatus,
} from '@/domain/rastreio/catalogo-status'
import { gerarRoteiro, textoPadrao } from '@/domain/simulacao/roteiro'
import type { CenarioSimulacao } from '@/domain/simulacao/tipos'
import type { StatusShipment } from '@/domain/shipment/estados'

/**
 * Catálogo **padrão da plataforma** (`StatusRastreio` com `userId` nulo).
 *
 * É o que vale para toda conta que nunca personalizou nada — a maioria. O
 * catálogo de cada cliente continua em `status-rastreio-service.ts`; este
 * módulo é o de cima, e por isso toda escrita aqui grava `AuditLog`: mudar um
 * texto ou a posição de uma etapa muda o que milhares de destinatários leem.
 *
 * As duas formas de posicionar uma etapa convivem:
 *
 * - **Fração do prazo** (o padrão histórico): a etapa cai em 0,25 · P, onde P
 *   é o prazo do serviço. Serviço expresso anda mais rápido que o econômico,
 *   como no transporte real.
 * - **Dias após a emissão**: número absoluto, igual para todo serviço. É o
 *   "muda de status a cada X dias" — previsível de explicar, e o que a
 *   operação pede quando quer demonstrar sem depender do serviço contratado.
 */

/**
 * Posição de cada código na cadência fixa, em múltiplos de X.
 *
 * Cobre **todos** os códigos do motor, e não só o caminho feliz. A primeira
 * versão parava na entrega e deixava extravio, tentativa frustrada e
 * devolução nas frações do prazo — o que produzia timeline impossível assim
 * que a cadência passava do prazo de algum serviço: num serviço de 1 dia com
 * cadência de 2, o extravio (1,5 · P) caía antes da postagem (dia 2), e a
 * máquina de estados recusa ir de GENERATED direto para LOST.
 *
 * Os múltiplos foram escolhidos para que **toda** ordem de cenário continue
 * legítima: cada código exclusivo de cenário vem depois das etapas que
 * necessariamente o precedem, e nenhum deles compete com um código de outro
 * cenário — extravio e entrega, por exemplo, nunca aparecem juntos.
 */
const CADENCIA_POSICOES: readonly (readonly [string, number])[] = [
  ['ETIQUETA_EMITIDA', 0],
  ['POSTADO', 1],
  ['TRANSFERENCIA', 2],
  ['AGUARDANDO_TRATAMENTO', 3],
  ['SAIU_PARA_ENTREGA', 4],
  ['EXTRAVIADO', 5],
  ['TENTATIVA_FRUSTRADA', 5],
  ['AGUARDANDO_RETIRADA', 6],
  ['ENTREGUE', 7],
  ['DEVOLUCAO_INICIADA', 7],
  ['DEVOLVIDO', 8],
]

const CADENCIA_ORDEM = CADENCIA_POSICOES.map(([codigo]) => codigo)

/** Teto da cadência: acima disso a timeline sai do horizonte de qualquer teste. */
const CADENCIA_DIAS_MAXIMO = 90

const TODOS_CENARIOS: readonly CenarioSimulacao[] = [
  'ENTREGA_NORMAL',
  'ATRASO',
  'TENTATIVA_FALHA',
  'EXTRAVIO',
  'DEVOLUCAO',
]

export type EntradaStatusPadrao = {
  nome: string
  titulo: string
  descricao: string
  cenario?: CenarioSimulacao | null
  fracaoPrazo?: number | null
  diasAposEmissao?: number | null
  statusResultante?: StatusShipment | null
  ativo?: boolean
}

function paraLinha(registro: StatusRastreio): LinhaStatus {
  return {
    codigo: registro.codigo,
    titulo: registro.titulo,
    descricao: registro.descricao,
    cenario: (registro.cenario as CenarioSimulacao | null) ?? null,
    fracaoPrazo: registro.fracaoPrazo,
    diasAposEmissao: registro.diasAposEmissao,
    statusResultante: (registro.statusResultante as StatusShipment | null) ?? null,
    ativo: registro.ativo,
  }
}

/** Lista o catálogo padrão inteiro, códigos do motor primeiro. */
export async function listarCatalogoPadrao(): Promise<StatusRastreio[]> {
  const linhas = await prisma.statusRastreio.findMany({
    where: { userId: null },
    orderBy: [{ diasAposEmissao: 'asc' }, { fracaoPrazo: 'asc' }, { codigo: 'asc' }],
  })

  const ehPadrao = (codigo: string) => (CODIGOS_PADRAO as readonly string[]).includes(codigo)

  return [...linhas.filter((l) => ehPadrao(l.codigo)), ...linhas.filter((l) => !ehPadrao(l.codigo))]
}

async function catalogoPadraoResolvido(
  cliente: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CatalogoResolvido> {
  const padrao = await cliente.statusRastreio.findMany({ where: { userId: null } })
  return resolverCatalogo(padrao.map(paraLinha), [])
}

/**
 * Gera uma prévia do roteiro em todos os cenários e deixa `gerarRoteiro`
 * reprovar o que quebraria a máquina de estados.
 *
 * Usa dois prazos de serviço — o mais curto e o mais longo em uso — porque a
 * validade de uma posição em dias **depende do prazo**: "postado no dia 3"
 * é legítimo num serviço de 5 dias e impossível num de 2, onde a entrega já
 * aconteceu. Reprovar aqui evita que a etiqueta do cliente do serviço curto
 * falhe na emissão, horas depois, longe de quem configurou.
 */
async function conferirPrevia(catalogo: CatalogoResolvido): Promise<void> {
  const prazos = await prisma.service.findMany({
    where: { ativo: true },
    select: { prazoBase: true },
  })

  const valores = prazos.map((p) => p.prazoBase).filter((p) => p > 0)
  const aTestar = valores.length > 0 ? [Math.min(...valores), Math.max(...valores)] : [5]

  for (const prazoDias of new Set(aTestar)) {
    for (const cenario of TODOS_CENARIOS) {
      try {
        gerarRoteiro({
          cenario,
          prazoDias,
          origem: { cidade: 'São Paulo', uf: 'SP' },
          destino: { cidade: 'Rio de Janeiro', uf: 'RJ' },
          textos: catalogo.textos,
          etapasExtras: catalogo.etapasExtras,
          posicoesDias: catalogo.posicoesDias,
        })
      } catch (error) {
        throw new ValorInvalidoError(
          `Esta configuração produz uma linha do tempo inválida no cenário ${cenario} ` +
            `para o serviço de ${prazoDias} dias. Uma etapa está caindo depois da entrega.`,
          { cause: error },
        )
      }
    }
  }
}

async function registrarAuditoria(
  actorUserId: string,
  acao: string,
  entidadeId: string,
  antes: Prisma.InputJsonValue | typeof Prisma.JsonNull,
  depois: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { actorUserId, acao, entidade: 'StatusRastreio', entidadeId, antes, depois },
  })
}

function instantaneo(registro: StatusRastreio): Prisma.InputJsonValue {
  return {
    codigo: registro.codigo,
    titulo: registro.titulo,
    descricao: registro.descricao,
    cenario: registro.cenario,
    fracaoPrazo: registro.fracaoPrazo,
    diasAposEmissao: registro.diasAposEmissao,
    statusResultante: registro.statusResultante,
    ativo: registro.ativo,
  } as Prisma.InputJsonValue
}

/**
 * Cria ou atualiza uma linha do catálogo padrão.
 *
 * O código vem do nome e é a chave: salvar de novo com o mesmo nome edita a
 * linha existente. Para um código que o motor já gera, isso é reescrever o
 * texto e/ou mover a etapa; para um código novo, é criar uma etapa extra que
 * passa a valer para todas as contas.
 *
 * A prévia roda **depois** de gravar e desfaz em caso de erro, e não antes,
 * para que a validação enxergue o catálogo exatamente como ele ficaria — uma
 * simulação em memória divergiria do que outra escrita concorrente deixou no
 * banco.
 */
export async function salvarStatusPadrao(
  actorUserId: string,
  entrada: EntradaStatusPadrao,
): Promise<StatusRastreio> {
  const codigo = normalizarCodigoStatus(entrada.nome)

  if (!entrada.titulo.trim() || !entrada.descricao.trim()) {
    throw new ValorInvalidoError('Título e descrição são obrigatórios.')
  }

  const campos = {
    titulo: entrada.titulo.trim(),
    descricao: entrada.descricao.trim(),
    cenario: entrada.cenario ?? null,
    fracaoPrazo: entrada.fracaoPrazo ?? null,
    diasAposEmissao: entrada.diasAposEmissao ?? null,
    statusResultante: entrada.statusResultante ?? null,
    ativo: entrada.ativo ?? true,
  }

  validarStatusCustomizado({ codigo, ...campos })

  // Busca e escrita separadas, e não `upsert`, porque a unicidade do código
  // no catálogo padrão é um índice **parcial** (`WHERE userId IS NULL`), que
  // o Prisma não representa como chave composta.
  const existente = await prisma.statusRastreio.findFirst({ where: { userId: null, codigo } })

  const salvo = existente
    ? await prisma.statusRastreio.update({ where: { id: existente.id }, data: campos })
    : await prisma.statusRastreio.create({ data: { userId: null, codigo, ...campos } })

  try {
    await conferirPrevia(await catalogoPadraoResolvido())
  } catch (error) {
    if (existente) {
      await prisma.statusRastreio
        .update({ where: { id: existente.id }, data: { ...existente } })
        .catch(() => undefined)
    } else {
      await prisma.statusRastreio.delete({ where: { id: salvo.id } }).catch(() => undefined)
    }
    throw error
  }

  await registrarAuditoria(
    actorUserId,
    existente ? 'STATUS_PADRAO_ATUALIZADO' : 'STATUS_PADRAO_CRIADO',
    salvo.id,
    existente ? instantaneo(existente) : Prisma.JsonNull,
    instantaneo(salvo),
  )

  return salvo
}

/**
 * Remove uma linha do catálogo padrão.
 *
 * Um código do motor volta ao texto embutido em `roteiro.ts` e à posição por
 * fração; uma etapa criada aqui deixa de existir para envios novos. Envios já
 * emitidos não mudam: a timeline deles foi materializada na emissão.
 */
export async function removerStatusPadrao(actorUserId: string, id: string): Promise<void> {
  const existente = await prisma.statusRastreio.findFirst({ where: { id, userId: null } })

  if (!existente) {
    throw new ValorInvalidoError(`Status padrão não encontrado: ${id}`)
  }

  await prisma.statusRastreio.delete({ where: { id } })

  await registrarAuditoria(
    actorUserId,
    'STATUS_PADRAO_REMOVIDO',
    id,
    instantaneo(existente),
    { removido: true } as Prisma.InputJsonValue,
  )
}

export type ResultadoCadencia = { dias: number; codigos: string[] }

/**
 * Aplica a cadência fixa: cada etapa do fluxo principal a cada X dias.
 *
 * Escreve `diasAposEmissao` nas linhas padrão dos códigos de
 * `CADENCIA_ORDEM`, na ordem do fluxo — emissão no dia 0, postagem no dia X,
 * e assim por diante. Os códigos exclusivos de cenário (tentativa frustrada,
 * extravio, devolução) **não são tocados**: eles continuam por fração do
 * prazo, porque a cadência descreve o caminho feliz e forçá-los na mesma
 * régua produziria uma devolução antes da tentativa que a causou.
 *
 * `dias = 0` limpa a cadência e devolve todo o fluxo às frações do prazo — é
 * como desfazer, e não como "tudo no mesmo instante".
 */
export async function definirCadenciaDias(
  actorUserId: string,
  dias: number,
): Promise<ResultadoCadencia> {
  if (!Number.isFinite(dias) || dias < 0 || dias > CADENCIA_DIAS_MAXIMO) {
    throw new ValorInvalidoError(
      `A cadência deve estar entre 0 e ${CADENCIA_DIAS_MAXIMO} dias, recebida: ${dias}`,
    )
  }

  const antes = await listarCatalogoPadrao()

  await prisma.$transaction(async (tx) => {
    for (const [codigo, multiplicador] of CADENCIA_POSICOES) {
      const existente = await tx.statusRastreio.findFirst({ where: { userId: null, codigo } })
      const diasAposEmissao = dias === 0 ? null : multiplicador * dias

      if (existente) {
        await tx.statusRastreio.update({ where: { id: existente.id }, data: { diasAposEmissao } })
        continue
      }

      if (diasAposEmissao === null) {
        continue
      }

      // Linha ainda inexistente: nasce só com a posição. Título e descrição
      // são obrigatórios na tabela, então copiam o texto que o motor já
      // usaria — mover uma etapa não é ocasião para mudar o que o cliente lê.
      const texto = textoPadrao(codigo)
      await tx.statusRastreio.create({
        data: {
          userId: null,
          codigo,
          titulo: texto?.titulo ?? codigo,
          descricao: texto?.descricao ?? codigo,
          diasAposEmissao,
        },
      })
    }
  })

  try {
    await conferirPrevia(await catalogoPadraoResolvido())
  } catch (error) {
    // Desfaz por completo: a cadência é uma operação só, e deixá-la pela
    // metade produziria uma timeline meio nova, meio velha.
    await prisma.$transaction(async (tx) => {
      for (const linha of antes) {
        await tx.statusRastreio
          .update({ where: { id: linha.id }, data: { diasAposEmissao: linha.diasAposEmissao } })
          .catch(() => undefined)
      }
      await tx.statusRastreio.deleteMany({
        where: {
          userId: null,
          codigo: { in: [...CADENCIA_ORDEM] },
          id: { notIn: antes.map((l) => l.id) },
        },
      })
    })
    throw error
  }

  await registrarAuditoria(
    actorUserId,
    'STATUS_PADRAO_CADENCIA',
    'catalogo-padrao',
    { posicoes: antes.map((l) => ({ codigo: l.codigo, dias: l.diasAposEmissao })) } as Prisma.InputJsonValue,
    { dias, codigos: [...CADENCIA_ORDEM] } as Prisma.InputJsonValue,
  )

  return { dias, codigos: [...CADENCIA_ORDEM] }
}

export { CODIGOS_PADRAO }

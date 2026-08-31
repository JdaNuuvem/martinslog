import type { Prisma } from '@prisma/client'
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
import { gerarRoteiro } from '@/domain/simulacao/roteiro'
import type { CenarioSimulacao } from '@/domain/simulacao/tipos'
import type { StatusShipment } from '@/domain/shipment/estados'

/**
 * Catálogo de status de rastreio de cada conta.
 *
 * O painel escreve aqui; o motor de simulação lê daqui na emissão da
 * etiqueta, via `catalogoDoUsuario`.
 */

export type EntradaStatus = {
  nome: string
  titulo: string
  descricao: string
  cenario?: CenarioSimulacao | null
  fracaoPrazo?: number | null
  statusResultante?: StatusShipment | null
  ativo?: boolean
}

function paraLinha(registro: {
  codigo: string
  titulo: string
  descricao: string
  cenario: string | null
  fracaoPrazo: number | null
  statusResultante: string | null
  ativo: boolean
}): LinhaStatus {
  return {
    codigo: registro.codigo,
    titulo: registro.titulo,
    descricao: registro.descricao,
    cenario: (registro.cenario as CenarioSimulacao | null) ?? null,
    fracaoPrazo: registro.fracaoPrazo,
    statusResultante: (registro.statusResultante as StatusShipment | null) ?? null,
    ativo: registro.ativo,
  }
}

/** Lista o que a conta personalizou, mais recente primeiro. */
export async function listarStatusDaConta(userId: string) {
  return prisma.statusRastreio.findMany({
    where: { userId },
    orderBy: [{ fracaoPrazo: 'asc' }, { criadoEm: 'desc' }],
  })
}

/** Lista o catálogo padrão da plataforma, que serve de base para todos. */
export async function listarStatusPadrao() {
  return prisma.statusRastreio.findMany({
    where: { userId: null },
    orderBy: { codigo: 'asc' },
  })
}

/**
 * Resolve o catálogo aplicável a uma conta: o padrão da plataforma coberto
 * pelas linhas dela. É o que a emissão passa para `gerarRoteiro`.
 *
 * Aceita um cliente de transação para que a emissão leia o catálogo dentro
 * da própria transação: se a leitura falhar, a emissão aborta inteira e o
 * envio fica em `RELEASED` retentável. Melhor não emitir do que emitir com a
 * timeline errada — ela é imutável depois de gravada.
 */
export async function catalogoDoUsuario(
  userId: string,
  cliente: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CatalogoResolvido> {
  const [padrao, daConta] = await Promise.all([
    cliente.statusRastreio.findMany({ where: { userId: null } }),
    cliente.statusRastreio.findMany({ where: { userId } }),
  ])

  return resolverCatalogo(padrao.map(paraLinha), daConta.map(paraLinha))
}

/**
 * Gera uma prévia do roteiro em cada cenário afetado e deixa
 * `validarRoteiro` (dentro de `gerarRoteiro`) reprovar o que quebraria a
 * máquina de estados.
 *
 * Existe para o erro aparecer na tela de quem configurou, e não no meio de
 * uma emissão de etiqueta horas depois. Não substitui a validação da
 * geração: aquela é a barreira real.
 */
async function conferirPreviaDoRoteiro(userId: string, catalogo: CatalogoResolvido): Promise<void> {
  const cenarios = new Set(catalogo.etapasExtras.map((e) => e.cenario))

  for (const cenario of cenarios) {
    try {
      gerarRoteiro({
        cenario,
        prazoDias: 5,
        origem: { cidade: 'São Paulo', uf: 'SP' },
        destino: { cidade: 'Rio de Janeiro', uf: 'RJ' },
        textos: catalogo.textos,
        etapasExtras: catalogo.etapasExtras,
      })
    } catch (error) {
      throw new ValorInvalidoError(
        `Esta configuração produz uma linha do tempo inválida no cenário ${cenario}. ` +
          `Verifique a posição do status: ele pode estar caindo depois da entrega.`,
        { cause: error },
      )
    }
  }
}

/**
 * Cria ou atualiza um status da conta.
 *
 * O código é derivado do nome, e é a chave de sobreposição: salvar de novo
 * com o mesmo nome edita a linha existente em vez de criar uma duplicata.
 * Personalizar a copy de um código padrão é apenas informar o mesmo nome
 * dele com título e descrição novos.
 */
export async function salvarStatus(userId: string, entrada: EntradaStatus) {
  const codigo = normalizarCodigoStatus(entrada.nome)

  if (!entrada.titulo.trim() || !entrada.descricao.trim()) {
    throw new ValorInvalidoError('Título e descrição são obrigatórios.')
  }

  const cenario = entrada.cenario ?? null
  const fracaoPrazo = entrada.fracaoPrazo ?? null
  const statusResultante = entrada.statusResultante ?? null

  validarStatusCustomizado({ codigo, cenario, fracaoPrazo, statusResultante })

  const campos = {
    titulo: entrada.titulo.trim(),
    descricao: entrada.descricao.trim(),
    cenario,
    fracaoPrazo,
    statusResultante,
    ativo: entrada.ativo ?? true,
  }

  // Busca e escrita separadas, e não `upsert`, porque a unicidade de
  // (userId, codigo) é um índice **parcial** no banco — necessário para o
  // catálogo padrão, onde userId é nulo e NULL nunca é igual a NULL no
  // Postgres. O Prisma não representa índice parcial, então não existe a
  // chave composta que o upsert exigiria.
  const existente = await prisma.statusRastreio.findFirst({ where: { userId, codigo } })

  const salvo = existente
    ? await prisma.statusRastreio.update({ where: { id: existente.id }, data: campos })
    : await prisma.statusRastreio.create({ data: { userId, codigo, ...campos } })

  // Confere depois de gravar, dentro do mesmo pedido: se a combinação
  // quebrar a linha do tempo, desfaz e devolve erro explicável.
  try {
    await conferirPreviaDoRoteiro(userId, await catalogoDoUsuario(userId))
  } catch (error) {
    // Volta ao estado anterior: restaura a linha antiga se havia uma, ou
    // apaga a que acabou de nascer.
    if (existente) {
      await prisma.statusRastreio
        .update({
          where: { id: existente.id },
          data: {
            titulo: existente.titulo,
            descricao: existente.descricao,
            cenario: existente.cenario,
            fracaoPrazo: existente.fracaoPrazo,
            statusResultante: existente.statusResultante,
            ativo: existente.ativo,
          },
        })
        .catch(() => undefined)
    } else {
      await prisma.statusRastreio.delete({ where: { id: salvo.id } }).catch(() => undefined)
    }
    throw error
  }

  return salvo
}

/**
 * Remove uma personalização da conta. O código volta ao texto padrão da
 * plataforma — nunca some da timeline.
 */
export async function removerStatus(userId: string, id: string): Promise<void> {
  const removidos = await prisma.statusRastreio.deleteMany({ where: { id, userId } })

  if (removidos.count === 0) {
    throw new ValorInvalidoError(`Status não encontrado: ${id}`)
  }
}

/**
 * Mapa código→status de envio das etapas criadas pela conta.
 *
 * É o que os pontos de **leitura** precisam para traduzir um evento
 * customizado: `sincronizarEnvio`, a consulta de rastreio e a listagem de
 * envios recebem este mapa e passam a saber que `EM_CONFERENCIA` significa
 * `POSTED`. Sem ele, o evento aparece na timeline com o texto certo, mas o
 * status do envio para ali — limitação silenciosa, não quebra.
 *
 * Só inclui as etapas ativas que entram no roteiro. Uma linha que apenas
 * reescreve a copy de um código padrão não precisa de tradução: o código
 * continua sendo um dos que o motor já conhece.
 */
export async function obterStatusPorCodigo(
  userId: string,
  cliente: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Record<string, StatusShipment>> {
  // Inclui linhas **desativadas** de propósito, ao contrário de
  // `catalogoDoUsuario`. Os dois usos são opostos: aquele monta roteiros
  // novos, onde uma etapa desligada não deve mais entrar; este traduz
  // eventos que já existem, e envios emitidos antes de a etapa ser desligada
  // continuam com ela na timeline. Filtrar aqui deixaria esses envios sem
  // tradução e travaria o avanço do status deles.
  const linhas = await cliente.statusRastreio.findMany({
    where: { userId, statusResultante: { not: null } },
    select: { codigo: true, statusResultante: true },
  })

  const mapa: Record<string, StatusShipment> = {}
  for (const linha of linhas) {
    if (linha.statusResultante) {
      mapa[linha.codigo] = linha.statusResultante as StatusShipment
    }
  }

  return mapa
}

/** Códigos do roteiro padrão, para a tela oferecer a lista de personalizáveis. */
export { CODIGOS_PADRAO }

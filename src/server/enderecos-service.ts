import type { Prisma, TipoEndereco } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import {
  DocumentoInvalidoError,
  EnderecoNaoEncontradoError,
} from '@/domain/errors'
import { normalizarCep } from '@/domain/pricing/cep'
import { normalizarDocumento, validarCnpj, validarCpf } from '@/domain/auth/documento'
import { geoProvider } from '@/infra/geo'
import type { EnderecoRequest } from '@/lib/endereco-schema'

/**
 * Lista os endereços não arquivados do usuário, mais recentes primeiro. O
 * cliente separa em Remetentes/Destinatários pelo campo `tipo`.
 */
export async function listarEnderecos(userId: string) {
  return prisma.address.findMany({
    where: { userId, arquivadoEm: null },
    orderBy: { criadoEm: 'desc' },
  })
}

/**
 * Busca um endereço garantindo que pertence a `userId`. Endereço inexistente
 * OU pertencente a outro usuário resultam no mesmo erro — o chamador nunca
 * consegue distinguir "não existe" de "não é seu", o que evita vazar a
 * existência de registros alheios.
 */
export async function buscarEnderecoDoUsuario(userId: string, id: string) {
  const endereco = await prisma.address.findFirst({
    where: { id, userId, arquivadoEm: null },
  })

  if (!endereco) {
    throw new EnderecoNaoEncontradoError(`Endereço não encontrado: ${id}`)
  }

  return endereco
}

function validarDocumentoSeNecessario(tipo: TipoEndereco, documento?: string): string | undefined {
  if (tipo !== 'DESTINATARIO' || !documento) {
    return undefined
  }

  const normalizado = normalizarDocumento(documento)
  const valido =
    normalizado.length === 11
      ? validarCpf(normalizado)
      : normalizado.length === 14
        ? validarCnpj(normalizado)
        : false

  if (!valido) {
    throw new DocumentoInvalidoError('Documento do destinatário inválido.')
  }

  return normalizado
}

/**
 * Serializa, por `(userId, tipo)`, as transações que mexem no endereço
 * padrão. Sem isso, duas requisições concorrentes de criação/edição com
 * `padrao: true` podem rodar seus `updateMany` de "desmarcar o padrão
 * anterior" antes de qualquer uma das duas ter commitado — nenhuma enxerga
 * o padrão da outra, e as duas terminam marcadas como padrão. Isolamento de
 * transação garante leitura consistente dentro de cada transação, mas não
 * impede duas transações concorrentes de produzirem, juntas, um estado
 * inválido — é exatamente o cenário do teste de corrida abaixo.
 *
 * `pg_advisory_xact_lock` foi escolhido em vez de "tentar e recapturar
 * P2002": ele faz a segunda requisição *esperar* a primeira terminar (sem
 * erro nenhum pro usuário) e então enxergar o padrão já commitado — em vez
 * de falhar e precisar de lógica de retry. O lock é liberado sozinho ao fim
 * da transação (é `_xact_`), então não há risco de vazar lock em caso de
 * exceção. `hashtext` reduz a chave textual a um inteiro de 32 bits — a
 * pequena chance de colisão de hash entre dois pares (userId, tipo)
 * diferentes só causaria uma serialização a mais do necessário, nunca uma
 * violação da invariante (o índice único parcial no banco continua sendo a
 * garantia final).
 */
async function travarPadraoDoTipo(
  tx: Prisma.TransactionClient,
  userId: string,
  tipo: TipoEndereco,
): Promise<void> {
  const chave = `${userId}:${tipo}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`
}

function paraCampos(dados: EnderecoRequest, cep: string, documento: string | undefined) {
  return {
    tipo: dados.tipo,
    apelido: dados.apelido || null,
    cep,
    logradouro: dados.logradouro,
    numero: dados.numero,
    complemento: dados.complemento || null,
    bairro: dados.bairro,
    cidade: dados.cidade,
    uf: dados.uf.toUpperCase(),
    padrao: dados.padrao ?? false,
    documento: documento ?? null,
    nome: dados.nome || null,
    email: dados.email || null,
    telefone: dados.telefone || null,
  }
}

/**
 * Cria um endereço. Se `padrao` for `true`, desmarca — na mesma transação —
 * o endereço padrão anterior do mesmo `tipo` e do mesmo usuário. Remetente e
 * destinatário são exclusivos independentemente: marcar um remetente padrão
 * nunca afeta o destinatário padrão.
 */
export async function criarEndereco(userId: string, dados: EnderecoRequest) {
  const cep = normalizarCep(dados.cep)
  const documento = validarDocumentoSeNecessario(dados.tipo, dados.documento)

  return prisma.$transaction(async (tx) => {
    if (dados.padrao) {
      await travarPadraoDoTipo(tx, userId, dados.tipo)
      await tx.address.updateMany({
        where: { userId, tipo: dados.tipo, padrao: true },
        data: { padrao: false },
      })
    }

    return tx.address.create({
      data: { userId, ...paraCampos(dados, cep, documento) },
    })
  })
}

/**
 * Atualiza um endereço já existente do usuário. Lança
 * `EnderecoNaoEncontradoError` (→ 404 no handler) se o endereço não existir
 * ou não pertencer a `userId`, antes de tocar em qualquer dado.
 */
export async function atualizarEndereco(userId: string, id: string, dados: EnderecoRequest) {
  await buscarEnderecoDoUsuario(userId, id)

  const cep = normalizarCep(dados.cep)
  const documento = validarDocumentoSeNecessario(dados.tipo, dados.documento)

  return prisma.$transaction(async (tx) => {
    if (dados.padrao) {
      await travarPadraoDoTipo(tx, userId, dados.tipo)
      await tx.address.updateMany({
        where: { userId, tipo: dados.tipo, padrao: true, NOT: { id } },
        data: { padrao: false },
      })
    }

    return tx.address.update({
      where: { id },
      data: paraCampos(dados, cep, documento),
    })
  })
}

/**
 * Exclusão lógica: marca `arquivadoEm` e remove a marcação de padrão, sem
 * apagar a linha. Ver decisão no relatório da Task 9 — o `Shipment` guarda
 * remetente/destinatário como cópia em JSON (sem chave estrangeira para
 * `Address`), então um hard delete não quebraria envios já criados, mas
 * apagar de verdade destrói o histórico de "quais endereços este usuário já
 * cadastrou" sem necessidade, e reabre a possibilidade de reaproveitar o
 * mesmo `id` de forma confusa. Arquivar é reversível e mais barato de
 * auditar.
 */
export async function arquivarEndereco(userId: string, id: string): Promise<void> {
  await buscarEnderecoDoUsuario(userId, id)

  await prisma.address.update({
    where: { id },
    data: { arquivadoEm: new Date(), padrao: false },
  })
}

/**
 * Busca os dados de um CEP no provedor de geolocalização, para o
 * preenchimento automático do formulário. Erros (`CepInvalidoError`,
 * `ServicoIndisponivelError`) não são tratados aqui — o handler HTTP decide
 * como responder a cada um.
 */
export async function buscarEnderecoPorCep(cep: string) {
  const normalizado = normalizarCep(cep)
  return geoProvider.buscarPorCep(normalizado)
}

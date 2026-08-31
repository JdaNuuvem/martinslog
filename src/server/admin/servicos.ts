import { Prisma, type Carrier, type Service } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'

/**
 * Transportadoras (`Carrier`) e serviços (`Service`) do painel.
 *
 * Até aqui as duas tabelas só nasciam pelo seed, e a importação de tabela de
 * preço referenciava serviços que ninguém conseguia ver, muito menos editar.
 *
 * Duas regras atravessam o módulo:
 *
 * 1. **Desativar não apaga.** `Service` é referenciado por `Quote`,
 *    `Shipment` e `PriceRule` com `onDelete: Restrict` — apagar um serviço
 *    com envio associado é impossível no banco, e seria errado se fosse
 *    possível: o histórico do cliente aponta para ele. Desativar tira o
 *    serviço das cotações **novas** e deixa o passado intacto.
 * 2. **Editar o prazo não reescreve envio em curso.** A linha do tempo é
 *    materializada na emissão, com cada `ocorridoEm` já calculado a partir do
 *    prazo daquele momento. Mudar `prazoBase` afeta apenas emissões futuras —
 *    há teste afirmando isso, porque é a garantia que impede a data mudar
 *    debaixo de um cliente que já está esperando o pacote.
 */

export type LimiteDimensoes = {
  alturaCm?: number
  larguraCm?: number
  comprimentoCm?: number
}

export type ServicoResumo = {
  id: string
  codigo: string
  nome: string
  prazoBase: number
  limitePesoG: number
  limiteDimensoes: LimiteDimensoes
  exigePudo: boolean
  entregaSabado: boolean
  ativo: boolean
  regrasVigentes: number
  envios: number
}

export type TransportadoraResumo = {
  id: string
  nome: string
  slug: string
  ativo: boolean
  servicos: ServicoResumo[]
}

export type EntradaTransportadora = {
  id?: string
  nome: string
  ativo?: boolean
}

export type EntradaServico = {
  id?: string
  carrierId: string
  codigo: string
  nome: string
  prazoBase: number
  limitePesoG: number
  limiteDimensoes?: LimiteDimensoes
  exigePudo?: boolean
  entregaSabado?: boolean
  ativo?: boolean
}

/** Teto do prazo: acima disso é engano de digitação, não serviço econômico. */
const PRAZO_MAXIMO_DIAS = 120

/** 100 kg. Acima disso não é encomenda, é carga fracionada. */
const PESO_MAXIMO_G = 100_000

function paraSlug(nome: string): string {
  const slug = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  if (!slug) {
    throw new ValorInvalidoError(`Nome de transportadora sem caracteres aproveitáveis: ${nome}`)
  }

  return slug
}

function lerDimensoes(valor: Prisma.JsonValue): LimiteDimensoes {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return {}
  }

  const registro = valor as Record<string, unknown>
  const numero = (chave: string) =>
    typeof registro[chave] === 'number' ? (registro[chave] as number) : undefined

  return {
    alturaCm: numero('alturaCm'),
    larguraCm: numero('larguraCm'),
    comprimentoCm: numero('comprimentoCm'),
  }
}

/**
 * Lista transportadoras com seus serviços, cada um com quantas regras de
 * preço vigentes e quantos envios tem.
 *
 * Os dois números existem para tornar visível o custo de desativar: um
 * serviço com 4 000 envios não é uma linha descartável, e a tela precisa
 * dizer isso antes do clique, não depois.
 */
export async function listarTransportadoras(): Promise<TransportadoraResumo[]> {
  const agora = new Date()

  const carriers = await prisma.carrier.findMany({
    orderBy: { nome: 'asc' },
    include: {
      services: {
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
        include: {
          _count: { select: { shipments: true } },
          priceRules: {
            where: {
              ativo: true,
              vigenteDe: { lte: agora },
              OR: [{ vigenteAte: null }, { vigenteAte: { gte: agora } }],
            },
            select: { id: true },
          },
        },
      },
    },
  })

  return carriers.map((carrier) => ({
    id: carrier.id,
    nome: carrier.nome,
    slug: carrier.slug,
    ativo: carrier.ativo,
    servicos: carrier.services.map((servico) => ({
      id: servico.id,
      codigo: servico.codigo,
      nome: servico.nome,
      prazoBase: servico.prazoBase,
      limitePesoG: servico.limitePesoG,
      limiteDimensoes: lerDimensoes(servico.limiteDimensoes),
      exigePudo: servico.exigePudo,
      entregaSabado: servico.entregaSabado,
      ativo: servico.ativo,
      regrasVigentes: servico.priceRules.length,
      envios: servico._count.shipments,
    })),
  }))
}

async function registrarAuditoria(
  actorUserId: string,
  acao: string,
  entidade: string,
  entidadeId: string,
  antes: Prisma.InputJsonValue | typeof Prisma.JsonNull,
  depois: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { actorUserId, acao, entidade, entidadeId, antes, depois },
  })
}

function instantaneoServico(servico: Service): Prisma.InputJsonValue {
  return {
    codigo: servico.codigo,
    nome: servico.nome,
    prazoBase: servico.prazoBase,
    limitePesoG: servico.limitePesoG,
    limiteDimensoes: servico.limiteDimensoes,
    exigePudo: servico.exigePudo,
    entregaSabado: servico.entregaSabado,
    ativo: servico.ativo,
  } as Prisma.InputJsonValue
}

/**
 * Cria ou renomeia uma transportadora.
 *
 * O `slug` é derivado do nome apenas na **criação**. Renomear não o
 * reescreve: ele já pode estar em uso como identificador estável (é `@unique`
 * e é por ele que o seed encontra a transportadora), e trocá-lo por causa de
 * um acerto de acentuação criaria uma segunda transportadora na prática.
 */
export async function salvarTransportadora(
  actorUserId: string,
  entrada: EntradaTransportadora,
): Promise<Carrier> {
  const nome = entrada.nome.trim()
  if (!nome) {
    throw new ValorInvalidoError('Informe o nome da transportadora.')
  }

  if (entrada.id) {
    const existente = await prisma.carrier.findUnique({ where: { id: entrada.id } })
    if (!existente) {
      throw new ValorInvalidoError(`Transportadora não encontrada: ${entrada.id}`)
    }

    const salvo = await prisma.carrier.update({
      where: { id: existente.id },
      data: { nome, ativo: entrada.ativo ?? existente.ativo },
    })

    await registrarAuditoria(
      actorUserId,
      'TRANSPORTADORA_ATUALIZADA',
      'Carrier',
      salvo.id,
      { nome: existente.nome, ativo: existente.ativo } as Prisma.InputJsonValue,
      { nome: salvo.nome, ativo: salvo.ativo } as Prisma.InputJsonValue,
    )

    return salvo
  }

  const slug = paraSlug(nome)
  const jaExiste = await prisma.carrier.findUnique({ where: { slug } })
  if (jaExiste) {
    throw new ValorInvalidoError(`Já existe uma transportadora com o identificador "${slug}".`)
  }

  const criado = await prisma.carrier.create({
    data: { nome, slug, ativo: entrada.ativo ?? true },
  })

  await registrarAuditoria(
    actorUserId,
    'TRANSPORTADORA_CRIADA',
    'Carrier',
    criado.id,
    Prisma.JsonNull,
    { nome: criado.nome, slug: criado.slug, ativo: criado.ativo } as Prisma.InputJsonValue,
  )

  return criado
}

function validarServico(entrada: EntradaServico): void {
  if (!entrada.codigo.trim()) {
    throw new ValorInvalidoError('Informe o código do serviço.')
  }
  if (!entrada.nome.trim()) {
    throw new ValorInvalidoError('Informe o nome do serviço.')
  }
  if (!Number.isInteger(entrada.prazoBase) || entrada.prazoBase < 1) {
    throw new ValorInvalidoError('O prazo base deve ser de pelo menos 1 dia.')
  }
  if (entrada.prazoBase > PRAZO_MAXIMO_DIAS) {
    throw new ValorInvalidoError(`O prazo base não pode passar de ${PRAZO_MAXIMO_DIAS} dias.`)
  }
  if (!Number.isInteger(entrada.limitePesoG) || entrada.limitePesoG < 1) {
    throw new ValorInvalidoError('O limite de peso deve ser um inteiro positivo em gramas.')
  }
  if (entrada.limitePesoG > PESO_MAXIMO_G) {
    throw new ValorInvalidoError(`O limite de peso não pode passar de ${PESO_MAXIMO_G} g.`)
  }

  for (const [chave, valor] of Object.entries(entrada.limiteDimensoes ?? {})) {
    if (valor !== undefined && (!Number.isFinite(valor) || valor <= 0)) {
      throw new ValorInvalidoError(`A dimensão ${chave} deve ser um número positivo.`)
    }
  }
}

/**
 * Cria ou atualiza um serviço.
 *
 * **Mudar `prazoBase` vale só para emissões novas.** A linha do tempo de um
 * envio já emitido está materializada em `TrackingEvent`, com `ocorridoEm`
 * calculado no momento da emissão — nada aqui a recalcula, e há teste
 * provando que ela não se move. O que muda é o prazo exibido na listagem de
 * etiquetas, que lê o serviço atual; a auditoria registra o antes e o depois
 * justamente para explicar essa diferença quando alguém perguntar.
 */
export async function salvarServico(
  actorUserId: string,
  entrada: EntradaServico,
): Promise<Service> {
  validarServico(entrada)

  const carrier = await prisma.carrier.findUnique({ where: { id: entrada.carrierId } })
  if (!carrier) {
    throw new ValorInvalidoError(`Transportadora não encontrada: ${entrada.carrierId}`)
  }

  const campos = {
    codigo: entrada.codigo.trim(),
    nome: entrada.nome.trim(),
    prazoBase: entrada.prazoBase,
    limitePesoG: entrada.limitePesoG,
    limiteDimensoes: (entrada.limiteDimensoes ?? {}) as Prisma.InputJsonValue,
    exigePudo: entrada.exigePudo ?? false,
    entregaSabado: entrada.entregaSabado ?? false,
    ativo: entrada.ativo ?? true,
  }

  const existente = entrada.id
    ? await prisma.service.findUnique({ where: { id: entrada.id } })
    : null

  if (entrada.id && !existente) {
    throw new ValorInvalidoError(`Serviço não encontrado: ${entrada.id}`)
  }

  // `(carrierId, codigo)` é único: um código repetido dentro da mesma
  // transportadora quebraria a importação de tabela de preço, que casa
  // serviço por código.
  const conflito = await prisma.service.findFirst({
    where: {
      carrierId: entrada.carrierId,
      codigo: campos.codigo,
      ...(existente ? { id: { not: existente.id } } : {}),
    },
    select: { id: true },
  })

  if (conflito) {
    throw new ValorInvalidoError(
      `A transportadora ${carrier.nome} já tem um serviço com o código "${campos.codigo}".`,
    )
  }

  const salvo = existente
    ? await prisma.service.update({ where: { id: existente.id }, data: campos })
    : await prisma.service.create({ data: { carrierId: entrada.carrierId, ...campos } })

  await registrarAuditoria(
    actorUserId,
    existente ? 'SERVICO_ATUALIZADO' : 'SERVICO_CRIADO',
    'Service',
    salvo.id,
    existente ? instantaneoServico(existente) : Prisma.JsonNull,
    instantaneoServico(salvo),
  )

  return salvo
}

/**
 * Liga ou desliga um serviço.
 *
 * Desligado, ele some das cotações novas (`carregarCatalogo` filtra por
 * `ativo`) e nada mais acontece: envios em curso continuam com o serviço
 * deles, e a timeline de quem está em trânsito não muda. É por isso que
 * desativar é a operação oferecida, e não excluir.
 */
export async function alternarServico(
  actorUserId: string,
  servicoId: string,
  ativo: boolean,
): Promise<Service> {
  const existente = await prisma.service.findUnique({ where: { id: servicoId } })
  if (!existente) {
    throw new ValorInvalidoError(`Serviço não encontrado: ${servicoId}`)
  }

  const salvo = await prisma.service.update({ where: { id: servicoId }, data: { ativo } })

  await registrarAuditoria(
    actorUserId,
    ativo ? 'SERVICO_ATIVADO' : 'SERVICO_DESATIVADO',
    'Service',
    salvo.id,
    { ativo: existente.ativo } as Prisma.InputJsonValue,
    { ativo } as Prisma.InputJsonValue,
  )

  return salvo
}

/**
 * Liga ou desliga uma transportadora inteira.
 *
 * A cotação exige `carrier.ativo` além de `service.ativo`, então desligar a
 * transportadora tira todos os serviços dela das cotações novas sem alterar
 * o campo `ativo` de cada um — o que preserva quais serviços estavam
 * desligados individualmente, para quando ela voltar.
 */
export async function alternarTransportadora(
  actorUserId: string,
  carrierId: string,
  ativo: boolean,
): Promise<Carrier> {
  const existente = await prisma.carrier.findUnique({ where: { id: carrierId } })
  if (!existente) {
    throw new ValorInvalidoError(`Transportadora não encontrada: ${carrierId}`)
  }

  const salvo = await prisma.carrier.update({ where: { id: carrierId }, data: { ativo } })

  await registrarAuditoria(
    actorUserId,
    ativo ? 'TRANSPORTADORA_ATIVADA' : 'TRANSPORTADORA_DESATIVADA',
    'Carrier',
    salvo.id,
    { ativo: existente.ativo } as Prisma.InputJsonValue,
    { ativo } as Prisma.InputJsonValue,
  )

  return salvo
}

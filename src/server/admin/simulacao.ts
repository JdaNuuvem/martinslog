import type { CenarioSimulacao, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { calcularOcorridoEm, gerarRoteiro, statusDoEvento } from '@/domain/simulacao/roteiro'
import type { EventoRoteiro, LocalidadeSimulacao } from '@/domain/simulacao/tipos'
import type { StatusShipment } from '@/domain/shipment/estados'
import { ID_CONFIG_SIMULACAO, obterConfigSimulacao } from '@/server/simulacao-config'

/**
 * Controles administrativos da simulação de transporte
 * (docs/superpowers/specs/2026-08-31-simulacao-transporte.md, seção 6).
 *
 * Regra que atravessa este módulo inteiro: **o passado é intocável**. O
 * cliente já leu os eventos que ocorreram; reescrevê-los seria mentir para
 * ele. Toda operação daqui ou mexe só no futuro, ou reinicia a linha do
 * tempo por inteiro de forma explícita e auditada.
 *
 * Toda intervenção grava `AuditLog` com ator, entidade, antes e depois.
 */

type Executor = Prisma.TransactionClient

/** Folga mínima entre agora e o próximo evento regenerado. */
const FOLGA_MS = 60_000

async function registrarAuditoria(
  tx: Executor,
  actorUserId: string,
  acao: string,
  entidade: string,
  entidadeId: string,
  antes: Prisma.InputJsonValue,
  depois: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditLog.create({
    data: { actorUserId, acao, entidade, entidadeId, antes, depois },
  })
}

function localidadeDoEndereco(endereco: unknown, papel: string): LocalidadeSimulacao {
  const registro = endereco as { cidade?: unknown; uf?: unknown } | null

  if (typeof registro?.cidade !== 'string' || typeof registro?.uf !== 'string') {
    throw new EnvioNaoEncontradoError(`Envio sem cidade/UF de ${papel}.`)
  }

  return { cidade: registro.cidade, uf: registro.uf }
}

/**
 * Define o fator de velocidade global da simulação: 1 = tempo real,
 * 24 = um dia por hora, 288 = um dia a cada cinco minutos.
 *
 * Vale **apenas para envios novos**. O fator é copiado para o envio na
 * emissão, então nenhuma linha do tempo em curso é reescrita por esta
 * mudança — quem já está em trânsito continua no ritmo em que começou.
 */
export async function definirFatorVelocidade(
  actorUserId: string,
  fator: number,
): Promise<void> {
  if (!Number.isInteger(fator) || fator <= 0) {
    throw new ValorInvalidoError(
      `Fator de velocidade deve ser inteiro positivo, recebido: ${fator}`,
    )
  }

  await prisma.$transaction(async (tx) => {
    const atual = await obterConfigSimulacao(tx)

    await tx.simulacaoConfig.update({
      where: { id: ID_CONFIG_SIMULACAO },
      data: { fatorVelocidade: fator },
    })

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_FATOR_VELOCIDADE',
      'SimulacaoConfig',
      ID_CONFIG_SIMULACAO,
      { fatorVelocidade: atual.fatorVelocidade },
      { fatorVelocidade: fator },
    )
  })
}

/**
 * Materializa os eventos de um roteiro a partir de uma sequência inicial,
 * empurrando-os no tempo o quanto for preciso para que o primeiro caia
 * depois de `pisoTempo`. O deslocamento é o mesmo para todos, então o
 * espaçamento relativo do roteiro é preservado.
 */
function materializar(
  roteiro: EventoRoteiro[],
  shipmentId: string,
  simulacaoIniciadaEm: Date,
  fator: number,
  sequenciaInicial: number,
  pisoTempo: Date,
): Prisma.TrackingEventCreateManyInput[] {
  const datas = roteiro.map((evento) =>
    calcularOcorridoEm(simulacaoIniciadaEm, evento.offsetMinutos, fator),
  )

  const primeira = datas[0]
  const deslocamento =
    primeira && primeira.getTime() <= pisoTempo.getTime()
      ? pisoTempo.getTime() - primeira.getTime() + FOLGA_MS
      : 0

  return roteiro.map((evento, indice) => ({
    shipmentId,
    sequencia: sequenciaInicial + indice,
    offsetMinutos: evento.offsetMinutos,
    codigo: evento.codigo,
    status: evento.codigo,
    titulo: evento.titulo,
    descricao: evento.descricao,
    unidadeOrigem: evento.unidadeOrigem,
    unidadeDestino: evento.unidadeDestino,
    cidade: evento.cidade,
    uf: evento.uf,
    ocorridoEm: new Date((datas[indice] as Date).getTime() + deslocamento),
  }))
}

/**
 * Troca o cenário de um envio, regenerando **apenas os eventos futuros**.
 *
 * Os eventos já ocorridos são preservados com o mesmo id e a mesma data: o
 * cliente já os viu. Do roteiro novo só entram as etapas cujo offset é
 * posterior ao último evento preservado, renumeradas na sequência para não
 * abrir buraco nem repetir número.
 */
export async function trocarCenario(
  actorUserId: string,
  shipmentId: string,
  cenario: CenarioSimulacao,
  agora: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        cenario: true,
        remetente: true,
        destinatario: true,
        simulacaoIniciadaEm: true,
        fatorSimulacao: true,
        service: { select: { prazoBase: true } },
      },
    })

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    if (!envio.simulacaoIniciadaEm) {
      throw new ValorInvalidoError(
        `Envio ${shipmentId} ainda não teve a etiqueta emitida: não há linha do tempo para alterar.`,
      )
    }

    const passados = await tx.trackingEvent.findMany({
      where: { shipmentId, ocorridoEm: { lte: agora } },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true, offsetMinutos: true },
    })

    const ultimo = passados.at(-1)
    const ultimoOffset = ultimo?.offsetMinutos ?? -1
    const proximaSequencia = (ultimo?.sequencia ?? 0) + 1

    const { operador } = await obterConfigSimulacao(tx)

    const roteiro = gerarRoteiro({
      cenario,
      prazoDias: envio.service.prazoBase,
      origem: localidadeDoEndereco(envio.remetente, 'remetente'),
      destino: localidadeDoEndereco(envio.destinatario, 'destinatário'),
      operador,
    }).filter((evento) => evento.offsetMinutos > ultimoOffset)

    await tx.trackingEvent.deleteMany({
      where: { shipmentId, ocorridoEm: { gt: agora } },
    })

    await tx.trackingEvent.createMany({
      data: materializar(
        roteiro,
        envio.id,
        envio.simulacaoIniciadaEm,
        envio.fatorSimulacao,
        proximaSequencia,
        agora,
      ),
    })

    await tx.shipment.update({ where: { id: envio.id }, data: { cenario } })

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_TROCAR_CENARIO',
      'Shipment',
      envio.id,
      { cenario: envio.cenario, eventosPreservados: passados.length },
      { cenario, eventosGerados: roteiro.length },
    )
  })
}

/**
 * Antecipa o próximo evento pendente para agora, marcando-o como forçado, e
 * desloca todos os seguintes pelo mesmo intervalo — a timeline anda para a
 * frente inteira, em vez de se embaralhar em torno do evento antecipado.
 *
 * O status do envio é atualizado junto, respeitando a máquina de estados.
 */
export async function forcarProximoEvento(
  actorUserId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true },
    })

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    const proximo = await tx.trackingEvent.findFirst({
      where: { shipmentId, ocorridoEm: { gt: agora } },
      orderBy: { sequencia: 'asc' },
    })

    if (!proximo) {
      throw new ValorInvalidoError(
        `Envio ${shipmentId} não tem evento pendente para forçar.`,
      )
    }

    const deslocamentoMs = proximo.ocorridoEm.getTime() - agora.getTime()

    await tx.trackingEvent.update({
      where: { id: proximo.id },
      data: { ocorridoEm: agora, forcado: true },
    })

    const seguintes = await tx.trackingEvent.findMany({
      where: { shipmentId, sequencia: { gt: proximo.sequencia } },
      select: { id: true, ocorridoEm: true },
    })

    for (const seguinte of seguintes) {
      await tx.trackingEvent.update({
        where: { id: seguinte.id },
        data: { ocorridoEm: new Date(seguinte.ocorridoEm.getTime() - deslocamentoMs) },
      })
    }

    // Um status criado pela conta pode não ter tradução conhecida aqui. Nesse
    // caso o evento é antecipado do mesmo jeito — é a ação que o administrador
    // pediu — e o status do envio fica como está, em vez de o painel gravar um
    // valor inventado ou recusar a operação inteira.
    let alvo: StatusShipment | null
    try {
      alvo = statusDoEvento(proximo.codigo)
    } catch {
      alvo = null
    }

    const dados: Prisma.ShipmentUpdateInput = {}

    if (alvo !== null && alvo !== envio.status) {
      dados.status = alvo
      if (alvo === 'POSTED') dados.postadoEm = agora
      if (alvo === 'DELIVERED') dados.entregueEm = agora
      if (proximo.codigo === 'DEVOLVIDO') dados.devolvidoEm = agora
    }

    if (Object.keys(dados).length > 0) {
      await tx.shipment.update({ where: { id: envio.id }, data: dados })
    }

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_FORCAR_EVENTO',
      'Shipment',
      envio.id,
      { status: envio.status, proximoEvento: proximo.codigo, ocorridoEm: proximo.ocorridoEm },
      { status: alvo, ocorridoEm: agora, eventosDeslocados: seguintes.length },
    )
  })
}

/**
 * Apaga a linha do tempo e a regenera a partir de agora, devolvendo o envio
 * ao estado logo após a emissão.
 *
 * É a única operação deste módulo que descarta passado, e por isso a spec
 * exige confirmação na interface e registro em auditoria. O **código de
 * rastreio é preservado**: o cliente já tem aquele número, e trocá-lo
 * quebraria o link que ele guardou.
 *
 * O status volta a `GENERATED` por escrita direta, sem `garantirTransicao` —
 * voltar de `DELIVERED` para `GENERATED` não é uma transição do fluxo
 * normal, é uma intervenção administrativa deliberada sobre um envio
 * simulado. Fica registrada na auditoria justamente por ser excepcional.
 */
export async function reiniciarLinhaDoTempo(
  actorUserId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        cenario: true,
        codigoRastreio: true,
        remetente: true,
        destinatario: true,
        fatorSimulacao: true,
        service: { select: { prazoBase: true } },
      },
    })

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    if (!envio.codigoRastreio) {
      throw new ValorInvalidoError(
        `Envio ${shipmentId} ainda não teve a etiqueta emitida: não há linha do tempo para reiniciar.`,
      )
    }

    const { operador } = await obterConfigSimulacao(tx)

    const roteiro = gerarRoteiro({
      cenario: envio.cenario,
      prazoDias: envio.service.prazoBase,
      origem: localidadeDoEndereco(envio.remetente, 'remetente'),
      destino: localidadeDoEndereco(envio.destinatario, 'destinatário'),
      operador,
    })

    await tx.trackingEvent.deleteMany({ where: { shipmentId } })

    await tx.trackingEvent.createMany({
      data: roteiro.map((evento) => ({
        shipmentId: envio.id,
        sequencia: evento.sequencia,
        offsetMinutos: evento.offsetMinutos,
        codigo: evento.codigo,
        status: evento.codigo,
        titulo: evento.titulo,
        descricao: evento.descricao,
        unidadeOrigem: evento.unidadeOrigem,
        unidadeDestino: evento.unidadeDestino,
        cidade: evento.cidade,
        uf: evento.uf,
        ocorridoEm: calcularOcorridoEm(agora, evento.offsetMinutos, envio.fatorSimulacao),
      })),
    })

    await tx.shipment.update({
      where: { id: envio.id },
      data: {
        status: 'GENERATED',
        simulacaoIniciadaEm: agora,
        postadoEm: null,
        entregueEm: null,
        devolvidoEm: null,
      },
    })

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_REINICIAR_TIMELINE',
      'Shipment',
      envio.id,
      { status: envio.status },
      { status: 'GENERATED', simulacaoIniciadaEm: agora, eventosGerados: roteiro.length },
    )
  })
}

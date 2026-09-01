import type { CenarioSimulacao, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import {
  calcularOcorridoEm,
  gerarRoteiro,
  statusDoEvento,
  textoPadrao,
} from '@/domain/simulacao/roteiro'
import type { EventoRoteiro, LocalidadeSimulacao } from '@/domain/simulacao/tipos'
import { garantirTransicao, transicoesValidas, type StatusShipment } from '@/domain/shipment/estados'
import { anteciparProximoEvento } from '@/server/antecipar-evento'
import { ID_CONFIG_SIMULACAO, obterConfigSimulacao } from '@/server/simulacao-config'
import { catalogoDoUsuario, obterStatusPorCodigo } from '@/server/status-rastreio-service'

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

    // Mesma mecânica que o dono do envio dispara pela aba Etiquetas; o que
    // muda é o rastro deixado — aqui, uma intervenção administrativa.
    const antecipado = await anteciparProximoEvento(tx, envio.id, envio.status, agora)

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_FORCAR_EVENTO',
      'Shipment',
      envio.id,
      {
        status: envio.status,
        proximoEvento: antecipado.codigo,
        ocorridoEm: antecipado.ocorridoEmAnterior,
      },
      {
        status: antecipado.statusNovo,
        ocorridoEm: agora,
        eventosDeslocados: antecipado.eventosDeslocados,
      },
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

/**
 * Aplica **agora** um status escolhido a dedo, gravando um evento forçado no
 * fim da linha do tempo.
 *
 * Diferente de `forcarProximoEvento`, que apenas antecipa o que já estava
 * previsto, aqui o administrador escolhe o código: é o caminho para "coloque
 * este envio em SAIU_PARA_ENTREGA agora", sem precisar antecipar uma a uma as
 * etapas do meio.
 *
 * O que a função NÃO faz, de propósito:
 *
 * - **Não contorna a máquina de estados.** `garantirTransicao` decide se o
 *   salto é possível; recusar é melhor do que gravar um envio em estado
 *   impossível, que quebraria toda leitura posterior.
 * - **Não apaga o passado.** Os eventos já vistos pelo cliente continuam lá.
 *   Some apenas o futuro que o salto tornou inalcançável — um evento cujo
 *   status não pode mais suceder o aplicado ficaria pendurado, travando a
 *   sincronização no primeiro `break` dela.
 */
export async function aplicarStatusAgora(
  actorUserId: string,
  shipmentId: string,
  codigo: string,
  agora: Date = new Date(),
): Promise<{ status: StatusShipment }> {
  return prisma.$transaction(async (tx) => {
    const envio = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        userId: true,
        status: true,
        simulacaoIniciadaEm: true,
        fatorSimulacao: true,
        remetente: true,
        destinatario: true,
      },
    })

    if (!envio) {
      throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
    }

    const catalogo = await catalogoDoUsuario(envio.userId, tx)
    const statusPorCodigo = await obterStatusPorCodigo(envio.userId, tx)

    const alvo = statusDoEvento(codigo, statusPorCodigo)
    if (alvo !== envio.status) {
      garantirTransicao(envio.status, alvo)
    }

    const texto = catalogo.textos[codigo] ?? textoPadrao(codigo)
    if (!texto) {
      throw new ValorInvalidoError(
        `Código ${codigo} não existe no catálogo desta conta nem no roteiro padrão.`,
      )
    }

    const ultimo = await tx.trackingEvent.findFirst({
      where: { shipmentId },
      orderBy: { sequencia: 'desc' },
      select: { sequencia: true },
    })

    // Eventos futuros que o salto tornou impossíveis. Os que ainda cabem
    // depois do status aplicado permanecem — pular para "saiu para entrega"
    // não deve apagar a entrega que viria em seguida.
    const futuros = await tx.trackingEvent.findMany({
      where: { shipmentId, ocorridoEm: { gt: agora } },
      select: { id: true, codigo: true },
    })

    const inalcancaveis = futuros
      .filter((evento) => {
        let destino: StatusShipment
        try {
          destino = statusDoEvento(evento.codigo, statusPorCodigo)
        } catch {
          // Código sem tradução: mantido. Apagar o que não se entende é pior
          // que deixá-lo parado.
          return false
        }
        return destino !== alvo && !transicoesValidas[alvo].includes(destino)
      })
      .map((evento) => evento.id)

    if (inalcancaveis.length > 0) {
      await tx.trackingEvent.deleteMany({ where: { id: { in: inalcancaveis } } })
    }

    const destino = localidadeDoEndereco(
      alvo === 'DELIVERED' || alvo === 'POSTED' ? envio.destinatario : envio.remetente,
      'destinatário',
    )

    const inicio = envio.simulacaoIniciadaEm ?? agora
    const offsetMinutos = Math.max(
      0,
      Math.round(((agora.getTime() - inicio.getTime()) * envio.fatorSimulacao) / 60_000),
    )

    await tx.trackingEvent.create({
      data: {
        shipmentId: envio.id,
        sequencia: (ultimo?.sequencia ?? 0) + 1,
        offsetMinutos,
        codigo,
        status: codigo,
        titulo: texto.titulo,
        descricao: texto.descricao,
        cidade: destino.cidade,
        uf: destino.uf,
        ocorridoEm: agora,
        forcado: true,
      },
    })

    const dados: Prisma.ShipmentUpdateInput = {}
    if (alvo !== envio.status) {
      dados.status = alvo
      if (alvo === 'POSTED') dados.postadoEm = agora
      if (alvo === 'DELIVERED') dados.entregueEm = agora
      if (codigo === 'DEVOLVIDO') dados.devolvidoEm = agora
      await tx.shipment.update({ where: { id: envio.id }, data: dados })
    }

    await registrarAuditoria(
      tx,
      actorUserId,
      'SIMULACAO_APLICAR_STATUS',
      'Shipment',
      envio.id,
      { status: envio.status } as Prisma.InputJsonValue,
      {
        status: alvo,
        codigo,
        aplicadoEm: agora.toISOString(),
        eventosDescartados: inalcancaveis.length,
      } as Prisma.InputJsonValue,
    )

    return { status: alvo }
  })
}

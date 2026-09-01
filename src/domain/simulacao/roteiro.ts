import { ValorInvalidoError } from '../errors'
import { garantirTransicao, type StatusShipment } from '../shipment/estados'
import type {
  CodigoEvento,
  EntradaRoteiro,
  EventoRoteiro,
  LocalidadeSimulacao,
} from './tipos'
import {
  OPERADOR_PADRAO,
  UNIDADE_SISTEMA,
  mesmaLocalidade,
  unidadeAgencia,
  unidadeDistribuicao,
  unidadeTratamento,
} from './unidades'
import { escalasDaRota } from './corredor'

const MINUTOS_POR_DIA = 1440

/**
 * Títulos e descrições fixos por código de evento, copiados da referência
 * visual. Ficam em um só lugar para que a timeline do cliente e a listagem
 * administrativa nunca divirjam no texto.
 */
const TEXTOS: Readonly<Record<CodigoEvento, { titulo: string; descricao: string }>> = {
  ETIQUETA_EMITIDA: {
    titulo: 'Etiqueta emitida',
    descricao: 'Aguardando postagem pelo remetente',
  },
  POSTADO: { titulo: 'Objeto postado', descricao: 'Objeto postado' },
  TRANSFERENCIA: {
    titulo: 'Objeto em transferência',
    descricao: 'Objeto em transferência - por favor aguarde',
  },
  AGUARDANDO_TRATAMENTO: {
    titulo: 'Objeto aguardando tratamento',
    descricao: 'Objeto aguardando tratamento na unidade',
  },
  SAIU_PARA_ENTREGA: {
    titulo: 'Objeto saiu para entrega ao destinatário',
    descricao: 'É preciso ter alguém no endereço para receber o entregador',
  },
  TENTATIVA_FRUSTRADA: {
    titulo: 'Tentativa de entrega não efetuada',
    descricao: 'Entregador não atendido, será realizada nova tentativa',
  },
  AGUARDANDO_RETIRADA: {
    titulo: 'Objeto aguardando retirada',
    descricao: 'Objeto aguardando retirada no endereço indicado',
  },
  ENTREGUE: {
    titulo: 'Objeto entregue ao destinatário',
    descricao: 'Objeto entregue ao destinatário',
  },
  EXTRAVIADO: {
    titulo: 'Objeto extraviado',
    descricao: 'Objeto não localizado no fluxo postal',
  },
  DEVOLUCAO_INICIADA: {
    titulo: 'Objeto em devolução',
    descricao: 'Objeto devolvido ao remetente por prazo de retirada expirado',
  },
  DEVOLVIDO: {
    titulo: 'Objeto entregue ao remetente',
    descricao: 'Objeto entregue ao remetente',
  },
}

/**
 * Texto embutido de um código do roteiro padrão, ou `null` para um código que
 * o motor não conhece.
 *
 * Exposto para quem precisa escrever um evento avulso na timeline — o
 * "aplicar status agora" do painel — sem duplicar as frases que o cliente já
 * lê no restante do rastreio.
 */
export function textoPadrao(codigo: string): { titulo: string; descricao: string } | null {
  return TEXTOS[codigo as CodigoEvento] ?? null
}

/** Códigos que o motor conhece, para as telas oferecerem a lista. */
export function codigosPadraoDoMotor(): string[] {
  return Object.keys(TEXTOS)
}

/**
 * Status resultante de cada código, conforme a seção 5 da spec. O status do
 * envio é sempre derivado do último evento visível — nunca escrito em
 * paralelo. `DEVOLVIDO` também resulta em `DELIVERED`; a marcação de
 * devolução vive no próprio envio, não em um status extra.
 */
const STATUS_POR_CODIGO: Readonly<Record<CodigoEvento, StatusShipment>> = {
  ETIQUETA_EMITIDA: 'GENERATED',
  POSTADO: 'POSTED',
  TRANSFERENCIA: 'POSTED',
  AGUARDANDO_TRATAMENTO: 'POSTED',
  SAIU_PARA_ENTREGA: 'POSTED',
  TENTATIVA_FRUSTRADA: 'POSTED',
  AGUARDANDO_RETIRADA: 'POSTED',
  DEVOLUCAO_INICIADA: 'POSTED',
  ENTREGUE: 'DELIVERED',
  EXTRAVIADO: 'LOST',
  DEVOLVIDO: 'DELIVERED',
}

/**
 * Status de envio produzido por um evento.
 *
 * Aceita `string` porque o código pode ter sido criado por uma conta, e
 * **lança** quando não conhece o código, em vez de devolver `undefined`.
 * Devolver `undefined` era pior que um erro: em `sincronizarEnvio` o valor
 * caía num `includes` que dava falso e o laço parava em silêncio — o
 * rastreio congelava no primeiro evento customizado e ninguém percebia até
 * um cliente reclamar.
 */
export function statusDoEvento(
  codigo: string,
  statusPorCodigo?: Readonly<Record<string, StatusShipment>>,
): StatusShipment {
  const status = statusPorCodigo?.[codigo] ?? STATUS_POR_CODIGO[codigo as CodigoEvento]

  if (!status) {
    throw new ValorInvalidoError(
      `Código de evento sem status correspondente: ${codigo}. Um status criado pela conta precisa informar o status resultante.`,
    )
  }

  return status
}

/**
 * Percorre o roteiro já ordenado e exige que cada mudança de status seja uma
 * transição válida.
 *
 * Precisa existir separada da validação do painel porque a validade só
 * aparece na **sequência**: uma etapa perfeitamente válida isolada pode cair
 * entre duas outras e produzir, por exemplo, `DELIVERED → POSTED`. Ao salvar
 * no painel não se conhecem os vizinhos, que dependem do cenário e do prazo
 * do serviço do envio.
 */
export function validarRoteiro(
  eventos: readonly { codigo: string }[],
  statusPorCodigo?: Readonly<Record<string, StatusShipment>>,
): void {
  let anterior: StatusShipment | null = null

  for (const evento of eventos) {
    const atual = statusDoEvento(evento.codigo, statusPorCodigo)
    if (anterior && anterior !== atual) {
      garantirTransicao(anterior, atual)
    }
    anterior = atual
  }
}

/** Etapa já pronta para virar evento, com código possivelmente customizado. */
interface EtapaResolvida {
  /** Offset final em minutos, já resolvido entre fração do prazo e dias. */
  offsetMinutos: number
  codigo: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  local: LocalidadeSimulacao
  /** Presente nas etapas da conta, que trazem o próprio texto. */
  texto?: { titulo: string; descricao: string }
}

/** Etapa do roteiro antes de virar minutos: a fração é do prazo do serviço. */
interface Etapa {
  fracao: number
  codigo: CodigoEvento
  unidadeOrigem: string | null
  unidadeDestino: string | null
  local: LocalidadeSimulacao
}

/**
 * Trecho comum a todos os cenários: emissão, postagem e as transferências
 * até a unidade de tratamento de destino. Encomenda local — mesma cidade na
 * origem e no destino — passa por uma única transferência.
 */
function espinha(entrada: EntradaRoteiro): Etapa[] {
  const { origem, destino } = entrada
  const operador = entrada.operador ?? OPERADOR_PADRAO
  const agenciaOrigem = unidadeAgencia(origem, operador)

  const inicio: Etapa[] = [
    {
      fracao: 0,
      codigo: 'ETIQUETA_EMITIDA',
      unidadeOrigem: UNIDADE_SISTEMA,
      unidadeDestino: null,
      local: origem,
    },
    {
      fracao: 0.1,
      codigo: 'POSTADO',
      unidadeOrigem: agenciaOrigem,
      unidadeDestino: null,
      local: origem,
    },
    {
      fracao: 0.25,
      codigo: 'TRANSFERENCIA',
      unidadeOrigem: agenciaOrigem,
      unidadeDestino: unidadeTratamento(origem),
      local: origem,
    },
  ]

  if (mesmaLocalidade(origem, destino)) {
    return inicio
  }

  /*
    Entre a origem e o destino existe o país inteiro. Uma transferência única
    de Fortaleza para Porto Alegre descreve um teletransporte; as escalas
    fazem a encomenda percorrer o caminho, parando em cidades que ficam
    mesmo entre as duas pontas.

    Duas escalas no máximo: o roteiro automático é a espinha curta, e quem
    quiser um percurso detalhado monta o próprio fluxo. Trecho curto não
    ganha nenhuma, e aí este bloco devolve a transferência única de antes.
  */
  const escalas = escalasDaRota(origem, destino, 2)
  const paradas = [...escalas, destino]

  // As transferências dividem igualmente o trecho entre 0.4 e 0.7, que é a
  // janela que a etapa única ocupava.
  const PRIMEIRA = 0.4
  const ULTIMA = 0.7
  const passo = paradas.length > 1 ? (ULTIMA - PRIMEIRA) / (paradas.length - 1) : 0

  return [
    ...inicio,
    ...paradas.map((parada, indice): Etapa => ({
      fracao: paradas.length > 1 ? PRIMEIRA + indice * passo : 0.55,
      codigo: 'TRANSFERENCIA',
      unidadeOrigem: unidadeTratamento(indice === 0 ? origem : paradas[indice - 1]!),
      unidadeDestino: unidadeTratamento(parada),
      local: parada,
    })),
  ]
}

function saiuParaEntrega(fracao: number, destino: LocalidadeSimulacao): Etapa {
  return {
    fracao,
    codigo: 'SAIU_PARA_ENTREGA',
    unidadeOrigem: unidadeDistribuicao(destino),
    unidadeDestino: null,
    local: destino,
  }
}

function noDestino(
  fracao: number,
  codigo: CodigoEvento,
  destino: LocalidadeSimulacao,
): Etapa {
  return {
    fracao,
    codigo,
    unidadeOrigem: unidadeDistribuicao(destino),
    unidadeDestino: null,
    local: destino,
  }
}

/** Etapas posteriores à espinha, por cenário. */
function desfecho(entrada: EntradaRoteiro): Etapa[] {
  const { origem, destino, cenario } = entrada
  const operador = entrada.operador ?? OPERADOR_PADRAO

  const tentativaFrustrada: Etapa[] = [
    saiuParaEntrega(0.85, destino),
    noDestino(1.0, 'TENTATIVA_FRUSTRADA', destino),
    noDestino(1.05, 'AGUARDANDO_RETIRADA', destino),
  ]

  switch (cenario) {
    case 'ENTREGA_NORMAL':
      return [saiuParaEntrega(0.85, destino), noDestino(1.0, 'ENTREGUE', destino)]

    case 'ATRASO':
      return [
        {
          fracao: 1.1,
          codigo: 'AGUARDANDO_TRATAMENTO',
          unidadeOrigem: unidadeTratamento(destino),
          unidadeDestino: null,
          local: destino,
        },
        saiuParaEntrega(1.6, destino),
        noDestino(1.8, 'ENTREGUE', destino),
      ]

    case 'TENTATIVA_FALHA':
      return [
        ...tentativaFrustrada,
        saiuParaEntrega(1.9, destino),
        noDestino(2.0, 'ENTREGUE', destino),
      ]

    case 'EXTRAVIO':
      return [
        {
          fracao: 1.5,
          codigo: 'EXTRAVIADO',
          unidadeOrigem: unidadeTratamento(destino),
          unidadeDestino: null,
          local: destino,
        },
      ]

    case 'DEVOLUCAO':
      return [
        ...tentativaFrustrada,
        {
          fracao: 2.5,
          codigo: 'DEVOLUCAO_INICIADA',
          unidadeOrigem: unidadeTratamento(destino),
          unidadeDestino: unidadeAgencia(origem, operador),
          local: destino,
        },
        {
          fracao: 3.0,
          codigo: 'DEVOLVIDO',
          unidadeOrigem: unidadeAgencia(origem, operador),
          unidadeDestino: null,
          local: origem,
        },
      ]
  }
}

/**
 * Gera o roteiro completo de um envio. É puro: mesmas entradas, mesma saída,
 * sem relógio. O momento real de cada evento só é calculado na materialização
 * (`calcularOcorridoEm`), a partir de `simulacaoIniciadaEm` e do fator
 * copiado para o envio.
 */
export function gerarRoteiro(entrada: EntradaRoteiro): EventoRoteiro[] {
  if (!Number.isFinite(entrada.prazoDias) || entrada.prazoDias <= 0) {
    throw new ValorInvalidoError(
      `Prazo do serviço deve ser positivo, recebido: ${entrada.prazoDias}`,
    )
  }

  const totalMinutos = entrada.prazoDias * MINUTOS_POR_DIA
  const etapasCenario = [...espinha(entrada), ...desfecho(entrada)]
  const posicoes = entrada.posicoesDias ?? {}

  // Fração da PRIMEIRA ocorrência de cada código. `TRANSFERENCIA` aparece
  // duas vezes no roteiro de rota interestadual; reposicionar as duas para o
  // mesmo dia as empilharia no mesmo instante. Em vez disso, a posição em
  // dias vale para a primeira ocorrência e as seguintes preservam o intervalo
  // que tinham em relação a ela — a etapa se move, o desenho do trajeto não
  // se desfaz.
  const fracaoBase = new Map<string, number>()
  for (const etapa of etapasCenario) {
    if (!fracaoBase.has(etapa.codigo)) {
      fracaoBase.set(etapa.codigo, etapa.fracao)
    }
  }

  const doCenario: EtapaResolvida[] = etapasCenario.map((etapa) => {
    const dias = posicoes[etapa.codigo]
    const base = fracaoBase.get(etapa.codigo) ?? etapa.fracao
    const offsetMinutos =
      dias === undefined
        ? etapa.fracao * totalMinutos
        : dias * MINUTOS_POR_DIA + (etapa.fracao - base) * totalMinutos

    return {
      offsetMinutos,
      codigo: etapa.codigo,
      unidadeOrigem: etapa.unidadeOrigem,
      unidadeDestino: etapa.unidadeDestino,
      local: etapa.local,
    }
  })

  // Só as etapas do cenário deste envio: uma etapa criada para o ATRASO não
  // pode aparecer numa entrega normal.
  const extras: EtapaResolvida[] = (entrada.etapasExtras ?? [])
    .filter((extra) => extra.cenario === entrada.cenario)
    .map((extra) => {
      const offsetMinutos =
        extra.dias === undefined ? extra.fracao * totalMinutos : extra.dias * MINUTOS_POR_DIA

      return {
        offsetMinutos,
        codigo: extra.codigo,
        unidadeOrigem: null,
        unidadeDestino: null,
        // Metade do caminho para trás é origem; daí em diante, destino. Com
        // posição em dias a referência é o offset resolvido, não a fração.
        local: offsetMinutos >= totalMinutos / 2 ? entrada.destino : entrada.origem,
        texto: { titulo: extra.titulo, descricao: extra.descricao },
      }
    })

  // `sort` estável: empate de instante mantém a etapa do cenário antes da
  // extra, para que uma etapa da conta em 1,0·P não se meta na frente da
  // entrega.
  const ordenadas = [...doCenario, ...extras].sort((a, b) => a.offsetMinutos - b.offsetMinutos)

  const eventos = ordenadas.map((etapa, indice) => {
    // A etapa da conta traz o próprio texto; para as do cenário vale a
    // sobreposição da conta e, na falta dela, o texto padrão.
    const texto =
      entrada.textos?.[etapa.codigo] ?? etapa.texto ?? TEXTOS[etapa.codigo as CodigoEvento]

    if (!texto) {
      throw new ValorInvalidoError(`Código de evento sem texto correspondente: ${etapa.codigo}`)
    }

    return {
      sequencia: indice + 1,
      offsetMinutos: Math.round(etapa.offsetMinutos),
      codigo: etapa.codigo,
      titulo: texto.titulo,
      descricao: texto.descricao,
      unidadeOrigem: etapa.unidadeOrigem,
      unidadeDestino: etapa.unidadeDestino,
      cidade: etapa.local.cidade,
      uf: etapa.local.uf,
    }
  })

  // Barreira real: nada inválido chega a virar TrackingEvent no banco. O
  // painel valida antes só para dar erro compreensível na tela.
  validarRoteiro(eventos, statusPorCodigoExtras(entrada))

  return eventos
}

/** Mapa código→status das etapas da conta, para resolver os códigos livres. */
function statusPorCodigoExtras(entrada: EntradaRoteiro): Record<string, StatusShipment> {
  const mapa: Record<string, StatusShipment> = {}
  for (const extra of entrada.etapasExtras ?? []) {
    mapa[extra.codigo] = extra.statusResultante as StatusShipment
  }
  return mapa
}

/**
 * Materializa o instante de um evento. O fator é o do envio, não o global:
 * mudar a velocidade da simulação não pode reescrever a linha do tempo de
 * quem já está em trânsito.
 */
export function calcularOcorridoEm(
  simulacaoIniciadaEm: Date,
  offsetMinutos: number,
  fatorSimulacao: number,
): Date {
  if (!Number.isFinite(fatorSimulacao) || fatorSimulacao <= 0) {
    throw new ValorInvalidoError(
      `Fator de simulação deve ser positivo, recebido: ${fatorSimulacao}`,
    )
  }

  const deslocamentoMs = Math.round((offsetMinutos * 60_000) / fatorSimulacao)
  return new Date(simulacaoIniciadaEm.getTime() + deslocamentoMs)
}

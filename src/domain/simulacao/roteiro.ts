import { ValorInvalidoError } from '../errors'
import type { StatusShipment } from '../shipment/estados'
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

export function statusDoEvento(codigo: CodigoEvento): StatusShipment {
  return STATUS_POR_CODIGO[codigo]
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

  return [
    ...inicio,
    {
      fracao: 0.55,
      codigo: 'TRANSFERENCIA',
      unidadeOrigem: unidadeTratamento(origem),
      unidadeDestino: unidadeTratamento(destino),
      local: destino,
    },
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

  return [...espinha(entrada), ...desfecho(entrada)].map((etapa, indice) => ({
    sequencia: indice + 1,
    offsetMinutos: Math.round(etapa.fracao * totalMinutos),
    codigo: etapa.codigo,
    titulo: TEXTOS[etapa.codigo].titulo,
    descricao: TEXTOS[etapa.codigo].descricao,
    unidadeOrigem: etapa.unidadeOrigem,
    unidadeDestino: etapa.unidadeDestino,
    cidade: etapa.local.cidade,
    uf: etapa.local.uf,
  }))
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

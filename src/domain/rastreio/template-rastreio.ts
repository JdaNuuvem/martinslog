import { ValorInvalidoError } from '../errors'
import type { StatusShipment } from '../shipment/estados'

/**
 * Template de percurso montado pela conta.
 *
 * Alternativa ao roteiro automático: em vez de a simulação escolher as
 * etapas por cenário, a conta declara a sequência exata que os envios dela
 * percorrem, com a posição de cada passo em dias após a emissão.
 *
 * A sequência é **linear e literal**: todo envio da conta passa por todos os
 * passos, na ordem declarada. Isso é deliberado — quem monta o template está
 * roteirizando a experiência que o destinatário vai ver, e incluir uma
 * tentativa frustrada significa que todos os envios terão uma tentativa
 * frustrada. Quem quiser o comportamento por cenário não monta template
 * nenhum e fica com o caminho padrão.
 */

/**
 * Natureza do nó.
 *
 * `ETAPA` é um evento comum da timeline. `COBRANCA` é uma etapa que carrega
 * um valor a pagar — tributo de importação, taxa alfandegária —, e existe
 * separada porque o que se pode fazer com ela é diferente: ela tem valor,
 * aponta para um meio de pagamento e não pode ser apenas texto.
 */
export type TipoNo = 'ETAPA' | 'COBRANCA'

/** Um passo do template, já com posição no tempo e no canvas. */
export type PassoTemplate = {
  codigo: string
  titulo: string
  descricao: string
  /** Dias após a emissão. Zero é o instante da emissão. */
  diasAposEmissao: number
  /** Ausente em templates antigos, que só tinham etapas. */
  tipo?: TipoNo
  /** Posição no canvas. Ausente em templates montados antes do canvas. */
  x?: number
  y?: number
  /** Só em nós de cobrança. */
  valorCentavos?: number
  /** Identificador do meio de pagamento configurado para a conta. */
  gateway?: string
}

/** Item oferecido na paleta da tela, com o status de envio que ele produz. */
export type ItemPaleta = {
  codigo: string
  tipo: TipoNo
  rotulo: string
  descricaoPadrao: string
  statusResultante: StatusShipment
  /** Dias sugeridos, para o campo já nascer preenchido. */
  diasSugeridos: number
  /**
   * Encerra o envio na máquina de estados. Só pode ser o último passo, e o
   * campo existe para a tela avisar antes de o servidor recusar.
   */
  terminal: boolean
}

const DIAS_MAXIMO = 365
const PASSOS_MAXIMO = 30

/** Quantas tentativas de entrega numeradas a paleta oferece. */
export const TENTATIVAS_OFERECIDAS = 5

/**
 * Paleta fixa. Os códigos reaproveitam os do motor sempre que existe
 * equivalente, para que o resto do sistema — cor da faixa, tradução de
 * status, listagem — continue reconhecendo o evento sem tratamento especial.
 */
export const PALETA: readonly ItemPaleta[] = [
  {
    codigo: 'ETIQUETA_EMITIDA',
    rotulo: 'Aguardando postagem pelo remetente',
    descricaoPadrao: 'Aguardando postagem pelo remetente',
    tipo: 'ETAPA',
    statusResultante: 'GENERATED',
    diasSugeridos: 0,
    terminal: false,
  },
  {
    codigo: 'POSTADO',
    rotulo: 'Postado',
    descricaoPadrao: 'Objeto postado',
    tipo: 'ETAPA',
    statusResultante: 'POSTED',
    diasSugeridos: 1,
    terminal: false,
  },
  {
    codigo: 'TRANSFERENCIA',
    rotulo: 'Em trânsito',
    descricaoPadrao: 'Objeto em trânsito - por favor aguarde',
    tipo: 'ETAPA',
    statusResultante: 'POSTED',
    diasSugeridos: 2,
    terminal: false,
  },
  {
    codigo: 'SAIU_PARA_ENTREGA',
    rotulo: 'Saiu para entrega',
    descricaoPadrao: 'É preciso ter alguém no endereço para receber',
    tipo: 'ETAPA',
    statusResultante: 'POSTED',
    diasSugeridos: 4,
    terminal: false,
  },
  {
    codigo: 'TENTATIVA_FRUSTRADA',
    rotulo: 'Tentativa sem sucesso',
    descricaoPadrao: 'Entregador não atendido, será realizada nova tentativa',
    tipo: 'ETAPA',
    statusResultante: 'POSTED',
    diasSugeridos: 5,
    terminal: false,
  },
  ...Array.from({ length: TENTATIVAS_OFERECIDAS }, (_, indice): ItemPaleta => {
    const numero = indice + 1
    return {
      codigo: `TENTATIVA_ENTREGA_${numero}`,
      rotulo: `${numero}ª tentativa de entrega`,
      descricaoPadrao: `${numero}ª tentativa de entrega ao destinatário`,
      tipo: 'ETAPA',
      statusResultante: 'POSTED',
      diasSugeridos: 4 + numero,
      terminal: false,
    }
  }),
  {
    codigo: 'AGUARDANDO_TRIBUTO',
    tipo: 'COBRANCA',
    rotulo: 'Aguardando pagamento de tributo',
    descricaoPadrao: 'Objeto retido para pagamento de tributos de importação',
    statusResultante: 'POSTED',
    diasSugeridos: 3,
    terminal: false,
  },
  {
    codigo: 'TAXA_ALFANDEGA',
    tipo: 'COBRANCA',
    rotulo: 'Taxa alfandegária',
    descricaoPadrao: 'Aguardando pagamento da taxa alfandegária',
    statusResultante: 'POSTED',
    diasSugeridos: 3,
    terminal: false,
  },
  {
    codigo: 'ENTREGUE',
    rotulo: 'Entregue',
    descricaoPadrao: 'Objeto entregue ao destinatário',
    tipo: 'ETAPA',
    statusResultante: 'DELIVERED',
    diasSugeridos: 6,
    terminal: true,
  },
  {
    codigo: 'DEVOLVIDO',
    rotulo: 'Devolvido ao remetente',
    descricaoPadrao: 'Objeto entregue ao remetente',
    tipo: 'ETAPA',
    statusResultante: 'DELIVERED',
    diasSugeridos: 10,
    terminal: true,
  },
  {
    codigo: 'EXTRAVIADO',
    rotulo: 'Extraviado',
    descricaoPadrao: 'Objeto não localizado no fluxo de transporte',
    tipo: 'ETAPA',
    statusResultante: 'LOST',
    diasSugeridos: 12,
    terminal: true,
  },
]

const POR_CODIGO = new Map(PALETA.map((item) => [item.codigo, item]))

export function itemDaPaleta(codigo: string): ItemPaleta | undefined {
  return POR_CODIGO.get(codigo)
}

/**
 * Mapa código→status dos passos de um template, para os pontos de leitura
 * traduzirem eventos de códigos que só existem aqui (as tentativas
 * numeradas, por exemplo).
 */
export function statusPorCodigoDoTemplate(
  passos: readonly PassoTemplate[],
): Record<string, StatusShipment> {
  const mapa: Record<string, StatusShipment> = {}
  for (const passo of passos) {
    const item = itemDaPaleta(passo.codigo)
    if (item) {
      mapa[passo.codigo] = item.statusResultante
    }
  }
  return mapa
}

/**
 * Valida o template inteiro, e não passo a passo.
 *
 * A validade de um percurso só existe na sequência: um passo perfeitamente
 * válido isolado pode vir depois de um que encerra o envio. Por isso a
 * checagem acontece sobre a lista completa, no momento de salvar, e a
 * mensagem aponta o passo problemático — não adianta dizer "template
 * inválido" para quem montou doze passos.
 */
export function validarTemplate(passos: readonly PassoTemplate[]): void {
  if (passos.length === 0) {
    throw new ValorInvalidoError('O template precisa de ao menos um passo.')
  }

  if (passos.length > PASSOS_MAXIMO) {
    throw new ValorInvalidoError(
      `O template aceita no máximo ${PASSOS_MAXIMO} passos, recebidos ${passos.length}.`,
    )
  }

  const vistos = new Set<string>()

  passos.forEach((passo, indice) => {
    const item = itemDaPaleta(passo.codigo)
    const posicao = indice + 1

    if (!item) {
      throw new ValorInvalidoError(`Passo ${posicao}: "${passo.codigo}" não existe na paleta.`)
    }

    if (vistos.has(passo.codigo)) {
      // Repetir o mesmo código produziria dois eventos idênticos na timeline,
      // indistinguíveis para quem acompanha. Para repetir uma tentativa, a
      // paleta oferece as numeradas.
      throw new ValorInvalidoError(
        `Passo ${posicao}: "${item.rotulo}" aparece mais de uma vez no template.`,
      )
    }
    vistos.add(passo.codigo)

    if (!passo.titulo.trim() || !passo.descricao.trim()) {
      throw new ValorInvalidoError(`Passo ${posicao}: título e descrição são obrigatórios.`)
    }

    if (
      !Number.isFinite(passo.diasAposEmissao) ||
      passo.diasAposEmissao < 0 ||
      passo.diasAposEmissao > DIAS_MAXIMO
    ) {
      throw new ValorInvalidoError(
        `Passo ${posicao}: os dias após a emissão devem estar entre 0 e ${DIAS_MAXIMO}.`,
      )
    }

    if (item.terminal && indice !== passos.length - 1) {
      // Entregue, devolvido e extraviado encerram o envio na máquina de
      // estados: nada pode vir depois deles, porque não há transição válida
      // a partir dali.
      throw new ValorInvalidoError(
        `Passo ${posicao}: "${item.rotulo}" encerra o envio e precisa ser o último passo.`,
      )
    }
  })

  // Fora de ordem no tempo, a timeline sairia embaralhada em relação ao que
  // a conta desenhou.
  for (let i = 1; i < passos.length; i += 1) {
    const anterior = passos[i - 1]!
    const atual = passos[i]!
    if (atual.diasAposEmissao < anterior.diasAposEmissao) {
      throw new ValorInvalidoError(
        `Passo ${i + 1}: acontece antes do passo anterior (${atual.diasAposEmissao} contra ${anterior.diasAposEmissao} dias).`,
      )
    }
  }
}

/** Template pronto para uso, com os passos preenchidos a partir da paleta. */
export function templatePadrao(): PassoTemplate[] {
  return ['ETIQUETA_EMITIDA', 'POSTADO', 'TRANSFERENCIA', 'SAIU_PARA_ENTREGA', 'ENTREGUE'].map(
    (codigo) => {
      const item = itemDaPaleta(codigo)!
      return {
        codigo,
        titulo: item.rotulo,
        descricao: item.descricaoPadrao,
        diasAposEmissao: item.diasSugeridos,
      }
    },
  )
}

/**
 * Gera o roteiro literal do template.
 *
 * Substitui o roteiro por cenário em vez de se somar a ele: quem montou um
 * template declarou o percurso inteiro, e mesclar com a espinha automática
 * produziria eventos que a conta não pediu.
 *
 * A localidade segue a lógica do motor: antes de sair para entrega o objeto
 * está na origem; a partir daí, no destino.
 */
export function gerarRoteiroDeTemplate(
  passos: readonly PassoTemplate[],
  origem: { cidade: string; uf: string },
  destino: { cidade: string; uf: string },
): {
  sequencia: number
  offsetMinutos: number
  codigo: string
  titulo: string
  descricao: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  cidade: string
  uf: string
}[] {
  validarTemplate(passos)

  const MINUTOS_POR_DIA = 1440
  const indiceEntrega = passos.findIndex((passo) =>
    ['SAIU_PARA_ENTREGA', 'TENTATIVA_FRUSTRADA'].includes(passo.codigo) ||
    passo.codigo.startsWith('TENTATIVA_ENTREGA_'),
  )

  return passos.map((passo, indice) => {
    const noDestino = indiceEntrega >= 0 && indice >= indiceEntrega
    const local = noDestino ? destino : origem

    return {
      sequencia: indice + 1,
      offsetMinutos: Math.round(passo.diasAposEmissao * MINUTOS_POR_DIA),
      codigo: passo.codigo,
      titulo: passo.titulo,
      descricao: passo.descricao,
      unidadeOrigem: null,
      unidadeDestino: null,
      cidade: local.cidade,
      uf: local.uf,
    }
  })
}

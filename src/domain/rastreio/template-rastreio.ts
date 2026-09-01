import { ValorInvalidoError } from '../errors'
import { escalasDaRota } from '../simulacao/corredor'
import { unidadeTratamento } from '../simulacao/unidades'
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
  /**
   * Identidade da **instância** do nó, não do tipo dele.
   *
   * O código pode repetir — um percurso real passa por "em trânsito" e por
   * "transferência entre filiais" várias vezes, em dias e unidades
   * diferentes. O que não pode repetir é a instância, porque é ela que
   * distingue dois nós do mesmo tipo ao reordenar, editar e remover.
   *
   * Opcional para templates montados antes desta mudança; quem os carrega
   * atribui um id na leitura.
   */
  id?: string
  codigo: string
  titulo: string
  descricao: string
  /**
   * Dias de espera **desde o nó anterior** do percurso. No primeiro nó, desde
   * a emissão.
   *
   * O percurso é uma linha: cada etapa acontece um tanto de tempo depois da
   * que veio antes. Contar tudo a partir da emissão obrigava quem monta o
   * fluxo a somar de cabeça — e mover um nó no meio desalinhava todos os
   * seguintes, porque cada um carregava um total absoluto que ninguém tinha
   * pedido para recalcular.
   */
  diasAposAnterior: number
  /**
   * Campo dos templates montados antes desta mudança, quando o número era o
   * total acumulado desde a emissão. Só de leitura: `normalizarDias` o
   * converte em `diasAposAnterior` e nada volta a gravá-lo.
   */
  diasAposEmissao?: number
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
    codigo: 'TRANSFERENCIA_FILIAL',
    tipo: 'ETAPA',
    rotulo: 'Transferência entre filiais',
    descricaoPadrao: 'Objeto em transferência entre unidades',
    statusResultante: 'POSTED',
    diasSugeridos: 3,
    terminal: false,
  },
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
 * Intervalo sugerido ao acrescentar um nó ao percurso: um dia depois do
 * anterior. Sugestão de partida, não regra — quem monta ajusta.
 */
export const INTERVALO_PADRAO_DIAS = 1

/**
 * Converte passos legados, que guardavam o total de dias desde a emissão, no
 * intervalo entre etapas que o percurso usa hoje.
 *
 * Roda na leitura, não numa migração de banco: os passos vivem como JSON
 * dentro do template, e converter ao ler mantém templates antigos e novos
 * funcionando sem precisar reescrever tudo de uma vez. É idempotente — passo
 * que já tem `diasAposAnterior` passa intacto.
 *
 * Um total menor que o do passo anterior (possível nos templates antigos,
 * que só validavam a ordem no salvamento) vira intervalo zero em vez de
 * negativo: o percurso é uma linha do tempo, e voltar no tempo não é uma
 * posição válida.
 */
export function normalizarDias(passos: readonly PassoTemplate[]): PassoTemplate[] {
  let acumuladoLegado = 0

  return passos.map((passo) => {
    if (typeof passo.diasAposAnterior === 'number') {
      acumuladoLegado += passo.diasAposAnterior
      return passo
    }

    const total = passo.diasAposEmissao ?? acumuladoLegado
    const intervalo = Math.max(0, total - acumuladoLegado)
    acumuladoLegado = Math.max(acumuladoLegado, total)

    return { ...passo, diasAposAnterior: intervalo }
  })
}

/**
 * Dia de cada passo contado da emissão — a soma dos intervalos até ele.
 *
 * É o que a timeline precisa (o evento tem uma data) e o que a tela mostra
 * ao lado do intervalo, para quem monta ver o total sem somar de cabeça.
 */
export function diasAcumulados(passos: readonly PassoTemplate[]): number[] {
  const totais: number[] = []
  let total = 0

  for (const passo of normalizarDias(passos)) {
    total += passo.diasAposAnterior
    totais.push(total)
  }

  return totais
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
export function validarTemplate(passosRecebidos: readonly PassoTemplate[]): void {
  // Valida já no formato de hoje: um template legado (dias absolutos) é
  // convertido antes, senão a checagem de intervalo reprovaria totais
  // perfeitamente válidos.
  const passos = normalizarDias(passosRecebidos)
  const totais = diasAcumulados(passos)

  if (passos.length === 0) {
    throw new ValorInvalidoError('O template precisa de ao menos um passo.')
  }

  if (passos.length > PASSOS_MAXIMO) {
    throw new ValorInvalidoError(
      `O template aceita no máximo ${PASSOS_MAXIMO} passos, recebidos ${passos.length}.`,
    )
  }

  const idsVistos = new Set<string>()

  passos.forEach((passo, indice) => {
    const item = itemDaPaleta(passo.codigo)
    const posicao = indice + 1

    if (!item) {
      throw new ValorInvalidoError(`Passo ${posicao}: "${passo.codigo}" não existe na paleta.`)
    }

    // O código pode repetir de propósito: uma encomenda passa por várias
    // transferências. O que não pode repetir é a instância, senão reordenar
    // ou remover um nó afetaria o outro.
    if (passo.id) {
      if (idsVistos.has(passo.id)) {
        throw new ValorInvalidoError(
          `Passo ${posicao}: identificador de nó repetido (${passo.id}).`,
        )
      }
      idsVistos.add(passo.id)
    }

    // Dois nós do mesmo tipo, no mesmo dia e com o mesmo texto seriam
    // indistinguíveis na timeline — quem acompanha veria a mesma linha duas
    // vezes sem saber por quê.
    // Compara o dia em que cada um cai, não o intervalo: dois nós com o
    // mesmo intervalo em pontos diferentes do percurso são etapas distintas.
    const gemeo = passos.findIndex(
      (outro, i) =>
        i < indice &&
        outro.codigo === passo.codigo &&
        totais[i] === totais[indice] &&
        outro.titulo.trim() === passo.titulo.trim(),
    )
    if (gemeo >= 0) {
      throw new ValorInvalidoError(
        `Passo ${posicao}: idêntico ao passo ${gemeo + 1} (mesmo texto e mesmo dia). Mude o texto ou o dia para diferenciar.`,
      )
    }

    if (!passo.titulo.trim() || !passo.descricao.trim()) {
      throw new ValorInvalidoError(`Passo ${posicao}: título e descrição são obrigatórios.`)
    }

    if (
      !Number.isFinite(passo.diasAposAnterior) ||
      passo.diasAposAnterior < 0 ||
      passo.diasAposAnterior > DIAS_MAXIMO
    ) {
      throw new ValorInvalidoError(
        `Passo ${posicao}: o intervalo até a etapa anterior deve estar entre 0 e ${DIAS_MAXIMO} dias.`,
      )
    }

    // O percurso inteiro também não pode passar do teto: intervalos pequenos
    // somados chegariam a anos de linha do tempo.
    if (totais[indice]! > DIAS_MAXIMO) {
      throw new ValorInvalidoError(
        `Passo ${posicao}: o percurso passa de ${DIAS_MAXIMO} dias no total (${totais[indice]}). Reduza os intervalos.`,
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

  // A regra que exigia ordem crescente no tempo saiu daqui: com intervalos
  // entre etapas, um passo nunca pode cair antes do anterior — o intervalo
  // não negativo já garante isso por construção.
}

/** Template pronto para uso, com os passos preenchidos a partir da paleta. */
export function templatePadrao(): PassoTemplate[] {
  let diaAnterior = 0

  return ['ETIQUETA_EMITIDA', 'POSTADO', 'TRANSFERENCIA', 'SAIU_PARA_ENTREGA', 'ENTREGUE'].map(
    (codigo) => {
      const item = itemDaPaleta(codigo)!
      // `diasSugeridos` da paleta é o dia absoluto em que a etapa costuma
      // cair; o percurso guarda o intervalo desde a anterior.
      const diaDoPasso = Math.max(diaAnterior, item.diasSugeridos)
      const intervalo = diaDoPasso - diaAnterior
      diaAnterior = diaDoPasso

      return {
        codigo,
        titulo: item.rotulo,
        descricao: item.descricaoPadrao,
        diasAposAnterior: intervalo,
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

  // Cada etapa cai o seu intervalo depois da anterior: o offset do evento é
  // a soma dos intervalos até ele.
  const totais = diasAcumulados(passos)

  const MINUTOS_POR_DIA = 1440
  const indiceEntrega = passos.findIndex((passo) =>
    ['SAIU_PARA_ENTREGA', 'TENTATIVA_FRUSTRADA'].includes(passo.codigo) ||
    passo.codigo.startsWith('TENTATIVA_ENTREGA_'),
  )

  /*
    Os nós de deslocamento acontecem no meio do caminho, não na cidade de
    quem enviou. Um envio do Ceará para o Rio Grande do Sul que "transfere"
    duas vezes dentro de Fortaleza não convence ninguém que acompanha o
    rastreio; passar por Recife e São Paulo, sim.

    Só os de deslocamento: as etapas de preparo continuam na origem, e da
    saída para entrega em diante tudo acontece na cidade de destino.
  */
  const indicesEmTransito = passos
    .map((passo, indice) => ({ passo, indice }))
    .filter(
      ({ passo, indice }) =>
        ehDeslocamento(passo.codigo) && (indiceEntrega < 0 || indice < indiceEntrega),
    )
    .map(({ indice }) => indice)

  const escalas = escalasDaRota(origem, destino, indicesEmTransito.length)
  const escalaPorIndice = new Map<number, { cidade: string; uf: string }>()

  /*
    Menos escalas que nós de trânsito é o caso comum — o percurso desenhado
    costuma ter mais paradas do que a geografia justifica. As escalas ficam
    com os últimos nós, e os primeiros seguem na origem: a encomenda demora a
    sair da cidade e depois avança, que é a ordem natural.
  */
  const primeiroComEscala = indicesEmTransito.length - escalas.length
  escalas.forEach((escala, i) => {
    escalaPorIndice.set(indicesEmTransito[primeiroComEscala + i]!, escala)
  })

  return passos.map((passo, indice) => {
    const noDestino = indiceEntrega >= 0 && indice >= indiceEntrega
    const local = noDestino ? destino : (escalaPorIndice.get(indice) ?? origem)

    /*
      De onde para onde, quando o nó é um deslocamento que de fato leva a
      algum lugar novo. Num trecho curto, sem escala, os três nós de trânsito
      diriam todos "de Santos para Campinas" — repetição que não informa
      nada; ali só o último anuncia o destino.
    */
    const ehTransito = ehDeslocamento(passo.codigo)
    const proximaParada =
      ehTransito && !noDestino && (escalaPorIndice.has(indice) || ehUltimoTransito(indice))
        ? proximoLocal(indice)
        : null

    return {
      sequencia: indice + 1,
      offsetMinutos: Math.round(totais[indice]! * MINUTOS_POR_DIA),
      codigo: passo.codigo,
      titulo: passo.titulo,
      descricao: passo.descricao,
      unidadeOrigem: ehTransito ? unidadeTratamento(local) : null,
      unidadeDestino: proximaParada ? unidadeTratamento(proximaParada) : null,
      cidade: local.cidade,
      uf: local.uf,
    }
  })

  /** Se é o último nó de deslocamento antes da entrega. */
  function ehUltimoTransito(indice: number): boolean {
    return indicesEmTransito[indicesEmTransito.length - 1] === indice
  }

  /** Onde a encomenda estará depois deste nó: a próxima escala, ou o destino. */
  function proximoLocal(indice: number): { cidade: string; uf: string } {
    for (let i = indice + 1; i < passos.length; i += 1) {
      const escala = escalaPorIndice.get(i)
      if (escala) return escala
    }
    return destino
  }
}

/** Nós que representam a encomenda andando, e não parada em algum lugar. */
function ehDeslocamento(codigo: string): boolean {
  return codigo === 'TRANSFERENCIA' || codigo === 'TRANSFERENCIA_FILIAL'
}

/** Ligação entre dois nós, pelos ids das instâncias. */
export type ConexaoTemplate = { de: string; para: string }

/**
 * Ordena os passos seguindo as conexões desenhadas no canvas.
 *
 * As conexões não são enfeite: elas definem a ordem do percurso. Sem isso a
 * ordem viria do array e desenhar uma seta não mudaria nada — o canvas
 * mostraria uma coisa e a timeline entregaria outra.
 *
 * Ordenação topológica com empate resolvido pelo dia, e depois pela posição
 * original. Nó sem conexão nenhuma não é erro: ele entra na ordem pelo dia,
 * que é o que determina quando o evento aparece de fato.
 *
 * Ciclo é erro: um percurso que volta para trás não tem ordem possível, e
 * aceitar em silêncio produziria uma timeline arbitrária.
 */
export function ordenarPorConexoes(
  passos: readonly PassoTemplate[],
  conexoes: readonly ConexaoTemplate[],
): PassoTemplate[] {
  if (conexoes.length === 0) return [...passos]

  const porId = new Map(passos.map((passo, indice) => [passo.id ?? `sem-id-${indice}`, passo]))
  const grauEntrada = new Map<string, number>()
  const saidas = new Map<string, string[]>()

  for (const id of porId.keys()) {
    grauEntrada.set(id, 0)
    saidas.set(id, [])
  }

  for (const conexao of conexoes) {
    if (!porId.has(conexao.de) || !porId.has(conexao.para)) continue
    saidas.get(conexao.de)!.push(conexao.para)
    grauEntrada.set(conexao.para, (grauEntrada.get(conexao.para) ?? 0) + 1)
  }

  const posicaoOriginal = new Map(
    passos.map((passo, indice) => [passo.id ?? `sem-id-${indice}`, indice]),
  )

  /*
    Empate entre nós prontos resolve-se pela posição original, e não mais pelo
    dia. Com intervalos, o número de um nó só significa alguma coisa depois de
    saber quem vem antes dele — ordenar por ele seria circular.
  */
  const criterio = (a: string, b: string): number =>
    (posicaoOriginal.get(a) ?? 0) - (posicaoOriginal.get(b) ?? 0)

  const prontos = [...grauEntrada.entries()]
    .filter(([, grau]) => grau === 0)
    .map(([id]) => id)
    .sort(criterio)

  const ordenados: PassoTemplate[] = []

  while (prontos.length > 0) {
    const id = prontos.shift()!
    ordenados.push(porId.get(id)!)

    for (const seguinte of saidas.get(id) ?? []) {
      const restante = (grauEntrada.get(seguinte) ?? 0) - 1
      grauEntrada.set(seguinte, restante)
      if (restante === 0) {
        prontos.push(seguinte)
        prontos.sort(criterio)
      }
    }
  }

  if (ordenados.length !== passos.length) {
    throw new ValorInvalidoError(
      'As conexões formam um ciclo: há um caminho que volta para um nó anterior. Remova uma das ligações.',
    )
  }

  return ordenados
}

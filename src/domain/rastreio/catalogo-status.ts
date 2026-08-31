import { ValorInvalidoError } from '../errors'
import type { StatusShipment } from '../shipment/estados'
import type { CenarioSimulacao } from '../simulacao/tipos'

/**
 * Catálogo de status de rastreio personalizável por conta.
 *
 * Até aqui, título e descrição de cada evento eram constantes no motor de
 * simulação. Aqui viram dado, para que cada conta escreva a linguagem que o
 * destinatário dela lê — e crie etapas próprias no meio do roteiro.
 *
 * A resolução é uma sobreposição: o catálogo padrão da plataforma serve de
 * base e as linhas da conta cobrem só o que ela personalizou. Assim,
 * personalizar uma copy não faz a conta perder as outras dez, e um texto
 * padrão corrigido depois chega a todo mundo que não o sobrescreveu.
 */

/** Uma linha do catálogo, do padrão ou de uma conta. */
export type LinhaStatus = {
  codigo: string
  titulo: string
  descricao: string
  /** Preenchidos só em status criados pela conta, que entram no roteiro. */
  cenario: CenarioSimulacao | null
  fracaoPrazo: number | null
  /**
   * Posição em dias corridos após a emissão, alternativa a `fracaoPrazo`.
   *
   * Preenchida, vence a fração: quem escreveu "2 dias" pediu um número
   * absoluto, e reconvertê-lo em fração do prazo daria posições diferentes em
   * cada serviço — o oposto do que foi pedido. Em um código do roteiro padrão
   * ela **reposiciona** a etapa existente, sem criar uma segunda.
   */
  diasAposEmissao: number | null
  statusResultante: StatusShipment | null
  ativo: boolean
}

/** Etapa extra pronta para ser fundida no roteiro. */
export type EtapaExtra = {
  fracao: number
  /** Quando presente, posiciona a etapa em dias em vez de fração do prazo. */
  dias?: number
  codigo: string
  titulo: string
  descricao: string
  cenario: CenarioSimulacao
  statusResultante: StatusShipment
}

export type CatalogoResolvido = {
  textos: Record<string, { titulo: string; descricao: string }>
  etapasExtras: EtapaExtra[]
  /**
   * Reposicionamento em dias por código, aplicado às etapas que o roteiro já
   * gera sozinho. É o que permite "muda de status a cada X dias" sem
   * reescrever o motor de cenários.
   */
  posicoesDias: Record<string, number>
}

/**
 * Códigos que o motor de simulação já produz sozinho. Uma conta pode
 * reescrever o texto deles, mas não transformá-los em etapa extra — isso
 * duplicaria o evento na timeline.
 */
export const CODIGOS_PADRAO = [
  'ETIQUETA_EMITIDA',
  'POSTADO',
  'TRANSFERENCIA',
  'AGUARDANDO_TRATAMENTO',
  'SAIU_PARA_ENTREGA',
  'TENTATIVA_FRUSTRADA',
  'AGUARDANDO_RETIRADA',
  'ENTREGUE',
  'EXTRAVIADO',
  'DEVOLUCAO_INICIADA',
  'DEVOLVIDO',
] as const

/**
 * Status de envio que encerram a vida do envio na máquina de estados. Um
 * evento intermediário que produzisse um deles travaria a timeline no meio:
 * os eventos seguintes não teriam transição válida a partir dali.
 */
const STATUS_TERMINAIS: readonly StatusShipment[] = ['DELIVERED', 'LOST', 'CANCELLED']

/** Teto da fração do prazo. O cenário DEVOLUCAO já chega a 3,0·P. */
const FRACAO_MAXIMA = 5

/**
 * Teto da posição em dias. Um ano de trânsito não é simulação de transporte,
 * é dedo escorregando na tecla — e um offset absurdo empurraria a timeline
 * inteira para um futuro que ninguém veria.
 */
const DIAS_MAXIMO = 365

/**
 * Converte o nome digitado pelo usuário em um código estável: sem acento,
 * maiúsculas, separado por sublinhado. O código é a chave de sobreposição,
 * então precisa sobreviver a espaços a mais e a diferenças de acentuação.
 */
export function normalizarCodigoStatus(nome: string): string {
  const codigo = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  if (!codigo) {
    throw new ValorInvalidoError(`Nome de status sem caracteres aproveitáveis: ${nome}`)
  }

  return codigo
}

/**
 * Valida um status criado pela conta antes de gravar.
 *
 * A validação acontece aqui, na escrita, e não na geração do roteiro: uma
 * configuração inválida descoberta só na hora de emitir a etiqueta viraria
 * erro no meio de uma compra, longe de quem a criou.
 */
export function validarStatusCustomizado(entrada: {
  codigo: string
  cenario: CenarioSimulacao | null
  fracaoPrazo: number | null
  diasAposEmissao?: number | null
  statusResultante: StatusShipment | null
}): void {
  const { codigo, cenario, fracaoPrazo, statusResultante } = entrada
  const diasAposEmissao = entrada.diasAposEmissao ?? null
  const ehPadrao = (CODIGOS_PADRAO as readonly string[]).includes(codigo)

  if (diasAposEmissao !== null) {
    if (!Number.isFinite(diasAposEmissao) || diasAposEmissao < 0 || diasAposEmissao > DIAS_MAXIMO) {
      throw new ValorInvalidoError(
        `Dias após a emissão deve estar entre 0 e ${DIAS_MAXIMO}, recebido: ${diasAposEmissao}`,
      )
    }
  }

  // Reposicionar um código do roteiro padrão é legítimo e não exige cenário
  // nem status resultante: a etapa já existe no motor, com os dois definidos.
  // O que continua proibido é transformá-la em etapa nova — daí a fração
  // seguir barrada para esses códigos, logo abaixo.
  if (ehPadrao && diasAposEmissao !== null && fracaoPrazo === null) {
    return
  }

  // Sem posição nenhuma, é só uma reescrita de copy: não entra no roteiro e
  // não precisa dos demais campos.
  if (fracaoPrazo === null && diasAposEmissao === null) {
    return
  }

  if (fracaoPrazo !== null) {
    if (!Number.isFinite(fracaoPrazo) || fracaoPrazo <= 0 || fracaoPrazo > FRACAO_MAXIMA) {
      throw new ValorInvalidoError(
        `Fração do prazo deve ser maior que 0 e no máximo ${FRACAO_MAXIMA}, recebida: ${fracaoPrazo}`,
      )
    }
  }

  if (!cenario) {
    throw new ValorInvalidoError('Status que entra no roteiro precisa de um cenário.')
  }

  if (!statusResultante) {
    throw new ValorInvalidoError('Status que entra no roteiro precisa de um status resultante.')
  }

  if (STATUS_TERMINAIS.includes(statusResultante)) {
    throw new ValorInvalidoError(
      `Status resultante ${statusResultante} encerra o envio e não pode vir de um evento intermediário.`,
    )
  }

  if (ehPadrao) {
    throw new ValorInvalidoError(
      `O código ${codigo} já é gerado pelo roteiro padrão; personalize o texto dele, ou mova-o com "dias após a emissão", em vez de criar uma etapa nova.`,
    )
  }
}

function ehEtapaExtra(linha: LinhaStatus): boolean {
  return (
    linha.ativo &&
    !(CODIGOS_PADRAO as readonly string[]).includes(linha.codigo) &&
    (linha.fracaoPrazo !== null || linha.diasAposEmissao !== null) &&
    !!linha.cenario &&
    !!linha.statusResultante
  )
}

/** Ordem de uma etapa extra para o `sort`, em "dias equivalentes" grosseiros. */
function chaveDeOrdem(etapa: EtapaExtra): number {
  return etapa.dias ?? etapa.fracao
}

/**
 * Funde o catálogo padrão com o da conta e devolve o que o motor de
 * simulação precisa: os textos por código e as etapas extras já ordenadas.
 *
 * Linha desativada é ignorada e faz o código voltar ao texto padrão, em vez
 * de sumir da timeline — desligar uma personalização nunca deve apagar um
 * evento que o destinatário já esperava ver.
 */
export function resolverCatalogo(
  padrao: readonly LinhaStatus[],
  daConta: readonly LinhaStatus[],
): CatalogoResolvido {
  const textos: Record<string, { titulo: string; descricao: string }> = {}

  for (const linha of padrao) {
    if (!linha.ativo) continue
    textos[linha.codigo] = { titulo: linha.titulo, descricao: linha.descricao }
  }

  for (const linha of daConta) {
    if (!linha.ativo) continue
    textos[linha.codigo] = { titulo: linha.titulo, descricao: linha.descricao }
  }

  // Etapas novas podem vir do catálogo padrão (criadas pelo administrador,
  // valem para todo mundo) e do catálogo da conta. As da conta vêm depois
  // para que uma linha dela cubra a padrão de mesmo código.
  const extrasPorCodigo = new Map<string, EtapaExtra>()

  for (const linha of [...padrao, ...daConta]) {
    if (!ehEtapaExtra(linha)) continue
    extrasPorCodigo.set(linha.codigo, {
      fracao: linha.fracaoPrazo ?? 0,
      ...(linha.diasAposEmissao !== null ? { dias: linha.diasAposEmissao } : {}),
      codigo: linha.codigo,
      titulo: linha.titulo,
      descricao: linha.descricao,
      cenario: linha.cenario as CenarioSimulacao,
      statusResultante: linha.statusResultante as StatusShipment,
    })
  }

  const etapasExtras = [...extrasPorCodigo.values()].sort(
    (a, b) => chaveDeOrdem(a) - chaveDeOrdem(b),
  )

  // Reposicionamento das etapas que o motor já gera. Vale para qualquer
  // código, padrão ou da conta; para os da conta é redundante com a própria
  // etapa extra, e informá-lo duas vezes não muda o resultado.
  const posicoesDias: Record<string, number> = {}
  for (const linha of [...padrao, ...daConta]) {
    if (!linha.ativo || linha.diasAposEmissao === null) continue
    posicoesDias[linha.codigo] = linha.diasAposEmissao
  }

  return { textos, etapasExtras, posicoesDias }
}

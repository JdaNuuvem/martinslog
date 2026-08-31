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
  statusResultante: StatusShipment | null
  ativo: boolean
}

/** Etapa extra pronta para ser fundida no roteiro. */
export type EtapaExtra = {
  fracao: number
  codigo: string
  titulo: string
  descricao: string
  cenario: CenarioSimulacao
  statusResultante: StatusShipment
}

export type CatalogoResolvido = {
  textos: Record<string, { titulo: string; descricao: string }>
  etapasExtras: EtapaExtra[]
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
  statusResultante: StatusShipment | null
}): void {
  const { codigo, cenario, fracaoPrazo, statusResultante } = entrada

  // Sem fração, é só uma reescrita de copy: não entra no roteiro e não
  // precisa dos demais campos.
  if (fracaoPrazo === null) {
    return
  }

  if (!Number.isFinite(fracaoPrazo) || fracaoPrazo <= 0 || fracaoPrazo > FRACAO_MAXIMA) {
    throw new ValorInvalidoError(
      `Fração do prazo deve ser maior que 0 e no máximo ${FRACAO_MAXIMA}, recebida: ${fracaoPrazo}`,
    )
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

  if ((CODIGOS_PADRAO as readonly string[]).includes(codigo)) {
    throw new ValorInvalidoError(
      `O código ${codigo} já é gerado pelo roteiro padrão; personalize o texto dele em vez de criar uma etapa nova.`,
    )
  }
}

function ehEtapaExtra(linha: LinhaStatus): boolean {
  return linha.ativo && linha.fracaoPrazo !== null && !!linha.cenario && !!linha.statusResultante
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

  const etapasExtras = daConta
    .filter(ehEtapaExtra)
    .map((linha) => ({
      fracao: linha.fracaoPrazo as number,
      codigo: linha.codigo,
      titulo: linha.titulo,
      descricao: linha.descricao,
      cenario: linha.cenario as CenarioSimulacao,
      statusResultante: linha.statusResultante as StatusShipment,
    }))
    .sort((a, b) => a.fracao - b.fracao)

  return { textos, etapasExtras }
}

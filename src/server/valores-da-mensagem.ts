import { prisma } from '@/infra/db/client'

/**
 * Os valores que entram nas `{{variaveis}}` de uma mensagem.
 *
 * Um lugar só, usado pelo SMS e pelo WhatsApp. Antes eram duas cópias quase
 * iguais, e elas já divergiram na prática: o rastreio existia no lado do SMS
 * e faltava no do WhatsApp, então o texto sobre etiqueta emitida saía com
 * `{{codigo_rastreio}}` vazio. Duas funções que precisam concordar acabam
 * discordando — a única correção durável é não ter duas.
 */

/**
 * Só o primeiro nome.
 *
 * "Maria" soa como alguém falando com ela; "Maria Aparecida da Silva Santos"
 * soa como sistema lendo cadastro.
 */
function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? nomeCompleto
}

/** Como cada situação soa para quem está esperando a encomenda. */
const SITUACAO_LEGIVEL: Record<string, string> = {
  PENDING: 'aguardando pagamento',
  RELEASED: 'em preparação',
  GENERATED: 'aguardando postagem',
  POSTED: 'a caminho',
  DELIVERED: 'entregue',
  CANCELLED: 'cancelado',
  LOST: 'em investigação',
}

/**
 * Os produtos, em texto corrido.
 *
 * Recorta em três porque a mensagem é lida no celular, e uma lista de doze
 * itens empurra o link de rastreio para fora da tela — que é justamente o que
 * a pessoa abriu a mensagem para ver.
 */
function descreverProdutos(bruto: unknown): string {
  if (!Array.isArray(bruto)) return ''

  const nomes = bruto
    .map((p) => (p && typeof p === 'object' ? String((p as { nome?: unknown }).nome ?? '') : ''))
    .map((n) => n.trim())
    .filter(Boolean)

  if (nomes.length === 0) return ''
  if (nomes.length <= 3) return nomes.join(', ')
  return `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`
}

export type ItemParaValores = {
  perfil: { nome: string; nomeExibicao: string | null }
  shipmentId: string | null
  pedido: {
    clienteNome: string
    valorCentavos: number
    checkoutUrl: string | null
    externalId?: string | null
    produtos?: unknown
  } | null
}

/**
 * Monta os valores da mensagem.
 *
 * Variável sem valor sai como string vazia, e `compor` limpa a pontuação que
 * sobra — uma mensagem com "seu pedido {{pedido}} foi postado" não pode virar
 * "seu pedido  foi postado" com dois espaços e um buraco.
 */
export async function montarValores(item: ItemParaValores): Promise<Record<string, string>> {
  const base = process.env.APP_URL ?? 'https://app.martinslog.net'

  /*
    O comprador vê `nomeExibicao`; o nome interno é do painel. Quem não
    configurou nada cai no interno, que é melhor do que uma mensagem sem
    remetente nenhum.
  */
  const valores: Record<string, string> = {
    loja: item.perfil.nomeExibicao?.trim() || item.perfil.nome,
  }

  if (item.pedido) {
    valores.cliente = primeiroNome(item.pedido.clienteNome)
    valores.valor = (item.pedido.valorCentavos / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
    valores.link_checkout = item.pedido.checkoutUrl ?? ''
    if (item.pedido.externalId) valores.pedido = item.pedido.externalId
    const produtos = descreverProdutos(item.pedido.produtos)
    if (produtos) valores.produtos = produtos
  }

  if (item.shipmentId) {
    const envio = await prisma.shipment.findUnique({
      where: { id: item.shipmentId },
      select: {
        codigoRastreio: true,
        destinatario: true,
        status: true,
        referenciaExterna: true,
        produtos: true,
        service: { select: { nome: true, prazoBase: true } },
      },
    })

    if (envio?.codigoRastreio) {
      valores.codigo_rastreio = envio.codigoRastreio
      valores.link_rastreio = `${base}/r/${envio.codigoRastreio}`
    }

    if (envio?.status) valores.status = SITUACAO_LEGIVEL[envio.status] ?? ''
    if (envio?.service?.nome) valores.servico = envio.service.nome
    if (envio?.service?.prazoBase) valores.prazo = String(envio.service.prazoBase)

    /*
      O código do pedido do ENVIO só entra se o do pedido não veio antes.
      São o mesmo número em papéis diferentes, e quando os dois existem o do
      pedido é o que a loja mostrou ao comprador na hora da compra.
    */
    if (!valores.pedido && envio?.referenciaExterna) valores.pedido = envio.referenciaExterna
    if (!valores.produtos) {
      const produtos = descreverProdutos(envio?.produtos)
      if (produtos) valores.produtos = produtos
    }

    const destinatario = envio?.destinatario as
      | { nome?: string; cidade?: string; uf?: string }
      | null
    if (!valores.cliente && destinatario?.nome) {
      valores.cliente = primeiroNome(destinatario.nome)
    }
    if (destinatario?.cidade) valores.cidade = destinatario.cidade
    if (destinatario?.uf) valores.uf = destinatario.uf
  }

  return valores
}

/** O catálogo que a tela mostra, para a loja saber o que pode usar. */
export const VARIAVEIS_DISPONIVEIS = [
  { nome: 'loja', descricao: 'Nome da sua marca, como o comprador a conhece' },
  { nome: 'cliente', descricao: 'Primeiro nome de quem comprou' },
  { nome: 'pedido', descricao: 'Código do pedido na sua loja' },
  { nome: 'produtos', descricao: 'O que foi comprado (até três itens)' },
  { nome: 'status', descricao: 'Situação atual: a caminho, entregue…' },
  { nome: 'codigo_rastreio', descricao: 'Código de rastreio dos Correios' },
  { nome: 'link_rastreio', descricao: 'Link da página de rastreio' },
  { nome: 'valor', descricao: 'Valor do pedido, já formatado' },
  { nome: 'prazo', descricao: 'Prazo de entrega em dias' },
  { nome: 'servico', descricao: 'Serviço escolhido: Econômico, Rápido…' },
  { nome: 'cidade', descricao: 'Cidade de entrega' },
  { nome: 'uf', descricao: 'Estado de entrega' },
  { nome: 'link_checkout', descricao: 'Link para concluir a compra não paga' },
] as const

import { prisma } from '@/infra/db/client'
import type { StatusPedido } from '@prisma/client'
import { NaoAutorizadoError, TelefoneInvalidoError } from '@/domain/errors'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { enfileirarMensagem } from '@/server/whatsapp-service'
import { enfileirarSms } from '@/server/sms-service'

/**
 * Pedidos da loja, empurrados por ela pela API pública.
 *
 * A plataforma só conhecia envios, e envio só nasce depois do pagamento — o
 * que torna impossível falar com quem **não** pagou, que é justamente a venda
 * que ainda dá para salvar. Este serviço é o pedido antes disso.
 *
 * O par (perfil, `externalId`) é único no banco. É deliberado e é a correção
 * de um erro conhecido: a API de envios não tem trava de idempotência, e a
 * deduplicação sobra para o integrador. Aqui, repetir a chamada com o mesmo
 * `externalId` atualiza o pedido em vez de criar outro.
 */

export type EntradaPedido = {
  externalId: string
  status?: StatusPedido
  clienteNome: string
  clienteFone: string
  clienteEmail?: string | null
  valorCentavos?: number
  produtos?: unknown[]
  checkoutUrl?: string | null
  /** O comprovante que o comprador mandou: endereço http ou URI de dados. */
  comprovante?: string | null
  comprovanteEm?: Date | null
  /**
   * Quando o pedido nasceu NA LOJA, e quando o pagamento entrou lá.
   *
   * Existem para a importação do histórico. Sem elas, todo pedido importado
   * apareceria criado no instante da importação, e a lista viraria uma parede
   * de "hoje" — perdendo exatamente a informação que faz o histórico valer.
   */
  criadoEm?: Date | null
  pagoEm?: Date | null
  /**
   * Avisar o comprador na mudança de status. Padrão: avisa.
   *
   * A importação de histórico manda `false`. Sem essa trava, trazer meses de
   * pedidos anteriores avisaria "pagamento confirmado" a milhares de pessoas
   * que compraram semanas atrás — mensagem cobrada, sem sentido para quem
   * recebe, e um envio em massa não solicitado do ponto de vista da operadora.
   */
  notificarCliente?: boolean
}

export type PedidoSalvo = {
  id: string
  external_id: string
  status: StatusPedido
  criado: boolean
  /** O que aconteceu com a notificação, para o integrador não adivinhar. */
  mensagem: string
}

/**
 * Grava ou atualiza o pedido e, quando o status muda, enfileira a mensagem.
 *
 * A mensagem só sai na **mudança** de status, nunca em toda chamada: uma loja
 * que sincroniza os pedidos de dez em dez minutos mandaria a mesma confirmação
 * de pagamento a cada ciclo, e o comprador bloquearia o número — que custa à
 * loja muito mais do que a venda daquele pedido.
 */
export async function registrarPedido(
  perfilId: string,
  entrada: EntradaPedido,
): Promise<PedidoSalvo> {
  const externalId = entrada.externalId.trim()
  if (!externalId) {
    throw new TelefoneInvalidoError('Informe o identificador do pedido na sua loja (external_id).')
  }

  const fone = normalizarTelefone(entrada.clienteFone)
  if (!fone) {
    throw new TelefoneInvalidoError(
      `Telefone inválido: "${entrada.clienteFone}". Use DDD e número, com ou sem máscara.`,
    )
  }

  const status = entrada.status ?? 'PENDENTE'
  const agora = new Date()

  const anterior = await prisma.pedido.findUnique({
    where: { perfilId_externalId: { perfilId, externalId } },
  })

  const dados = {
    status,
    clienteNome: entrada.clienteNome.trim(),
    clienteFone: fone,
    clienteEmail: entrada.clienteEmail?.trim() || null,
    valorCentavos: entrada.valorCentavos ?? 0,
    produtos: (entrada.produtos ?? []) as never,
    checkoutUrl: entrada.checkoutUrl?.trim() || null,
    /*
      O comprovante só é sobrescrito quando vem de fato. Uma sincronização que
      não carrega o campo não pode apagar a prova que já estava aqui.
    */
    ...(entrada.comprovante ? { comprovante: entrada.comprovante } : {}),
    ...(entrada.comprovanteEm ? { comprovanteEm: entrada.comprovanteEm } : {}),
    /*
      A data do pagamento vem da LOJA quando ela informa; só cai no relógio
      daqui quando ela não sabe dizer. Carimbar `agora` num pedido pago há três
      semanas mentiria sobre quando o dinheiro entrou.
    */
    ...(status === 'PAGO' && !anterior?.pagoEm
      ? { pagoEm: entrada.pagoEm ?? agora }
      : {}),
    ...(status === 'CANCELADO' && !anterior?.canceladoEm ? { canceladoEm: agora } : {}),
    /*
      A decisão de não perseguir vive no PEDIDO, não na requisição.

      `notificarCliente` decidia só se ESTA chamada avisava, e morria aqui. A
      régua de recuperação não olha nada disso — varre pendente por idade e
      cria mensagem direto. Bastava uma regra ativa para milhares de "conclua
      sua compra" saírem para quem abandonou o carrinho semanas atrás.

      Só grava quando é para NÃO perseguir: uma sincronização posterior do
      mesmo pedido não pode reabilitar a cobrança que a importação desligou.
    */
    ...(entrada.notificarCliente === false ? { recuperavel: false } : {}),
  }

  const pedido = anterior
    ? await prisma.pedido.update({ where: { id: anterior.id }, data: dados })
    : await prisma.pedido.create({
        data: {
          perfilId,
          externalId,
          ...dados,
          // Só na CRIAÇÃO: a data de nascimento de um pedido não muda depois,
          // e deixá-la editável faria uma sincronização reescrever o histórico.
          ...(entrada.criadoEm ? { criadoEm: entrada.criadoEm } : {}),
        },
      })

  const mudouStatus = !anterior || anterior.status !== status
  if (!mudouStatus) {
    return {
      id: pedido.id,
      external_id: externalId,
      status,
      criado: !anterior,
      mensagem: 'Pedido atualizado. Status não mudou, nenhuma mensagem enviada.',
    }
  }

  /*
    `PENDENTE` não dispara nada aqui: quem cutuca quem não pagou é a régua de
    recuperação, no tempo que o lojista configurou. Mandar na hora seria
    escrever "você esqueceu de pagar" para alguém que ainda está com o PIX
    aberto na outra aba.
  */
  if (status !== 'PAGO') {
    return {
      id: pedido.id,
      external_id: externalId,
      status,
      criado: !anterior,
      mensagem:
        status === 'PENDENTE'
          ? 'Pedido registrado. A recuperação cuidará dele se o pagamento não vier.'
          : 'Pedido cancelado. Nenhuma mensagem enviada.',
    }
  }

  /*
    A importação de histórico grava e não avisa ninguém. Ver `notificarCliente`
    em `EntradaPedido`: o padrão é avisar, e quem importa escreve o contrário
    de propósito.
  */
  if (entrada.notificarCliente === false) {
    return {
      id: pedido.id,
      external_id: externalId,
      status,
      criado: !anterior,
      mensagem: 'Pedido gravado sem avisar o comprador, como pedido.',
    }
  }

  const aviso = await avisarPagamento(perfilId, fone, pedido.id)

  return {
    id: pedido.id,
    external_id: externalId,
    status,
    criado: !anterior,
    mensagem: aviso,
  }
}

/**
 * Avisa o comprador de que o pagamento entrou — por TODO canal configurado.
 *
 * Antes, este caminho chamava só o WhatsApp. E o WhatsApp exige uma conta
 * verificada na Meta, que ainda não existe: a função devolvia `sem-whatsapp` e
 * ninguém era avisado — nem por WhatsApp, nem por SMS. Medido em produção
 * antes da correção: 561 pedidos pagos da Loja PG e 28 SMS. Os 28 tinham vindo
 * de outro caminho (o envio pago), não deste.
 *
 * Os dois canais são tentados de forma independente, e um não derruba o outro:
 * o SMS existe justamente para funcionar enquanto o WhatsApp não existe, e
 * fazer a falta de um calar o outro é repetir o defeito ao contrário.
 */
async function avisarPagamento(
  perfilId: string,
  fone: string,
  pedidoId: string,
): Promise<string> {
  const [sms, whats] = await Promise.allSettled([
    enfileirarSms({ perfilId, evento: 'PEDIDO_PAGO', para: fone, pedidoId, valores: {} }),
    enfileirarMensagem({ perfilId, evento: 'PEDIDO_PAGO', para: fone, pedidoId, valores: {} }),
  ])

  const canais: string[] = []
  if (sms.status === 'fulfilled' && (sms.value === 'enfileirada' || sms.value === 'repetida')) {
    canais.push('SMS')
  }
  if (
    whats.status === 'fulfilled' &&
    (whats.value === 'enfileirada' || whats.value === 'repetida')
  ) {
    canais.push('WhatsApp')
  }

  if (canais.length > 0) {
    return `Confirmação de pagamento na fila de envio (${canais.join(' e ')}).`
  }

  /*
    Nenhum canal aceitou. O integrador precisa saber POR QUE — "pedido salvo" e
    ponto final foi o que deixou este defeito invisível por dias.
  */
  const motivo = sms.status === 'fulfilled' ? sms.value : 'erro'
  switch (motivo) {
    case 'sem-rastreio':
      /*
        Não é falha, e dizer "não avisei" seria mentira: o texto de pagamento
        confirmado é sobre o link de rastreio, que nasce com o ENVIO. A
        mensagem sai de lá, com o código, segundos depois.
      */
      return 'Pedido salvo. O aviso com o código de rastreio sai quando a etiqueta for gerada.'
    case 'sem-template':
      return 'Pedido salvo. Não há mensagem configurada para pagamento confirmado.'
    case 'telefone-invalido':
      return 'Pedido salvo, mas o telefone informado não é válido.'
    default:
      return 'Pedido salvo. Nenhum canal de aviso está configurado para esta loja.'
  }
}

export async function consultarPedido(perfilId: string, externalId: string) {
  const pedido = await prisma.pedido.findUnique({
    where: { perfilId_externalId: { perfilId, externalId } },
    include: {
      mensagens: {
        select: { evento: true, status: true, erro: true, enviadaEm: true, criadoEm: true },
        orderBy: { criadoEm: 'desc' },
      },
    },
  })
  if (!pedido) throw new NaoAutorizadoError('Pedido não encontrado.')
  return pedido
}

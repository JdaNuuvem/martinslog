import { prisma } from '@/infra/db/client'
import type { StatusPedido } from '@prisma/client'
import { ArquivoInvalidoError, NaoAutorizadoError } from '@/domain/errors'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { enfileirarMensagem } from '@/server/whatsapp-service'

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
    throw new ArquivoInvalidoError('Informe o identificador do pedido na sua loja (external_id).')
  }

  const fone = normalizarTelefone(entrada.clienteFone)
  if (!fone) {
    throw new ArquivoInvalidoError(
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
    ...(status === 'PAGO' && !anterior?.pagoEm ? { pagoEm: agora } : {}),
    ...(status === 'CANCELADO' && !anterior?.canceladoEm ? { canceladoEm: agora } : {}),
  }

  const pedido = anterior
    ? await prisma.pedido.update({ where: { id: anterior.id }, data: dados })
    : await prisma.pedido.create({ data: { perfilId, externalId, ...dados } })

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

  const resultado = await enfileirarMensagem({
    perfilId,
    evento: 'PEDIDO_PAGO',
    para: fone,
    pedidoId: pedido.id,
    valores: {},
  })

  return {
    id: pedido.id,
    external_id: externalId,
    status,
    criado: !anterior,
    mensagem: explicar(resultado),
  }
}

function explicar(resultado: Awaited<ReturnType<typeof enfileirarMensagem>>): string {
  switch (resultado) {
    case 'enfileirada':
      return 'Confirmação de pagamento na fila de envio.'
    case 'sem-whatsapp':
      return 'Pedido salvo. O WhatsApp deste perfil não está conectado.'
    case 'sem-template':
      return 'Pedido salvo. Não há mensagem configurada para pagamento confirmado.'
    case 'telefone-invalido':
      return 'Pedido salvo, mas o telefone não serve para WhatsApp.'
    case 'repetida':
      return 'Pedido salvo. A confirmação já tinha sido enviada.'
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

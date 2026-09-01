import { prisma } from '@/infra/db/client'

/**
 * A régua de recuperação: cobrar de volta quem deixou o pagamento pela metade.
 *
 * O desenho é uma lista de regras por perfil, cada uma com um atraso — 15
 * minutos, 2 horas, 24 horas. A cada rodada, todo pedido pendente que já passou
 * do atraso de uma regra e ainda não recebeu a mensagem daquela regra entra na
 * fila.
 *
 * A trava contra repetir é o índice único do banco (`regraId` entra na chave),
 * e não uma verificação em código: duas rodadas simultâneas leriam a mesma
 * lista antes de qualquer uma gravar, e a checagem em código perderia a corrida
 * exatamente no caso que ela existe para cobrir.
 */

/**
 * Idade máxima de um pedido para ainda valer cobrança.
 *
 * Existe para impedir o acidente mais caro deste recurso: criar uma regra hoje
 * e, na primeira rodada, disparar para todo pedido pendente que já existe na
 * base — meses de gente que nunca comprou recebendo cobrança de uma compra que
 * não lembra. Do ponto de vista da Meta isso é um envio em massa não
 * solicitado, e o castigo cai sobre o número da loja.
 *
 * Sete dias é generoso para o propósito real e curto o bastante para que uma
 * regra nova nunca alcance histórico antigo.
 */
export const IDADE_MAXIMA_HORAS = 7 * 24

export type ResultadoRecuperacao = {
  enfileiradas: number
  jaEnfileiradas: number
  regrasAtivas: number
}

/**
 * Uma rodada da régua.
 *
 * Quem chama é o agendador, como nas outras filas. Enquanto ninguém chamar,
 * nada dispara — e nada se perde, porque a decisão é recalculada a cada rodada
 * a partir do estado do pedido.
 */
export async function dispararRecuperacoes(agora = new Date()): Promise<ResultadoRecuperacao> {
  const regras = await prisma.regraRecuperacao.findMany({
    where: { ativo: true, template: { ativo: true } },
    include: { template: { select: { id: true, canal: true, evento: true } } },
  })

  const limiteDeIdade = new Date(agora.getTime() - IDADE_MAXIMA_HORAS * 60 * 60 * 1000)

  let enfileiradas = 0
  let jaEnfileiradas = 0

  for (const regra of regras) {
    const venceuEm = new Date(agora.getTime() - regra.atrasoMinutos * 60 * 1000)

    const pedidos = await prisma.pedido.findMany({
      where: {
        perfilId: regra.perfilId,
        status: 'PENDENTE',
        criadoEm: { lte: venceuEm, gte: limiteDeIdade },
        // Sem telefone não há para onde mandar.
        clienteFone: { not: '' },
      },
      select: { id: true, clienteFone: true },
      take: 200,
    })

    for (const pedido of pedidos) {
      try {
        await prisma.mensagemEnvio.create({
          data: {
            perfilId: regra.perfilId,
            canal: regra.template.canal,
            templateId: regra.template.id,
            pedidoId: pedido.id,
            evento: regra.template.evento,
            para: pedido.clienteFone,
            regraId: regra.id,
            proximaTentativaEm: agora,
          },
        })
        enfileiradas++
      } catch (erro) {
        /*
          P2002 é o caminho normal, não exceção: a rodada anterior já cobriu
          este pedido nesta regra. É assim que a régua não repete.
        */
        if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') {
          jaEnfileiradas++
          continue
        }
        throw erro
      }
    }
  }

  return { enfileiradas, jaEnfileiradas, regrasAtivas: regras.length }
}

/**
 * Cancela o que ficou obsoleto entre a fila e o envio.
 *
 * O pedido pode ter sido pago depois de a cobrança entrar na fila. Mandar
 * "conclua sua compra" para quem acabou de pagar é pior do que não mandar nada:
 * o comprador acha que o pagamento não passou e ou paga de novo, ou abre
 * reclamação.
 *
 * Roda antes de cada disparo, e não no lugar dele: quanto mais perto do envio a
 * decisão for tomada, menor a janela em que o pagamento passa despercebido.
 */
export async function cancelarCobrancasDePedidoResolvido(): Promise<number> {
  const { count } = await prisma.mensagemEnvio.updateMany({
    where: {
      status: 'PENDENTE',
      regraId: { not: null },
      pedido: { status: { in: ['PAGO', 'CANCELADO'] } },
    },
    data: {
      status: 'DESISTIU',
      erro: 'Pedido deixou de estar pendente antes do envio.',
      proximaTentativaEm: null,
    },
  })
  return count
}

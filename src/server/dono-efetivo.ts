import type { PapelUser } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Em nome de quem esta ação acontece.
 *
 * As telas de etiquetas e rastreio passaram a mostrar TODAS as lojas para o
 * administrador. As ações não acompanharam: abrir os detalhes, cancelar e
 * avançar continuavam checando `envio.userId !== userId` e devolvendo "envio
 * não encontrado" — o admin via novecentas linhas e conseguia operar as quatro
 * que por acaso eram dele.
 *
 * Uma lista cheia de botões que respondem "não encontrado" é pior do que não
 * ter a lista: ela promete uma ação e a nega depois do clique.
 *
 * Para o lojista devolve o próprio id, e a checagem de posse lá dentro continua
 * valendo exatamente como antes — a permissão não foi afrouxada, foi resolvida
 * antes. Para o administrador devolve o dono do envio, e quem PEDIU fica na
 * auditoria de quem chamou.
 *
 * Envio inexistente devolve o id da sessão de propósito: a função lá dentro vai
 * recusar com "não encontrado", que é a resposta certa e a mesma que um
 * estranho receberia. Decidir aqui abriria um segundo lugar onde a permissão
 * mora.
 */
export async function donoEfetivo(
  sessao: { userId: string; papel: PapelUser },
  shipmentId: string,
): Promise<string> {
  if (sessao.papel !== 'ADMIN') return sessao.userId

  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { userId: true },
  })

  return envio?.userId ?? sessao.userId
}

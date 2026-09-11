import { prisma } from '@/infra/db/client'
import { dentroDoSilencio, horaLocal, proximaJanela } from '@/domain/mensagem/silencio'

/**
 * As duas perguntas que vêm antes de qualquer mensagem sair.
 *
 * Um lugar só, chamado pelo SMS e pelo WhatsApp. A lição do `valoresDe` é
 * recente: duas cópias que precisam concordar acabam discordando, e a que
 * discorda em silêncio é a que manda a mensagem que não devia.
 *
 * A decisão de horário mora em `domain/mensagem/silencio` porque a tela
 * também precisa dela, e este módulo carrega o Prisma.
 */

export type Impedimento =
  /** A pessoa pediu para não receber mais. */
  | { pode: false; motivo: 'nao-perturbe' }
  /** Está de madrugada; a mensagem espera em vez de morrer. */
  | { pode: false; motivo: 'silencio'; tentarEm: Date }
  | { pode: true }

/**
 * Pode mandar para este número, agora?
 *
 * A diferença entre os dois "não" é o que quem chama faz depois: quem pediu
 * para parar nunca mais recebe, e insistir seria desrespeitar o pedido; a
 * janela de silêncio é só uma espera, e desistir ali faria o comprador nunca
 * saber que o pedido dele foi postado de madrugada.
 */
export async function podeEnviar(
  perfilId: string,
  contato: string,
  agora = new Date(),
): Promise<Impedimento> {
  const [bloqueio, loja] = await Promise.all([
    prisma.naoPerturbe.findUnique({
      where: { perfilId_contato: { perfilId, contato } },
      select: { id: true },
    }),
    prisma.perfil.findUnique({
      where: { id: perfilId },
      select: { silencioAtivo: true, silencioInicioHora: true, silencioFimHora: true },
    }),
  ])

  if (bloqueio) return { pode: false, motivo: 'nao-perturbe' }

  if (loja?.silencioAtivo) {
    const hora = horaLocal(agora)
    if (dentroDoSilencio(hora, loja.silencioInicioHora, loja.silencioFimHora)) {
      return {
        pode: false,
        motivo: 'silencio',
        tentarEm: proximaJanela(agora, loja.silencioFimHora),
      }
    }
  }

  return { pode: true }
}

/** Registra o pedido de parada. Idempotente: pedir duas vezes não dá erro. */
export async function registrarNaoPerturbe(entrada: {
  perfilId: string
  contato: string
  origem?: 'CLIENTE' | 'LOJA'
  motivo?: string | null
}): Promise<void> {
  await prisma.naoPerturbe.upsert({
    where: { perfilId_contato: { perfilId: entrada.perfilId, contato: entrada.contato } },
    create: {
      perfilId: entrada.perfilId,
      contato: entrada.contato,
      origem: entrada.origem ?? 'CLIENTE',
      motivo: entrada.motivo ?? null,
    },
    update: {},
  })
}

export { dentroDoSilencio, horaLocal, pediuParaParar } from '@/domain/mensagem/silencio'

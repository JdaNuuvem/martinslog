import { prisma } from '@/infra/db/client'
import { obterStatusPorCodigo } from '@/server/status-rastreio-service'
import { derivarStatusVisivel } from '@/server/status-derivado'
import type { EnvioResumo, FiltroEnvios } from '@/lib/meus-envios-schema'

/** Status em que o envio ainda não chegou ao destino. */
const PENDENTES = ['PENDING', 'RELEASED', 'GENERATED', 'POSTED'] as const

/**
 * Lista os envios do usuário para a tela de rastreio.
 *
 * O status vem do último evento **já ocorrido**, não do campo persistido: a
 * timeline é gerada inteira na emissão, com eventos datados no futuro, e o
 * campo do envio só é atualizado na próxima sincronização. Derivar aqui faz
 * a lista concordar com a timeline que o cliente vê ao abrir o envio — duas
 * telas discordando sobre o mesmo envio é pior que uma desatualizada.
 *
 * A filtragem por aba acontece depois dessa derivação, pelo mesmo motivo.
 */
export async function listarMeusEnvios(
  userId: string,
  filtro: FiltroEnvios = 'todos',
  agora: Date = new Date(),
): Promise<{ envios: EnvioResumo[]; contagem: Record<FiltroEnvios, number> }> {
  // Etapas que a própria conta criou. Sem elas, um evento com código
  // customizado não teria status correspondente. Para quem nunca
  // personalizou nada volta vazio, e nada muda.
  const statusPorCodigo = await obterStatusPorCodigo(userId)

  const envios = await prisma.shipment.findMany({
    where: { userId },
    include: {
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
        take: 1,
      },
    },
    orderBy: { criadoEm: 'desc' },
  })

  const resumos: EnvioResumo[] = envios.map((envio) => {
    const ultimo = envio.trackingEvents[0]
    const destinatario = envio.destinatario as { nome?: string; cidade?: string; uf?: string }

    return {
      id: envio.id,
      codigoRastreio: envio.codigoRastreio,
      status: derivarStatusVisivel(ultimo?.codigo, envio.status, statusPorCodigo),
      ultimoEvento: ultimo?.titulo ?? null,
      ocorridoEm: ultimo?.ocorridoEm.toISOString() ?? null,
      destinatarioNome: destinatario?.nome ?? 'Destinatário',
      destinoCidade: destinatario?.cidade ?? null,
      destinoUf: destinatario?.uf ?? null,
      servico: envio.service.nome,
      prazoDias: envio.service.prazoBase,
      criadoEm: envio.criadoEm.toISOString(),
    }
  })

  const contagem: Record<FiltroEnvios, number> = {
    todos: resumos.length,
    pendentes: resumos.filter((envio) => ehPendente(envio.status)).length,
    entregues: resumos.filter((envio) => envio.status === 'DELIVERED').length,
  }

  return { envios: resumos.filter((envio) => cabeNoFiltro(envio.status, filtro)), contagem }
}

function ehPendente(status: string): boolean {
  return (PENDENTES as readonly string[]).includes(status)
}

/**
 * Cancelado e extraviado aparecem em "todos", mas em nenhuma das outras
 * abas: não estão a caminho nem foram entregues. Somar as duas abas dá
 * menos que o total, e isso é correto — o contrário seria classificar um
 * envio extraviado como pendente, sugerindo que ainda vai chegar.
 */
function cabeNoFiltro(status: string, filtro: FiltroEnvios): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'entregues') return status === 'DELIVERED'
  return ehPendente(status)
}

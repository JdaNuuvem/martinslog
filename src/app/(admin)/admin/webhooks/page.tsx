import { prisma } from '@/infra/db/client'
import { DispararWebhooks } from '@/components/admin/disparar-webhooks'
import { MAXIMO_TENTATIVAS } from '@/domain/webhook/retentativa'

function formatarData(data: Date): string {
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Estado da fila de entregas, com o disparo manual acima.
 *
 * A listagem mostra as entregas que ainda não saíram, mais recentes
 * primeiro: é onde se vê qual cliente está com endpoint quebrado, e por quê.
 */
export default async function PaginaWebhooks() {
  const [pendentes, entregues, desistidas, fila] = await Promise.all([
    prisma.webhookDelivery.count({
      where: { entregueEm: null, proximaTentativaEm: { not: null } },
    }),
    prisma.webhookDelivery.count({ where: { entregueEm: { not: null } } }),
    prisma.webhookDelivery.count({ where: { entregueEm: null, proximaTentativaEm: null } }),
    prisma.webhookDelivery.findMany({
      where: { entregueEm: null },
      include: { webhookApp: { select: { url: true, ativo: true } } },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    }),
  ])

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Webhooks</h1>
        <p className="text-sm text-texto-secundario">
          {pendentes} na fila · {entregues} entregues · {desistidas} desistidas
        </p>
      </div>

      <DispararWebhooks />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Entregas não concluídas</h2>

        {fila.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhuma entrega pendente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-xs uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Evento</th>
                  <th scope="col" className="py-2 pr-4">Destino</th>
                  <th scope="col" className="py-2 pr-4">Tentativas</th>
                  <th scope="col" className="py-2 pr-4">Próxima</th>
                  <th scope="col" className="py-2">Último erro</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {fila.map((entrega) => (
                  <tr key={entrega.id} className="border-t border-borda-campo align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{entrega.evento}</td>
                    <td className="max-w-[16rem] break-all py-2 pr-4 text-xs">
                      {entrega.webhookApp.url}
                      {!entrega.webhookApp.ativo ? (
                        <span className="ml-2 text-texto-secundario">(desativado)</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {entrega.tentativas}/{MAXIMO_TENTATIVAS}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {entrega.proximaTentativaEm ? (
                        formatarData(entrega.proximaTentativaEm)
                      ) : (
                        <span className="text-erro">desistiu</span>
                      )}
                    </td>
                    <td className="max-w-[18rem] break-words py-2 text-xs text-texto-secundario">
                      {entrega.statusHttp ? `HTTP ${entrega.statusHttp}. ` : ''}
                      {entrega.erro ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

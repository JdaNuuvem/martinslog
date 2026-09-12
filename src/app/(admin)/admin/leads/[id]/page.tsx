import Link from 'next/link'
import { notFound } from 'next/navigation'
import { obterLead } from '@/server/admin/consulta-leads'
import { ROTULO_ORIGEM } from '@/lib/leads-schema'
import { RevelarCpf } from '@/components/admin/revelar-cpf'
import { exigirAdminNaPagina } from '@/server/admin/guarda'

export const dynamic = 'force-dynamic'

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function quando(valor: string): string {
  return new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Telefone em E.164 de volta ao formato que se lê: (11) 98888-7777. */
function telefone(bruto: string): string {
  const d = bruto.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return bruto
}

/**
 * Link da origem, para a tela que já existe.
 *
 * `PEDIDO_PAGO`/`PEDIDO_PENDENTE` levam ao filtro de Pedidos pelo telefone do
 * lead — o filtro casa por `externalId`, nome e telefone, não pelo id interno
 * que a origem guarda. `ENVIO` casa pelo `id` exato do envio. `CONVERSA` não
 * tem link: não existe tela de conversa do lado da administração, e
 * `/whatsapp/conversas` é a rota do lojista — o admin veria as próprias
 * conversas, não a do lead.
 */
function linkOrigem(
  origem: { tipo: string; shipmentId: string | null },
  telefoneLead: string | null,
): string | null {
  if ((origem.tipo === 'PEDIDO_PAGO' || origem.tipo === 'PEDIDO_PENDENTE') && telefoneLead) {
    return `/admin/pedidos?busca=${encodeURIComponent(telefoneLead)}`
  }
  if (origem.tipo === 'ENVIO' && origem.shipmentId) {
    return `/admin/envios?busca=${encodeURIComponent(origem.shipmentId)}`
  }
  return null
}

export default async function PaginaLead({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdminNaPagina()
  const { id } = await params

  const lead = await obterLead(id)
  if (!lead) notFound()

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/admin/leads" className="text-sm text-brand-texto underline-offset-2 hover:underline">
          ← Leads
        </Link>
        <h1 className="text-titulo font-bold text-texto-principal">{lead.nome ?? 'Sem nome'}</h1>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">E-mail</dt>
            <dd className="text-texto-principal">{lead.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Telefone</dt>
            <dd className="text-texto-principal">{lead.telefone ? telefone(lead.telefone) : '—'}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">CPF</dt>
            <dd>
              {lead.cpfMascarado ? (
                <RevelarCpf leadId={lead.id} cpfMascarado={lead.cpfMascarado} />
              ) : (
                <span className="text-texto-principal">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Lojas</dt>
            <dd className="text-texto-principal">{lead.lojas.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Pedidos</dt>
            <dd className="text-texto-principal">{lead.totalPedidos}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Envios</dt>
            <dd className="text-texto-principal">{lead.totalEnvios}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Valor total</dt>
            <dd className="text-texto-principal">{reais(lead.valorTotalCentavos)}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Primeiro contato</dt>
            <dd className="text-texto-principal">{quando(lead.primeiroContatoEm)}</dd>
          </div>
          <div>
            <dt className="text-rotulo uppercase text-texto-secundario">Último contato</dt>
            <dd className="text-texto-principal">{quando(lead.ultimoContatoEm)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">Histórico</h2>

        {lead.origens.length === 0 ? (
          <p className="text-corpo text-texto-secundario">Nenhum registro de origem.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lead.origens.map((origem, indice) => {
              const href = linkOrigem(origem, lead.telefone)
              const conteudo = (
                <>
                  <span className="font-medium text-texto-principal">
                    {ROTULO_ORIGEM[origem.tipo as keyof typeof ROTULO_ORIGEM] ?? origem.tipo}
                  </span>
                  {origem.loja ? (
                    <span className="text-texto-secundario"> · {origem.loja}</span>
                  ) : null}
                  <span className="text-texto-secundario"> · {quando(origem.ocorridoEm)}</span>
                  {origem.tipo === 'CONVERSA' && lead.telefone ? (
                    <span className="text-texto-secundario"> · {telefone(lead.telefone)}</span>
                  ) : null}
                </>
              )

              return (
                <li
                  key={`${origem.tipo}-${origem.ocorridoEm}-${indice}`}
                  className="rounded-lg border border-borda p-3 text-dado"
                >
                  {href ? (
                    <Link href={href} className="text-brand-texto underline-offset-2 hover:underline">
                      {conteudo}
                    </Link>
                  ) : (
                    conteudo
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

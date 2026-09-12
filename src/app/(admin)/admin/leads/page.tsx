/* eslint-disable react/jsx-key --
   As células desta lista não são renderizadas como array: `TabelaResponsiva`
   coloca cada uma dentro do próprio `<td>` (ou `<div>`, no celular) e é ali
   que a chave é definida. A regra não enxerga essa indireção e cobra a chave
   no literal, onde ela não teria efeito nenhum. */
import Link from 'next/link'
import type { OrigemLead } from '@prisma/client'
import { listarLeads, type FiltroLeads } from '@/server/admin/consulta-leads'
import { listarLojasComPedido } from '@/server/admin/consulta-pedidos'
import { ORIGENS, ROTULO_ORIGEM, buscaLeadsSchema, paginaLeadsSchema } from '@/lib/leads-schema'
import { dataDoParametro } from '@/lib/filtro-periodo'
import { TabelaResponsiva } from '@/components/admin/tabela-responsiva'
import { exigirAdminNaPagina } from '@/server/admin/guarda'

/**
 * A base de leads — todo comprador que já chegou perto de uma venda, pago ou
 * não, com ou sem conversa. `force-dynamic` pelo mesmo motivo de Pedidos: é
 * lista de gente, e lista de gente servida de cache mostra dado velho para
 * quem está atendendo agora.
 */
export const dynamic = 'force-dynamic'

type Busca = {
  busca?: string
  loja?: string
  origem?: string
  desde?: string
  ate?: string
  pagina?: string
}

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

function origemValida(valor?: string): OrigemLead | undefined {
  return (ORIGENS as readonly string[]).includes(valor ?? '') ? (valor as OrigemLead) : undefined
}

function comParametros(atuais: Busca, mudanca: Partial<Busca>): string {
  const p = new URLSearchParams()
  for (const [chave, valor] of Object.entries({ ...atuais, ...mudanca })) {
    if (valor) p.set(chave, String(valor))
  }
  const query = p.toString()
  return query ? `/admin/leads?${query}` : '/admin/leads'
}

const CAMPO =
  'rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export default async function PaginaLeads({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirAdminNaPagina()
  const parametros = await searchParams

  const filtro: FiltroLeads = {
    busca: buscaLeadsSchema.parse(parametros.busca ?? ''),
    perfilId: parametros.loja || undefined,
    origem: origemValida(parametros.origem),
    desde: dataDoParametro(parametros.desde),
    ate: dataDoParametro(parametros.ate, true),
    pagina: paginaLeadsSchema.parse(parametros.pagina),
  }

  const [resultado, lojas] = await Promise.all([listarLeads(filtro), listarLojasComPedido()])

  const paginas = Math.max(1, Math.ceil(resultado.total / resultado.porPagina))

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Leads</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Todo comprador que já chegou perto de uma venda — pedido pago, pedido abandonado, envio
          ou conversa — vira um registro aqui, mesmo sem nunca ter pagado nada.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-dado sm:flex-none">
          <span className="text-texto-secundario">Nome, e-mail, telefone ou CPF</span>
          <input
            type="search"
            name="busca"
            defaultValue={parametros.busca ?? ''}
            placeholder="Maria ou 11988887777"
            className={`${CAMPO} w-full sm:w-72`}
          />
        </label>

        <label className="flex flex-col gap-1 text-dado">
          <span className="text-texto-secundario">Loja</span>
          <select name="loja" defaultValue={parametros.loja ?? ''} className={CAMPO}>
            <option value="">Todas</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-dado">
          <span className="text-texto-secundario">Origem</span>
          <select name="origem" defaultValue={parametros.origem ?? ''} className={CAMPO}>
            <option value="">Todas</option>
            {ORIGENS.map((origem) => (
              <option key={origem} value={origem}>
                {ROTULO_ORIGEM[origem]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-dado">
          <span className="text-texto-secundario">Desde</span>
          <input type="date" name="desde" defaultValue={parametros.desde ?? ''} className={CAMPO} />
        </label>

        <label className="flex flex-col gap-1 text-dado">
          <span className="text-texto-secundario">Até</span>
          <input type="date" name="ate" defaultValue={parametros.ate ?? ''} className={CAMPO} />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Filtrar
        </button>
        <Link
          href="/admin/leads"
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          {resultado.total.toLocaleString('pt-BR')} lead{resultado.total === 1 ? '' : 's'}
          {paginas > 1 ? ` — página ${resultado.pagina} de ${paginas}` : ''}
        </h2>

        <TabelaResponsiva
          vazio="Nenhum lead com esses filtros."
          colunas={[
            { rotulo: 'Nome', principal: true },
            { rotulo: 'E-mail' },
            { rotulo: 'Telefone' },
            { rotulo: 'CPF' },
            { rotulo: 'Lojas' },
            { rotulo: 'Pedidos' },
            { rotulo: 'Envios' },
            { rotulo: 'Valor total' },
            { rotulo: 'Último contato' },
          ]}
          linhas={resultado.leads.map((lead) => ({
            chave: lead.id,
            celulas: [
              <Link
                href={`/admin/leads/${lead.id}`}
                className="text-brand-texto underline-offset-2 hover:underline"
              >
                {lead.nome ?? '—'}
              </Link>,
              <span className="text-texto-secundario">{lead.email ?? '—'}</span>,
              <span className="text-texto-secundario">
                {lead.telefone ? telefone(lead.telefone) : '—'}
              </span>,
              <span className="text-texto-secundario">{lead.cpfMascarado ?? '—'}</span>,
              <span className="text-texto-secundario">{lead.lojas.join(', ') || '—'}</span>,
              <span className="text-texto-principal">{lead.totalPedidos}</span>,
              <span className="text-texto-principal">{lead.totalEnvios}</span>,
              <span className="text-texto-principal">{reais(lead.valorTotalCentavos)}</span>,
              <span className="text-texto-secundario">{quando(lead.ultimoContatoEm)}</span>,
            ],
          }))}
        />

        {paginas > 1 ? (
          <nav aria-label="Páginas" className="flex items-center gap-3">
            {resultado.pagina > 1 ? (
              <Link
                href={comParametros(parametros, { pagina: String(resultado.pagina - 1) })}
                className="rounded-lg border border-borda-campo px-3 py-1.5 text-sm text-texto-principal"
              >
                Anterior
              </Link>
            ) : null}
            {resultado.pagina < paginas ? (
              <Link
                href={comParametros(parametros, { pagina: String(resultado.pagina + 1) })}
                className="rounded-lg border border-borda-campo px-3 py-1.5 text-sm text-texto-principal"
              >
                Próxima
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  )
}

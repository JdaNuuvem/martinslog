import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { listarAuditoria, listarFacetas, type FiltroAuditoria } from '@/server/admin/auditoria'

type Busca = {
  acao?: string
  entidade?: string
  entidadeId?: string
  de?: string
  ate?: string
  pagina?: string
}

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR')
}

function paraData(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return undefined
  }
  return new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}`)
}

function comParametros(busca: Busca, mudancas: Record<string, string | undefined>): string {
  const parametros = new URLSearchParams()
  for (const [chave, valor] of Object.entries({ ...busca, ...mudancas })) {
    if (valor) {
      parametros.set(chave, valor)
    }
  }
  const query = parametros.toString()
  return query ? `/admin/auditoria?${query}` : '/admin/auditoria'
}

function json(valor: Prisma.JsonValue): string {
  return valor === null || valor === undefined ? '—' : JSON.stringify(valor, null, 2)
}

/**
 * Registro de auditoria: quem fez o quê, quando, com o estado antes e depois.
 *
 * A tela é só de leitura — não há botão de apagar nem de editar, e não existe
 * rota que faça isso. Um log removível pelo painel não responderia à única
 * pergunta que ele existe para responder.
 *
 * O `antes`/`depois` fica dentro de um `<details>` fechado: a lista precisa
 * ser varrível, e o JSON completo de um envio excluído ocuparia a tela
 * inteira em uma linha só.
 */
export default async function PaginaAuditoria({
  searchParams,
}: {
  searchParams: Promise<Busca>
}) {
  const parametros = await searchParams

  const filtro: FiltroAuditoria = {
    acao: parametros.acao || undefined,
    entidade: parametros.entidade || undefined,
    entidadeId: parametros.entidadeId ?? '',
    de: paraData(parametros.de, false),
    ate: paraData(parametros.ate, true),
    pagina: Number(parametros.pagina) || 1,
  }

  const [lista, facetas] = await Promise.all([listarAuditoria(filtro), listarFacetas()])

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Auditoria</h1>
        <p className="text-sm text-texto-secundario">
          Somente leitura. Toda ação que mexe em dinheiro, status ou tabela grava aqui, junto com
          o estado anterior — inclusive as feitas pelo próprio cliente.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl bg-superficie-card p-6"
      >
        <label className="flex w-60 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Ação</span>
          <select
            name="acao"
            defaultValue={parametros.acao ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <option value="">Todas</option>
            {facetas.acoes.map((acao) => (
              <option key={acao} value={acao}>
                {acao}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-48 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Entidade</span>
          <select
            name="entidade"
            defaultValue={parametros.entidade ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <option value="">Todas</option>
            {facetas.entidades.map((entidade) => (
              <option key={entidade} value={entidade}>
                {entidade}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Id da entidade</span>
          <input
            type="search"
            name="entidadeId"
            defaultValue={parametros.entidadeId ?? ''}
            placeholder="id do envio, da carteira, da regra…"
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-texto-secundario">De</span>
          <input
            type="date"
            name="de"
            defaultValue={parametros.de ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Até</span>
          <input
            type="date"
            name="ate"
            defaultValue={parametros.ate ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Filtrar
        </button>
        <Link
          href="/admin/auditoria"
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">
          {lista.total} {lista.total === 1 ? 'registro' : 'registros'}
        </h2>

        {lista.itens.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Nenhum registro corresponde a este filtro.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lista.itens.map((registro) => (
              <li
                key={registro.id}
                className="flex flex-col gap-2 border-t border-borda-campo pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                    {registro.acao}
                  </span>
                  <span className="text-sm text-texto-principal">
                    {registro.entidade} · {registro.entidadeId}
                  </span>
                  <span className="text-xs text-texto-secundario">
                    {dataHora(registro.criadoEm)} · por {registro.atorNome}
                  </span>
                  {registro.entidade === 'Shipment' ? (
                    <Link
                      href={`/admin/simulacao/${registro.entidadeId}`}
                      className="text-xs font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      abrir envio
                    </Link>
                  ) : null}
                  {registro.atorId ? (
                    <Link
                      href={`/admin/usuarios/${registro.atorId}`}
                      className="text-xs font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      abrir ator
                    </Link>
                  ) : null}
                </div>

                <details className="text-sm">
                  <summary className="cursor-pointer text-texto-secundario focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    Antes e depois
                  </summary>
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase text-texto-secundario">Antes</p>
                      <pre className="overflow-x-auto rounded-lg border border-borda-campo p-3 text-xs text-texto-principal">
                        {json(registro.antes)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-texto-secundario">Depois</p>
                      <pre className="overflow-x-auto rounded-lg border border-borda-campo p-3 text-xs text-texto-principal">
                        {json(registro.depois)}
                      </pre>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        {lista.totalPaginas > 1 ? (
          <nav aria-label="Paginação" className="flex items-center gap-4 text-sm">
            {lista.pagina > 1 ? (
              <Link
                href={comParametros(parametros, { pagina: String(lista.pagina - 1) })}
                className="text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                ← Anterior
              </Link>
            ) : null}
            <span className="text-texto-secundario">
              Página {lista.pagina} de {lista.totalPaginas}
            </span>
            {lista.pagina < lista.totalPaginas ? (
              <Link
                href={comParametros(parametros, { pagina: String(lista.pagina + 1) })}
                className="text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Próxima →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  )
}

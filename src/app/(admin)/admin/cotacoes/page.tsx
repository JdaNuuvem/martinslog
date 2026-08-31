import Link from 'next/link'
import { listarCotacoes, type FiltroCotacoes } from '@/server/admin/cotacoes'

type Busca = {
  cep?: string
  de?: string
  ate?: string
  virouEnvio?: string
  pagina?: string
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR')
}

function virouEnvioValido(valor?: string): 'SIM' | 'NAO' | undefined {
  return valor === 'SIM' || valor === 'NAO' ? valor : undefined
}

/**
 * Converte `YYYY-MM-DD` do `<input type="date">` em instante. O fim do
 * período vira 23:59:59 do dia escolhido, e não meia-noite — mesmo motivo
 * de `/admin/envios`.
 */
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
  return query ? `/admin/cotacoes?${query}` : '/admin/cotacoes'
}

/**
 * Listagem de cotações — a única prova do que foi mostrado ao cliente antes
 * de ele fechar (ou não) o envio. Cada cotação mostra as opções congeladas
 * no JSON (`Quote.opcoes`), com preço de balcão e preço final lado a lado,
 * porque é essa comparação que responde "por que o cliente viu R$ 32 e
 * agora vê R$ 41" — a tarifa pode ter mudado depois, mas a cotação não.
 *
 * Inclui as cotações anônimas (`AnonSession`): são a maior parte do funil,
 * e sem elas esta tela mostraria só quem já tinha conta — perdendo
 * justamente onde mais se perde venda.
 */
export default async function PaginaCotacoesAdmin({
  searchParams,
}: {
  searchParams: Promise<Busca>
}) {
  const parametros = await searchParams

  const filtro: FiltroCotacoes = {
    cep: parametros.cep || undefined,
    de: paraData(parametros.de, false),
    ate: paraData(parametros.ate, true),
    virouEnvio: virouEnvioValido(parametros.virouEnvio),
    pagina: Number(parametros.pagina) || 1,
  }

  const lista = await listarCotacoes(filtro)

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Cotações</h1>
        <p className="text-sm text-texto-secundario">
          As opções de cada cotação são as que o cliente viu no momento — a tarifa pode ter
          mudado depois, mas o que está aqui é o que foi mostrado.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-superficie-card p-6">
        <input type="hidden" name="virouEnvio" value={parametros.virouEnvio ?? ''} />

        <label className="flex w-52 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">CEP (origem ou destino)</span>
          <input
            type="search"
            name="cep"
            defaultValue={parametros.cep ?? ''}
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
          href="/admin/cotacoes"
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      <nav aria-label="Filtrar por conversão em envio" className="flex flex-wrap gap-2">
        {(
          [
            { valor: undefined, rotulo: 'Todas' },
            { valor: 'SIM' as const, rotulo: 'Virou envio' },
            { valor: 'NAO' as const, rotulo: 'Não virou envio' },
          ]
        ).map((opcao) => (
          <Link
            key={opcao.rotulo}
            href={comParametros(parametros, { virouEnvio: opcao.valor, pagina: undefined })}
            aria-current={filtro.virouEnvio === opcao.valor ? 'page' : undefined}
            className={`rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              filtro.virouEnvio === opcao.valor
                ? 'bg-brand text-white'
                : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {opcao.rotulo}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">
          {lista.total} {lista.total === 1 ? 'cotação' : 'cotações'}
        </h2>

        {lista.itens.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhuma cotação corresponde a este filtro.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {lista.itens.map((cotacao) => (
              <article
                key={cotacao.id}
                className="flex flex-col gap-3 rounded-lg border border-borda-campo p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-texto-principal">
                      {cotacao.cepOrigem} → {cotacao.cepDestino}
                    </p>
                    <p className="text-xs text-texto-secundario">{dataHora(cotacao.criadoEm)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {cotacao.dono.tipo === 'USUARIO' ? (
                      <Link
                        href={`/admin/usuarios/${cotacao.dono.id}`}
                        className="text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        {cotacao.dono.nome}
                      </Link>
                    ) : (
                      <span className="text-sm text-texto-secundario">Sessão anônima</span>
                    )}

                    {cotacao.virouEnvio ? (
                      <span className="rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                        Virou envio
                      </span>
                    ) : (
                      <span className="rounded-pilula bg-superficie-bloco px-2 py-0.5 text-xs text-texto-secundario">
                        Não virou envio
                      </span>
                    )}

                    {cotacao.expirada ? (
                      <span className="rounded-pilula bg-superficie-bloco px-2 py-0.5 text-xs text-texto-secundario">
                        Expirada
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className="text-xs text-texto-secundario">
                  Peso informado {cotacao.pesoG} g · peso taxável {cotacao.pesoTaxavelG} g ·{' '}
                  {cotacao.altura}×{cotacao.largura}×{cotacao.comprimento} cm ({cotacao.formato})
                </p>

                {cotacao.opcoes.length === 0 ? (
                  <p className="text-sm text-texto-secundario">Nenhuma opção disponível para esta cotação.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <thead className="text-xs uppercase text-texto-secundario">
                        <tr>
                          <th scope="col" className="py-1 pr-4">Serviço</th>
                          <th scope="col" className="py-1 pr-4">Preço de balcão</th>
                          <th scope="col" className="py-1 pr-4">Preço final</th>
                          <th scope="col" className="py-1 pr-4">Prazo</th>
                          <th scope="col" className="py-1">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="text-texto-principal">
                        {cotacao.opcoes.map((opcao) => (
                          <tr key={opcao.servicoId} className="border-t border-borda-campo">
                            <td className="py-1 pr-4">
                              {opcao.servicoNome}
                              <span className="block text-xs text-texto-secundario">
                                {opcao.carrierNome}
                              </span>
                            </td>
                            <td className="py-1 pr-4 text-texto-riscado line-through">
                              {reais(opcao.precoBalcaoCentavos)}
                            </td>
                            <td className="py-1 pr-4 font-medium">{reais(opcao.precoFinalCentavos)}</td>
                            <td className="py-1 pr-4">{opcao.prazoDias} dias</td>
                            <td className="py-1">
                              {opcao.disponivel ? 'Disponível' : opcao.observacao ?? 'Indisponível'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {lista.totalPaginas > 1 ? (
          <nav aria-label="Paginação" className="flex flex-wrap items-center gap-2 pt-2">
            {Array.from({ length: lista.totalPaginas }, (_, indice) => indice + 1).map((numero) => (
              <Link
                key={numero}
                href={comParametros(parametros, { pagina: String(numero) })}
                aria-current={lista.pagina === numero ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  lista.pagina === numero
                    ? 'bg-brand text-white'
                    : 'bg-superficie-bloco text-texto-principal'
                }`}
              >
                {numero}
              </Link>
            ))}
          </nav>
        ) : null}
      </section>
    </>
  )
}

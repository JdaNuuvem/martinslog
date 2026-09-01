import Link from 'next/link'
import type { StatusShipment } from '@prisma/client'
import {
  listarEnviosAdmin,
  listarServicosParaFiltro,
  type FiltroEnviosAdmin,
} from '@/server/admin/consulta-envios'
import { AcoesEtiqueta } from '@/components/admin/acoes-etiqueta'

const STATUS: { valor: StatusShipment; rotulo: string }[] = [
  { valor: 'PENDING', rotulo: 'Pendentes' },
  { valor: 'RELEASED', rotulo: 'Pagos' },
  { valor: 'GENERATED', rotulo: 'Emitidos' },
  { valor: 'POSTED', rotulo: 'Postados' },
  { valor: 'DELIVERED', rotulo: 'Entregues' },
  { valor: 'CANCELLED', rotulo: 'Cancelados' },
  { valor: 'LOST', rotulo: 'Extraviados' },
]

type Busca = {
  status?: string
  busca?: string
  servicoId?: string
  de?: string
  ate?: string
  pagina?: string
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR')
}

function statusValido(valor?: string): StatusShipment | undefined {
  return STATUS.some((item) => item.valor === valor) ? (valor as StatusShipment) : undefined
}

/**
 * Converte `YYYY-MM-DD` do `<input type="date">` em instante.
 *
 * O fim do período vira 23:59:59 do dia escolhido, e não meia-noite: filtrar
 * "até hoje" e não ver nada do próprio dia é o tipo de surpresa que faz
 * alguém concluir que o envio sumiu.
 */
function paraData(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return undefined
  }
  return new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}`)
}

/** Preserva o filtro atual ao trocar de aba ou de página. */
function comParametros(busca: Busca, mudancas: Record<string, string | undefined>): string {
  const parametros = new URLSearchParams()
  for (const [chave, valor] of Object.entries({ ...busca, ...mudancas })) {
    if (valor) {
      parametros.set(chave, valor)
    }
  }
  const query = parametros.toString()
  return query ? `/admin/envios?${query}` : '/admin/envios'
}

/**
 * Listagem global de envios, com filtro por situação, período, serviço e
 * busca livre (código de rastreio, id do envio, nome ou e-mail do dono).
 *
 * Todo o filtro vive na URL, como formulário GET: o recorte é linkável e
 * sobrevive ao recarregar — o que importa em um painel onde alguém cola o
 * endereço dentro de um chamado.
 */
export default async function PaginaEnviosAdmin({
  searchParams,
}: {
  searchParams: Promise<Busca>
}) {
  const parametros = await searchParams

  const filtro: FiltroEnviosAdmin = {
    status: statusValido(parametros.status),
    busca: parametros.busca ?? '',
    servicoId: parametros.servicoId || undefined,
    de: paraData(parametros.de, false),
    ate: paraData(parametros.ate, true),
    pagina: Number(parametros.pagina) || 1,
  }

  const [lista, servicos] = await Promise.all([
    listarEnviosAdmin(filtro),
    listarServicosParaFiltro(),
  ])

  const totalGeral = Object.values(lista.porStatus).reduce((soma, valor) => soma + valor, 0)

  return (
    <>
      <div>
        <h1 className="text-titulo font-bold text-texto-principal">Envios</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Todas as etiquetas da plataforma. Cancelar e excluir daqui fica registrado na auditoria.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-superficie-card p-6">
        {/* A situação vem das abas abaixo, não deste formulário — o campo
            oculto evita que buscar por texto jogue o operador de volta para
            "todos" sem ele pedir. */}
        <input type="hidden" name="status" value={parametros.status ?? ''} />

        <label className="flex min-w-[18rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Código, id do envio, nome ou e-mail do cliente</span>
          <input
            type="search"
            name="busca"
            defaultValue={parametros.busca ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        <label className="flex w-52 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Serviço</span>
          <select
            name="servicoId"
            defaultValue={parametros.servicoId ?? ''}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <option value="">Todos</option>
            {servicos.map((servico) => (
              <option key={servico.id} value={servico.id}>
                {servico.nome}
              </option>
            ))}
          </select>
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
          href="/admin/envios"
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      <nav aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
        <Link
          href={comParametros(parametros, { status: undefined, pagina: undefined })}
          aria-current={filtro.status ? undefined : 'page'}
          className={`rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
            filtro.status ? 'bg-superficie-card text-texto-principal' : 'bg-brand text-white'
          }`}
        >
          Todos ({totalGeral})
        </Link>
        {STATUS.map((item) => (
          <Link
            key={item.valor}
            href={comParametros(parametros, { status: item.valor, pagina: undefined })}
            aria-current={filtro.status === item.valor ? 'page' : undefined}
            className={`rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              filtro.status === item.valor
                ? 'bg-brand text-white'
                : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {item.rotulo} ({lista.porStatus[item.valor]})
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          {lista.total} {lista.total === 1 ? 'envio' : 'envios'}
        </h2>

        {lista.itens.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum envio corresponde a este filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-dado">
              <thead className="text-rotulo uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Criado em</th>
                  <th scope="col" className="py-2 pr-4">Código</th>
                  <th scope="col" className="py-2 pr-4">Situação</th>
                  <th scope="col" className="py-2 pr-4">Cliente</th>
                  <th scope="col" className="py-2 pr-4">Destino</th>
                  <th scope="col" className="py-2 pr-4">Serviço</th>
                  <th scope="col" className="py-2 pr-4">Valor</th>
                  <th scope="col" className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {lista.itens.map((envio) => (
                  <tr key={envio.id} className="border-t border-borda-campo align-top">
                    <td className="py-2 pr-4">{dataHora(envio.criadoEm)}</td>
                    <td className="py-2 pr-4">{envio.codigoRastreio ?? '—'}</td>
                    <td className="py-2 pr-4">{envio.status}</td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/usuarios/${envio.clienteId}`}
                        className="text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        {envio.clienteNome}
                      </Link>
                      <span className="block text-xs text-texto-secundario">
                        {envio.clienteEmail}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {envio.destinatarioNome}
                      <span className="block text-xs text-texto-secundario">
                        {envio.destinoCidadeUf}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{envio.servicoNome}</td>
                    <td className="py-2 pr-4">{reais(envio.precoCobradoCentavos)}</td>
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/admin/simulacao/${envio.id}`}
                          className="text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                        >
                          Simulação
                        </Link>
                        <AcoesEtiqueta shipmentId={envio.id} status={envio.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

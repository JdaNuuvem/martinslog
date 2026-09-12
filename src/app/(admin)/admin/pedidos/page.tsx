/* eslint-disable react/jsx-key --
   As células desta lista não são renderizadas como array: `TabelaResponsiva`
   coloca cada uma dentro do próprio `<td>` (ou `<div>`, no celular) e é ali
   que a chave é definida. A regra não enxerga essa indireção e cobra a chave
   no literal, onde ela não teria efeito nenhum. */
import Link from 'next/link'
import type { StatusPedido } from '@prisma/client'
import {
  listarLojasComPedido,
  listarPedidosAdmin,
  type FiltroPedidos,
} from '@/server/admin/consulta-pedidos'
import { AtualizaSozinho } from '@/components/admin/atualiza-sozinho'
import { TabelaResponsiva } from '@/components/admin/tabela-responsiva'
import { exigirAdminNaPagina } from '@/server/admin/guarda'

/**
 * Todos os pedidos das lojas, em uma tela.
 *
 * Eles chegam por `POST /api/v0/pedidos` e até agora não apareciam em lugar
 * nenhum — nem para a loja, nem para a administração. O pendente é o que mais
 * importa: é a venda que ainda dá para recuperar, e ela estava invisível.
 *
 * A página não guarda cache: `force-dynamic` porque o valor dela é mostrar o
 * agora. Uma lista servida de cache mostra pendente que já foi pago, e quem
 * atende age em cima de informação velha.
 */
export const dynamic = 'force-dynamic'

const STATUS: { valor: StatusPedido; rotulo: string }[] = [
  { valor: 'PENDENTE', rotulo: 'Aguardando pagamento' },
  { valor: 'PAGO', rotulo: 'Pagos' },
  { valor: 'CANCELADO', rotulo: 'Cancelados' },
]

type Busca = {
  status?: string
  busca?: string
  loja?: string
  pagina?: string
  comprovante?: string
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function quando(valor: Date): string {
  return valor.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Telefone em E.164 de volta ao formato que se lê: (11) 98888-7777. */
function telefone(bruto: string): string {
  const d = bruto.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return bruto
}

function statusValido(valor?: string): StatusPedido | undefined {
  return STATUS.some((s) => s.valor === valor) ? (valor as StatusPedido) : undefined
}

function comParametros(atuais: Busca, mudanca: Partial<Busca>): string {
  const p = new URLSearchParams()
  for (const [chave, valor] of Object.entries({ ...atuais, ...mudanca })) {
    if (valor) p.set(chave, String(valor))
  }
  const query = p.toString()
  return query ? `/admin/pedidos?${query}` : '/admin/pedidos'
}

const CAMPO =
  'rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const PILULA =
  'rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirAdminNaPagina()
  const parametros = await searchParams

  const filtro: FiltroPedidos = {
    status: statusValido(parametros.status),
    busca: parametros.busca,
    perfilId: parametros.loja || undefined,
    pagina: Number(parametros.pagina) || 1,
    comComprovante: parametros.comprovante === '1',
  }

  const [lista, lojas] = await Promise.all([listarPedidosAdmin(filtro), listarLojasComPedido()])

  const porStatus = new Map(lista.porStatus.map((s) => [s.status, s.total]))
  const totalGeral = lista.porStatus.reduce((soma, s) => soma + s.total, 0)

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Pedidos</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Tudo que as lojas enviaram, de todas as contas. O pedido nasce aqui quando o comprador
          chega ao pagamento e vira etiqueta quando ele paga.
        </p>
        <AtualizaSozinho segundos={30} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-dado sm:flex-none">
          <span className="text-texto-secundario">Pedido, comprador ou telefone</span>
          <input
            type="search"
            name="busca"
            defaultValue={parametros.busca ?? ''}
            placeholder="PED-… ou Maria ou 11988887777"
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

        {/* O status viaja junto para o filtro de texto não descartar a aba. */}
        {parametros.status ? <input type="hidden" name="status" value={parametros.status} /> : null}

        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Filtrar
        </button>
        <Link
          href="/admin/pedidos"
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      <nav aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
        <Link
          href={comParametros(parametros, { status: undefined, pagina: undefined })}
          aria-current={filtro.status ? undefined : 'page'}
          className={`${PILULA} ${filtro.status ? 'bg-superficie-card text-texto-principal' : 'bg-brand text-white'}`}
        >
          Todos ({totalGeral.toLocaleString('pt-BR')})
        </Link>
        {STATUS.map((item) => (
          <Link
            key={item.valor}
            href={comParametros(parametros, { status: item.valor, pagina: undefined })}
            aria-current={filtro.status === item.valor ? 'page' : undefined}
            className={`${PILULA} ${
              filtro.status === item.valor
                ? 'bg-brand text-white'
                : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {item.rotulo} ({(porStatus.get(item.valor) ?? 0).toLocaleString('pt-BR')})
          </Link>
        ))}

        {/*
          Comprovante é um recorte de OUTRA natureza: não é situação do pedido,
          é "o comprador mandou a prova e alguém precisa olhar". Fica separado
          por isso, e some quando não há nenhum — pílula que sempre marca zero
          vira ruído.
        */}
        {lista.comComprovante > 0 ? (
          <Link
            href={comParametros(parametros, {
              comprovante: parametros.comprovante === '1' ? undefined : '1',
              pagina: undefined,
            })}
            aria-current={parametros.comprovante === '1' ? 'page' : undefined}
            className={`${PILULA} ${
              parametros.comprovante === '1'
                ? 'bg-atencao text-white'
                : 'bg-atencao/10 text-atencao'
            }`}
          >
            Com comprovante ({lista.comComprovante.toLocaleString('pt-BR')})
          </Link>
        ) : null}
      </nav>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          {lista.total.toLocaleString('pt-BR')} pedido{lista.total === 1 ? '' : 's'}
          {lista.paginas > 1 ? ` — página ${lista.pagina} de ${lista.paginas}` : ''}
        </h2>

        <TabelaResponsiva
          vazio="Nenhum pedido com esses filtros."
          colunas={[
            { rotulo: 'Pedido', principal: true },
            { rotulo: 'Loja' },
            { rotulo: 'Comprador' },
            { rotulo: 'Valor' },
            { rotulo: 'Situação' },
            { rotulo: 'Comprovante' },
            { rotulo: 'Rastreio' },
            { rotulo: 'Quando' },
          ]}
          linhas={lista.pedidos.map((p) => ({
            chave: p.id,
            celulas: [
              <>
                <span className="font-medium text-texto-principal">{p.externalId}</span>
                {p.mensagens > 0 ? (
                  <Link
                    href={`/admin/mensagens?busca=${encodeURIComponent(p.clienteFone)}`}
                    className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-rotulo text-brand-texto underline-offset-2 hover:underline"
                  >
                    {p.mensagens} aviso{p.mensagens === 1 ? '' : 's'}
                  </Link>
                ) : null}
              </>,
              <span className="text-texto-secundario">{p.loja}</span>,
              <>
                <span className="text-texto-principal">{p.clienteNome}</span>
                <br />
                <span className="text-texto-secundario">{telefone(p.clienteFone)}</span>
              </>,
              <span className="text-texto-principal">{reais(p.valorCentavos)}</span>,
              <span
                className={`inline-block rounded px-2 py-0.5 text-rotulo ${
                  p.status === 'PAGO'
                    ? 'bg-sucesso/15 text-sucesso'
                    : p.status === 'CANCELADO'
                      ? 'bg-erro/15 text-erro'
                      : 'bg-atencao/15 text-atencao'
                }`}
              >
                {STATUS.find((s) => s.valor === p.status)?.rotulo ?? p.status}
              </span>,
              p.temComprovante ? (
                <a
                  href={`/admin/pedidos/${p.id}/comprovante`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-texto underline underline-offset-2"
                >
                  ver
                </a>
              ) : (
                <span className="text-texto-secundario">—</span>
              ),
              p.codigoRastreio ? (
                <a
                  href={`/r/${p.codigoRastreio}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-texto underline underline-offset-2"
                >
                  {p.codigoRastreio}
                </a>
              ) : (
                <span className="text-texto-secundario">—</span>
              ),
              <span className="text-texto-secundario">
                {quando(p.criadoEm)}
                {p.pagoEm ? (
                  <>
                    <br />
                    <span className="text-sucesso">pago {quando(p.pagoEm)}</span>
                  </>
                ) : null}
              </span>,
            ],
          }))}
        />

        {lista.paginas > 1 ? (
          <nav aria-label="Páginas" className="flex items-center gap-3">
            {lista.pagina > 1 ? (
              <Link
                href={comParametros(parametros, { pagina: String(lista.pagina - 1) })}
                className="rounded-lg border border-borda-campo px-3 py-1.5 text-sm text-texto-principal"
              >
                Anterior
              </Link>
            ) : null}
            {lista.pagina < lista.paginas ? (
              <Link
                href={comParametros(parametros, { pagina: String(lista.pagina + 1) })}
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

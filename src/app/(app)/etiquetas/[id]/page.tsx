import Link from 'next/link'
import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { notFound, redirect } from 'next/navigation'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { obterEtiqueta } from '@/server/etiquetas-service'

const ROTULO_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'Aguardando pagamento',
  RELEASED: 'Pago',
  GENERATED: 'Aguardando postagem',
  POSTED: 'Em trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  LOST: 'Extraviado',
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Detalhe de uma etiqueta do cliente.
 *
 * Diferente da página pública de rastreio, aqui o dono **pode** ver nome e
 * endereço: são os dados que ele mesmo informou. A omissão em `/r/[codigo]`
 * existe porque lá qualquer pessoa com o código entra.
 */
export default async function PaginaEtiqueta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cabecalhos = await headers()
  const sessao = await lerSessao(new NextRequest('http://localhost/etiquetas', { headers: cabecalhos }))

  if (!sessao) {
    redirect('/login')
  }

  let etiqueta
  try {
    etiqueta = await obterEtiqueta(sessao.userId, id)
  } catch (error) {
    if (error instanceof EnvioNaoEncontradoError) {
      notFound()
    }
    throw error
  }

  const resumo = [
    { rotulo: 'Situação', valor: ROTULO_STATUS[etiqueta.status] ?? etiqueta.status },
    { rotulo: 'Código', valor: etiqueta.codigoRastreio ?? 'sem código' },
    { rotulo: 'Serviço', valor: etiqueta.servico },
    { rotulo: 'Prazo', valor: `${etiqueta.prazoDias} dias úteis` },
    { rotulo: 'Valor pago', valor: reais(etiqueta.valorCentavos) },
    { rotulo: 'Criado em', valor: dataHora(etiqueta.criadoEm) },
  ]

  const totalProdutos = etiqueta.produtos.reduce(
    (soma, produto) => soma + (produto.quantidade ?? 0) * (produto.valorUnitarioCentavos ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/etiquetas"
          className="text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          ← Etiquetas
        </Link>
        <h1 className="text-titulo font-bold text-texto-principal">
          {etiqueta.codigoRastreio ?? 'Envio sem código'}
        </h1>
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-xl bg-superficie-card p-6 sm:grid-cols-3">
        {resumo.map((item) => (
          <div key={item.rotulo}>
            <p className="text-rotulo uppercase text-texto-secundario">{item.rotulo}</p>
            <p className="text-sm font-medium text-texto-principal">{item.valor}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { titulo: 'Remetente', endereco: etiqueta.remetente },
          { titulo: 'Destinatário', endereco: etiqueta.destinatario },
        ].map(({ titulo, endereco }) => (
          <section key={titulo} className="flex flex-col gap-1 rounded-xl bg-superficie-card p-6">
            <h2 className="text-subtitulo font-semibold text-texto-principal">{titulo}</h2>
            <p className="text-sm font-medium text-texto-principal">{endereco.nome ?? '—'}</p>
            <p className="text-sm text-texto-secundario">
              {endereco.logradouro ?? '—'}
              {endereco.numero ? `, ${endereco.numero}` : ''}
              {endereco.complemento ? ` — ${endereco.complemento}` : ''}
            </p>
            <p className="text-sm text-texto-secundario">
              {endereco.bairro ? `${endereco.bairro} · ` : ''}
              {endereco.cidade ?? '—'}/{endereco.uf ?? '—'}
              {endereco.cep ? ` · ${endereco.cep}` : ''}
            </p>
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">Declaração de conteúdo</h2>

        {etiqueta.produtos.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum produto declarado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-dado">
              <thead className="text-rotulo uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Item</th>
                  <th scope="col" className="py-2 pr-4">Qtd.</th>
                  <th scope="col" className="py-2 pr-4">Valor unitário</th>
                  <th scope="col" className="py-2">Total</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {etiqueta.produtos.map((produto, indice) => (
                  <tr key={`${produto.nome}-${indice}`} className="border-t border-borda-campo">
                    <td className="py-2 pr-4">{produto.nome ?? '—'}</td>
                    <td className="py-2 pr-4">{produto.quantidade ?? 0}</td>
                    <td className="py-2 pr-4">{reais(produto.valorUnitarioCentavos ?? 0)}</td>
                    <td className="py-2">
                      {reais((produto.quantidade ?? 0) * (produto.valorUnitarioCentavos ?? 0))}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-borda-campo font-medium">
                  <td className="py-2 pr-4" colSpan={3}>
                    Total declarado
                  </td>
                  <td className="py-2">{reais(totalProdutos)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">Movimentações</h2>
        <p className="text-sm text-texto-secundario">
          Só aparecem movimentações que já aconteceram.
        </p>

        {etiqueta.eventos.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhuma movimentação registrada ainda.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {etiqueta.eventos.map((evento) => (
              <li key={evento.sequencia} className="border-l-2 border-brand pl-4">
                <p className="text-sm font-medium text-texto-principal">{evento.titulo}</p>
                <p className="text-sm text-texto-secundario">{evento.descricao}</p>
                <p className="text-xs text-texto-secundario">
                  {dataHora(evento.ocorridoEm)} · {evento.cidade}/{evento.uf}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

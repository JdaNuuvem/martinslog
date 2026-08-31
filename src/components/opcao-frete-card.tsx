import type { OpcaoCotacaoResposta } from '@/lib/cotacao-schema'

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatarPrazo(prazoDias: number): string {
  return prazoDias === 1 ? '1 dia útil' : `${prazoDias} dias úteis`
}

type OpcaoFreteCardProps = {
  opcao: OpcaoCotacaoResposta
}

export function OpcaoFreteCard({ opcao }: OpcaoFreteCardProps) {
  if (!opcao.disponivel) {
    return (
      <li
        data-testid="opcao-frete"
        data-disponivel="false"
        className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-60 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-semibold text-slate-500">{opcao.servicoNome}</p>
          <p className="text-sm text-slate-400">{opcao.carrierNome}</p>
          {opcao.observacao ? <p className="mt-1 text-sm text-slate-500">{opcao.observacao}</p> : null}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Indisponível</span>
      </li>
    )
  }

  return (
    <li
      data-testid="opcao-frete"
      data-disponivel="true"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{opcao.servicoNome}</p>
        <p className="text-sm text-slate-500">{opcao.carrierNome}</p>
        <p className="mt-1 text-sm text-slate-600">Entrega em {formatarPrazo(opcao.prazoDias)}</p>
      </div>

      <div className="flex flex-col items-start gap-1 sm:items-end">
        {opcao.descontoPercentual > 0 ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
            {opcao.descontoPercentual}% OFF
          </span>
        ) : null}
        {opcao.descontoCentavos > 0 ? (
          <span
            className="text-sm text-slate-400 line-through"
            aria-label={`Preço de balcão: ${formatarReais(opcao.precoBalcaoCentavos)}`}
          >
            {formatarReais(opcao.precoBalcaoCentavos)}
          </span>
        ) : null}
        <span className="text-2xl font-extrabold text-emerald-700">
          {formatarReais(opcao.precoFinalCentavos)}
        </span>
      </div>
    </li>
  )
}

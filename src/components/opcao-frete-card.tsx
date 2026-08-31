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
        className="flex flex-col gap-2 rounded-xl bg-superficie-bloco p-4 opacity-60 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-semibold text-texto-secundario">{opcao.servicoNome}</p>
          <p className="text-sm text-texto-secundario">{opcao.carrierNome}</p>
          {opcao.observacao ? <p className="mt-1 text-sm text-texto-secundario">{opcao.observacao}</p> : null}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-texto-secundario">Indisponível</span>
      </li>
    )
  }

  return (
    <li
      data-testid="opcao-frete"
      data-disponivel="true"
      className="flex flex-col gap-3 rounded-xl border border-superficie-bloco bg-superficie-card p-4 shadow-sm transition hover:border-brand-light hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-semibold text-texto-principal">{opcao.servicoNome}</p>
        <p className="text-sm text-texto-secundario">{opcao.carrierNome}</p>
        <p className="mt-1 text-sm text-texto-secundario">Entrega em {formatarPrazo(opcao.prazoDias)}</p>
      </div>

      <div className="flex flex-col items-start gap-1 sm:items-end">
        {opcao.descontoPercentual > 0 ? (
          <span className="rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-bold text-brand-texto">
            {opcao.descontoPercentual}% OFF
          </span>
        ) : null}
        {opcao.descontoCentavos > 0 ? (
          <span
            className="text-sm text-texto-riscado line-through"
            aria-label={`Preço de balcão: ${formatarReais(opcao.precoBalcaoCentavos)}`}
          >
            {formatarReais(opcao.precoBalcaoCentavos)}
          </span>
        ) : null}
        <span className="text-2xl font-extrabold text-brand-texto">
          {formatarReais(opcao.precoFinalCentavos)}
        </span>
      </div>
    </li>
  )
}

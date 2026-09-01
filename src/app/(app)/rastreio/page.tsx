import Link from 'next/link'
import { ListaRastreios } from '@/components/lista-rastreios'
import { RastreioForm } from '@/components/rastreio-form'

export default function PaginaRastreio() {
  return (
    <div className="flex flex-col gap-6">
      {/* O construtor de fluxo vivia numa rota sem link nenhum apontando para
          ela: existia, funcionava e era inalcançável pela interface. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-titulo font-bold text-texto-principal">Rastreio</h1>
          <p className="max-w-leitura text-corpo text-texto-secundario">
            Acompanhe seus envios ou consulte qualquer código de rastreio.
          </p>
        </div>

        <Link
          href="/rastreio/status"
          className="rounded-pilula bg-brand px-5 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        >
          Configurar fluxo do rastreio
        </Link>
      </div>

      <ListaRastreios />

      <details className="rounded-xl bg-superficie-card p-6">
        <summary className="cursor-pointer text-sm font-medium text-texto-principal">
          Consultar outro código
        </summary>
        <div className="pt-4">
          <RastreioForm />
        </div>
      </details>
    </div>
  )
}

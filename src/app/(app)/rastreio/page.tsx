import { ListaRastreios } from '@/components/lista-rastreios'
import { RastreioForm } from '@/components/rastreio-form'

export default function PaginaRastreio() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-titulo font-bold text-texto-principal">Rastreio</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Acompanhe seus envios ou consulte qualquer código de rastreio.
        </p>
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

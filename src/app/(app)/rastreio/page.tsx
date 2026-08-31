import { RastreioForm } from '@/components/rastreio-form'

export default function PaginaRastreio() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Rastreio</h1>
        <p className="text-sm text-texto-secundario">
          Digite o código de rastreio do seu envio para ver as movimentações.
        </p>
      </div>
      <RastreioForm />
    </div>
  )
}

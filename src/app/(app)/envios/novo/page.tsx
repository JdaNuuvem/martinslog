import type { Metadata } from 'next'
import { NovoEnvioWizard } from './novo-envio-wizard'

type Props = { searchParams: Promise<{ quoteId?: string; servicoId?: string }> }

export const metadata: Metadata = {
  title: 'Novo envio | Frete',
  description: 'Crie e pague um novo envio a partir de uma cotação.',
}

export default async function PaginaNovoEnvio({ searchParams }: Props) {
  const { quoteId, servicoId } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <NovoEnvioWizard quoteIdInicial={quoteId} servicoIdInicial={servicoId} />
    </div>
  )
}

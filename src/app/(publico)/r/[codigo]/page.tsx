import type { Metadata } from 'next'
import { ShellPublico } from '@/components/layout/shell-publico'
import { RastreioForm } from '@/components/rastreio-form'

type Props = { params: Promise<{ codigo: string }> }

export const metadata: Metadata = {
  title: 'Rastreio | Frete',
  description: 'Acompanhe as movimentações de um envio pelo código de rastreio.',
  // Página de dados de um envio específico: não deve entrar em índice de
  // busca, mesmo sem conteúdo pessoal.
  robots: { index: false, follow: false },
}

/**
 * Rastreio público (spec 2026-08-31, seção 7): quem tem o código consulta
 * sem login. A timeline mostra apenas serviço, código, cidade e UF — nome e
 * endereço nunca chegam ao cliente, porque a API não os devolve a ninguém.
 */
export default async function PaginaRastreioPublico({ params }: Props) {
  const { codigo } = await params

  return (
    <ShellPublico>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-texto-principal">Rastreio</h1>
          <p className="text-sm text-texto-secundario">
            Acompanhe as movimentações do envio. Só aparecem movimentações que já aconteceram.
          </p>
        </div>
        <RastreioForm codigoInicial={decodeURIComponent(codigo).toUpperCase()} />
      </div>
    </ShellPublico>
  )
}

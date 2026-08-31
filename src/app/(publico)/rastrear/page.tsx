import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'
import { RastrearForm } from '@/components/rastrear-form'

export const metadata: Metadata = {
  title: 'Rastrear pedido | Frete',
  description: 'Digite o código de rastreio recebido por mensagem e acompanhe onde está seu pedido.',
}

/**
 * Porta de entrada pública do rastreio (spec 2026-08-30, task página
 * rastrear): quem chega aqui é o destinatário de uma compra, não um cliente
 * da plataforma — não conhece "cotação" nem "etiqueta", só quer saber onde
 * está o pedido. Sem login, sem jargão interno.
 */
export default function PaginaRastrear() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-texto-principal">Rastrear pedido</h1>
          <p className="text-sm text-texto-secundario">
            Digite o código que você recebeu por mensagem para ver onde está seu pedido.
          </p>
        </div>
        <RastrearForm />
      </div>
    </AppShell>
  )
}

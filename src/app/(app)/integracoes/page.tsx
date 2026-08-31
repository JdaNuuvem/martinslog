import { WebhooksForm } from '@/components/webhooks-form'

export default function PaginaIntegracoes() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Integrações</h1>
        <p className="text-sm text-texto-secundario">
          Conecte seu sistema aos eventos dos seus envios.
        </p>
      </div>

      <WebhooksForm />
    </div>
  )
}

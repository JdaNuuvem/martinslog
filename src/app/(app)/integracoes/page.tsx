import { ApiTokensForm } from '@/components/api-tokens-form'
import { ConexaoEmail } from '@/components/conexao-email'
import { WebhooksForm } from '@/components/webhooks-form'

export default function PaginaIntegracoes() {
  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Integrações</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Conecte seu sistema aos eventos dos seus envios.
        </p>
        {/*
          O link mora aqui porque é aqui que a dúvida nasce: quem acabou de
          gerar um token está a um passo de precisar saber o que fazer com ele,
          e procurar a documentação em outra aba é onde a integração para.
        */}
        <p className="text-dado text-texto-secundario">
          <a
            href="https://martinslog.net/docs/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-texto underline underline-offset-2 hover:text-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Documentação da API
          </a>{' '}
          — rotas, webhooks e exemplos prontos.
        </p>
      </div>

      <ApiTokensForm />
      <ConexaoEmail />
      <WebhooksForm />
    </div>
  )
}

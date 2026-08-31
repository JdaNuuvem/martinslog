'use client'

import { useEffect, useState, type FormEvent } from 'react'

const EVENTOS = [
  { codigo: 'order.created', rotulo: 'Envio criado' },
  { codigo: 'order.released', rotulo: 'Pagamento confirmado' },
  { codigo: 'order.generated', rotulo: 'Etiqueta emitida' },
  { codigo: 'order.posted', rotulo: 'Objeto postado' },
  { codigo: 'order.delivered', rotulo: 'Objeto entregue' },
  { codigo: 'order.cancelled', rotulo: 'Envio cancelado' },
] as const

type Webhook = {
  id: string
  url: string
  eventos: string[]
  ativo: boolean
  criadoEm: string
}

/**
 * Cadastro dos destinos de webhook do cliente.
 *
 * O segredo aparece uma única vez, logo após o cadastro, e some da tela ao
 * cadastrar o próximo: o servidor não o devolve na listagem, então não há
 * como reexibi-lo depois. É o aviso que evita a pessoa fechar a página
 * achando que consulta mais tarde.
 */
export function WebhooksForm() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [url, setUrl] = useState('')
  const [eventos, setEventos] = useState<string[]>(['order.generated'])
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    try {
      const resposta = await fetch('/api/v0/webhook')
      if (!resposta.ok) return
      setWebhooks((await resposta.json()).webhooks as Webhook[])
    } catch {
      // A listagem é secundária: falhar ao carregar não impede cadastrar.
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  function alternarEvento(codigo: string) {
    setEventos((atual) =>
      atual.includes(codigo) ? atual.filter((e) => e !== codigo) : [...atual, codigo],
    )
  }

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSegredoNovo(null)

    setEnviando(true)
    try {
      const resposta = await fetch('/api/v0/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, eventos }),
      })
      const corpo = await resposta.json().catch(() => ({}))

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível cadastrar o webhook.')
        return
      }

      setSegredoNovo(corpo.webhook.segredo)
      setUrl('')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <div>
          <h2 className="text-lg font-bold text-texto-principal">Webhooks</h2>
          <p className="text-sm text-texto-secundario">
            Avisamos a sua URL a cada mudança de estado do envio. A entrega é assinada, para você
            conferir que veio mesmo de nós.
          </p>
        </div>

        <form onSubmit={cadastrar} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="url-webhook" className="text-sm font-medium text-texto-principal">
              URL de destino
            </label>
            <input
              id="url-webhook"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://sua-loja.com.br/webhook/frete"
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'erro-webhook' : undefined}
              className="rounded-lg border border-borda-campo bg-superficie-bloco px-4 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
            <p className="text-xs text-texto-secundario">
              Precisa ser https e estar acessível pela internet.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-texto-principal">Eventos</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EVENTOS.map((evento) => (
                <label key={evento.codigo} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={eventos.includes(evento.codigo)}
                    onChange={() => alternarEvento(evento.codigo)}
                    className="size-4 accent-brand"
                  />
                  <span className="text-texto-principal">{evento.rotulo}</span>
                  <code className="text-xs text-texto-secundario">{evento.codigo}</code>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={enviando || eventos.length === 0}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Cadastrando…' : 'Cadastrar webhook'}
          </button>
        </form>

        {erro ? (
          <p id="erro-webhook" role="alert" className="rounded-lg bg-erro-fundo p-4 text-sm text-erro">
            {erro}
          </p>
        ) : null}

        {segredoNovo ? (
          <div role="status" className="flex flex-col gap-2 rounded-lg bg-brand-bg p-4">
            <p className="text-sm font-bold text-brand-texto">
              Guarde este segredo agora — ele não será mostrado de novo.
            </p>
            <code className="block overflow-x-auto rounded bg-superficie-card p-3 font-mono text-xs text-texto-principal">
              {segredoNovo}
            </code>
            <p className="text-sm text-brand-texto">
              Use-o para conferir a assinatura das entregas. Se perder, cadastre outro webhook.
            </p>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Webhooks cadastrados</h2>

        {webhooks.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum webhook cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {webhooks.map((webhook) => (
              <li
                key={webhook.id}
                className="rounded-lg border border-borda-campo bg-superficie-bloco p-4"
              >
                <p className="break-all font-mono text-sm text-texto-principal">{webhook.url}</p>
                <p className="text-sm text-texto-secundario">{webhook.eventos.join(', ')}</p>
                {!webhook.ativo ? (
                  <span className="mt-2 inline-block rounded-pilula bg-superficie-card px-2 py-0.5 text-xs text-texto-secundario">
                    Inativo
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Como conferir a assinatura</h2>
        <p className="text-sm text-texto-secundario">
          Cada entrega leva dois cabeçalhos: <code>x-frete-timestamp</code> e{' '}
          <code>x-frete-signature</code>. Calcule o HMAC-SHA256 de{' '}
          <code>{'<timestamp>.<corpo cru>'}</code> com o seu segredo e compare com a assinatura,
          sem o prefixo <code>sha256=</code>.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-superficie-bloco p-4 text-xs text-texto-principal">
{`const assinada = crypto
  .createHmac('sha256', SEGREDO)
  .update(\`\${timestamp}.\${corpoCru}\`)
  .digest('hex')

// compare em tempo constante, nunca com ===
crypto.timingSafeEqual(
  Buffer.from(assinada, 'hex'),
  Buffer.from(recebida.replace('sha256=', ''), 'hex'),
)`}
        </pre>
        <p className="text-sm text-texto-secundario">
          Use o corpo cru, antes de qualquer reserialização — reserializar muda espaços e ordem de
          chaves, e a assinatura deixa de bater. Recuse entregas com timestamp de mais de cinco
          minutos: é o que impede alguém de reenviar uma requisição capturada.
        </p>
      </section>
    </div>
  )
}

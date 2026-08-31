'use client'

import { useState } from 'react'

type Resultado = { entregues: number; falhas: number; desistidas: number }

/**
 * Disparo manual da fila de webhooks.
 *
 * O projeto não tem worker nem agendador: sem alguém chamar, as entregas
 * ficam pendentes no banco. Este botão é a alternativa manual ao cron
 * externo — útil para destravar a fila e para conferir, em uma rodada, se um
 * endpoint de cliente voltou a responder.
 *
 * Repetir o disparo é seguro: cada entrega já concluída sai da fila, e as que
 * ainda não venceram não são tocadas. O que repetir consome é a tentativa de
 * quem está vencido e continua falhando.
 */
export function DispararWebhooks() {
  const [disparando, setDisparando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function disparar() {
    setErro(null)
    setResultado(null)
    setDisparando(true)

    try {
      const resposta = await fetch('/api/admin/webhooks/disparar', { method: 'POST' })
      const corpo = await resposta.json().catch(() => ({}))

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível processar a fila.')
        return
      }

      setResultado(corpo.resultado as Resultado)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setDisparando(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Fila de webhooks</h2>
        <p className="text-sm text-texto-secundario">
          Processa as entregas vencidas agora. Em produção isto deve ser chamado por um agendador;
          o botão existe para destravar a fila à mão.
        </p>
      </div>

      <button
        type="button"
        onClick={disparar}
        disabled={disparando}
        className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disparando ? 'Processando…' : 'Processar fila agora'}
      </button>

      {erro ? (
        <p role="alert" className="rounded-lg bg-erro-fundo p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {resultado ? (
        <dl role="status" className="grid grid-cols-3 gap-4 rounded-lg bg-superficie-bloco p-4">
          <div>
            <dt className="text-xs uppercase text-texto-secundario">Entregues</dt>
            <dd className="text-xl font-bold text-brand-texto">{resultado.entregues}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-texto-secundario">Reagendadas</dt>
            <dd className="text-xl font-bold text-texto-principal">{resultado.falhas}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-texto-secundario">Desistidas</dt>
            <dd className="text-xl font-bold text-erro">{resultado.desistidas}</dd>
          </div>
        </dl>
      ) : null}

      {resultado ? (
        <p className="text-sm text-texto-secundario">
          Reagendadas voltam à fila com espera crescente. Desistidas esgotaram as tentativas, ou
          falharam por motivo que repetir não resolve — URL removida, destino recusado ou webhook
          desativado.
        </p>
      ) : null}
    </section>
  )
}

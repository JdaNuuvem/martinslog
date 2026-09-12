'use client'

import { useState } from 'react'

/**
 * Botão "ver CPF" do detalhe do lead.
 *
 * Mostra o CPF mascarado por padrão e só busca o número completo quando
 * alguém clica — a chamada é `POST /api/admin/leads/[id]/cpf`, que grava
 * `AuditLog` a cada revelação. Não há cache nem repetição automática: cada
 * clique é uma leitura nova, e é assim que deve ser.
 */
export function RevelarCpf({ leadId, cpfMascarado }: { leadId: string; cpfMascarado: string }) {
  const [carregando, setCarregando] = useState(false)
  const [cpf, setCpf] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function revelar() {
    setErro(null)
    setCarregando(true)

    try {
      const resposta = await fetch(`/api/admin/leads/${leadId}/cpf`, { method: 'POST' })
      const corpo = await resposta.json().catch(() => ({}))

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível revelar o CPF.')
        return
      }

      setCpf(corpo.cpf as string)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-texto-principal">{cpf ?? cpfMascarado}</span>
        {cpf ? null : (
          <button
            type="button"
            onClick={revelar}
            disabled={carregando}
            className="rounded-pilula bg-brand px-3 py-1 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            {carregando ? 'Revelando…' : 'Ver CPF'}
          </button>
        )}
      </div>

      {erro ? (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

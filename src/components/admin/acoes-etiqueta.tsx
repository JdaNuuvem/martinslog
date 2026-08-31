'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const STATUS_CANCELAVEIS = ['PENDING', 'RELEASED', 'GENERATED']

/**
 * Cancelar e excluir uma etiqueta do cliente, direto na linha da tabela.
 *
 * As duas ações pedem motivo (`prompt`) porque o servidor exige — e porque a
 * caixa de texto é, na prática, o passo de confirmação: quem clicou sem
 * querer fecha ali, e quem seguiu escreveu por que.
 *
 * Cancelar é o caminho normal. Excluir apaga a linha e a linha do tempo para
 * sempre, e existe para envio criado por engano — o aviso diz isso antes.
 */
export function AcoesEtiqueta({ shipmentId, status }: { shipmentId: string; status: string }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function executar(acao: 'CANCELAR' | 'EXCLUIR') {
    const pergunta =
      acao === 'CANCELAR'
        ? 'Motivo do cancelamento (o valor pago NÃO é estornado automaticamente):'
        : 'EXCLUSÃO DEFINITIVA: a etiqueta e a linha do tempo somem do sistema e não voltam. O lançamento no extrato permanece. Motivo:'

    const motivo = window.prompt(pergunta)
    if (motivo === null) {
      return
    }

    setErro(null)
    setOcupado(true)
    try {
      const resposta = await fetch(`/api/admin/envios/${shipmentId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao, motivo }),
      })

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(dados.mensagem ?? 'Não foi possível concluir a ação.')
        return
      }

      router.refresh()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3">
        {STATUS_CANCELAVEIS.includes(status) ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => executar('CANCELAR')}
            className="text-sm font-medium text-brand-texto disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Cancelar
          </button>
        ) : null}
        <button
          type="button"
          disabled={ocupado}
          onClick={() => executar('EXCLUIR')}
          className="text-sm font-medium text-erro disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Excluir
        </button>
      </div>
      {erro ? (
        <p role="alert" className="text-xs text-erro">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ABAS,
  ROTULOS_ABA,
  type AbaEtiquetas,
  type EtiquetaResumo,
  type ListaEtiquetasResposta,
} from '@/lib/etiquetas-schema'

const ROTULO_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'Aguardando pagamento',
  RELEASED: 'Pago',
  GENERATED: 'Aguardando postagem',
  POSTED: 'Em trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  LOST: 'Extraviado',
}

const COR_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'bg-alerta text-texto-principal',
  RELEASED: 'bg-brand-bg text-brand-texto',
  GENERATED: 'bg-brand-bg text-brand-texto',
  POSTED: 'bg-info-bg text-info-text',
  DELIVERED: 'bg-brand text-white',
  CANCELLED: 'bg-superficie-bloco text-texto-secundario',
  LOST: 'bg-erro text-white',
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function Selo({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-pilula px-2 py-0.5 text-xs font-medium ${
        COR_STATUS[status] ?? 'bg-superficie-bloco text-texto-secundario'
      }`}
    >
      {ROTULO_STATUS[status] ?? status}
    </span>
  )
}

/**
 * Confirmação do cancelamento.
 *
 * O texto diz, sem rodeio, que o valor pago **não** volta. Um cliente que
 * cancela achando que recupera o dinheiro foi enganado pela tela, não pela
 * regra — e a regra aqui é irreversível.
 */
function ConfirmarCancelamento({
  etiqueta,
  cancelando,
  onConfirmar,
  onDesistir,
}: {
  etiqueta: EtiquetaResumo
  cancelando: boolean
  onConfirmar: () => void
  onDesistir: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-erro-fundo p-4">
      <p className="text-sm text-texto-principal">
        Cancelar o envio para <strong>{etiqueta.destinatarioNome}</strong>? O valor pago de{' '}
        <strong>{reais(etiqueta.valorCentavos)}</strong> não será devolvido, e a ação não pode
        ser desfeita.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={cancelando}
          onClick={onConfirmar}
          className="rounded-lg bg-erro px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {cancelando ? 'Cancelando…' : 'Cancelar sem reembolso'}
        </button>
        <button
          type="button"
          onClick={onDesistir}
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Manter o envio
        </button>
      </div>
    </div>
  )
}

export function ListaEtiquetas() {
  const [aba, setAba] = useState<AbaEtiquetas>('todos')
  const [busca, setBusca] = useState('')
  const [dados, setDados] = useState<ListaEtiquetasResposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    setCarregando(true)

    try {
      const parametros = new URLSearchParams({ aba })
      if (busca.trim()) parametros.set('busca', busca.trim())

      const resposta = await fetch(`/api/etiquetas?${parametros}`)
      if (!resposta.ok) {
        setErro('Não foi possível carregar suas etiquetas.')
        return
      }

      setDados((await resposta.json()) as ListaEtiquetasResposta)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [aba, busca])

  useEffect(() => {
    // A busca dispara a cada tecla; o atraso evita uma consulta por
    // caractere digitado.
    const temporizador = setTimeout(carregar, busca ? 300 : 0)
    return () => clearTimeout(temporizador)
  }, [carregar, busca])

  async function cancelar(id: string) {
    setCancelandoId(id)
    setErro(null)

    try {
      const resposta = await fetch(`/api/etiquetas/${id}/cancelar`, { method: 'POST' })
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível cancelar este envio.')
        return
      }

      setConfirmandoId(null)
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCancelandoId(null)
    }
  }

  const etiquetas = dados?.etiquetas ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Situação das etiquetas">
        {ABAS.map((chave) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            className={`rounded-pilula px-4 py-2 text-sm font-medium focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              aba === chave
                ? 'bg-brand text-white'
                : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {ROTULOS_ABA[chave]}
            {dados ? ` (${dados.contagem[chave]})` : ''}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-texto-secundario">Buscar por código ou destinatário</span>
        <input
          type="search"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="FR000000000BR ou nome do destinatário"
          className="w-full max-w-md rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>

      {erro ? (
        <p role="alert" className="rounded-lg bg-erro-fundo p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {carregando && !dados ? (
        <p className="text-sm text-texto-secundario">Carregando…</p>
      ) : etiquetas.length === 0 ? (
        <p className="rounded-xl bg-superficie-card p-6 text-sm text-texto-secundario">
          {busca
            ? 'Nenhuma etiqueta encontrada para esta busca.'
            : 'Nenhuma etiqueta nesta situação.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {etiquetas.map((etiqueta) => (
            <li key={etiqueta.id} className="flex flex-col gap-3 rounded-xl bg-superficie-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-texto-principal">{etiqueta.destinatarioNome}</p>
                  <p className="text-sm text-texto-secundario">
                    {etiqueta.destinoCidade ? `${etiqueta.destinoCidade}/${etiqueta.destinoUf}` : '—'}
                    {' · '}
                    {etiqueta.servico}
                  </p>
                  <p className="font-mono text-xs text-texto-secundario">
                    {etiqueta.codigoRastreio ?? 'sem código'}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Selo status={etiqueta.status} />
                  <p className="text-sm font-medium text-texto-principal">
                    {reais(etiqueta.valorCentavos)}
                  </p>
                  <p className="text-xs text-texto-secundario">{dataHora(etiqueta.ocorridoEm)}</p>
                </div>
              </div>

              {etiqueta.ultimoEvento ? (
                <p className="text-sm text-texto-secundario">{etiqueta.ultimoEvento}</p>
              ) : null}

              {confirmandoId === etiqueta.id ? (
                <ConfirmarCancelamento
                  etiqueta={etiqueta}
                  cancelando={cancelandoId === etiqueta.id}
                  onConfirmar={() => cancelar(etiqueta.id)}
                  onDesistir={() => setConfirmandoId(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/etiquetas/${etiqueta.id}`}
                    className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    Ver detalhes
                  </Link>

                  {etiqueta.codigoRastreio ? (
                    <Link
                      href={`/r/${etiqueta.codigoRastreio}`}
                      className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      Rastrear
                    </Link>
                  ) : null}

                  {etiqueta.podeCancelar ? (
                    <button
                      type="button"
                      onClick={() => setConfirmandoId(etiqueta.id)}
                      className="rounded-lg border border-erro px-4 py-2 text-sm font-medium text-erro focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

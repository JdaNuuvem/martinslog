'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const CENARIOS = [
  { valor: 'ENTREGA_NORMAL', rotulo: 'Entrega normal' },
  { valor: 'ATRASO', rotulo: 'Atraso' },
  { valor: 'TENTATIVA_FALHA', rotulo: 'Tentativa de entrega falha' },
  { valor: 'EXTRAVIO', rotulo: 'Extravio' },
  { valor: 'DEVOLUCAO', rotulo: 'Devolução ao remetente' },
] as const

type Props = {
  shipmentId: string
  cenarioAtual: string
  temEventoPendente: boolean
  /** Códigos aplicáveis: os do motor mais os do catálogo desta conta. */
  codigosDisponiveis: string[]
}

/**
 * Controles da simulação de um envio. Cada ação é uma chamada à rota
 * administrativa, que grava `AuditLog` — nenhuma delas altera dado por
 * caminho que não deixe rastro de quem fez.
 *
 * O reinício pede confirmação porque é a única ação que descarta eventos que
 * o cliente já pode ter lido (spec seção 6).
 */
export function PainelSimulacaoEnvio({
  shipmentId,
  cenarioAtual,
  temEventoPendente,
  codigosDisponiveis,
}: Props) {
  const router = useRouter()
  const [cenario, setCenario] = useState(cenarioAtual)
  const [codigoAplicar, setCodigoAplicar] = useState(codigosDisponiveis[0] ?? '')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmandoReinicio, setConfirmandoReinicio] = useState(false)

  async function executar(corpo: Record<string, string>, mensagemOk: string) {
    setErro(null)
    setAviso(null)
    setOcupado(corpo.acao ?? null)

    try {
      const resposta = await fetch(`/api/admin/envios/${shipmentId}/simulacao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível executar a ação.')
        return
      }

      setAviso(mensagemOk)
      router.refresh()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setOcupado(null)
      setConfirmandoReinicio(false)
    }
  }

  const botao =
    'rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Controles da simulação</h2>
        <p className="text-sm text-texto-secundario">
          Trocar o cenário substitui apenas os eventos futuros: o que o cliente já viu
          permanece como está.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-erro-fundo p-3 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {aviso ? (
        <p role="status" className="text-sm text-texto-principal">
          {aviso}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Cenário</span>
          <select
            value={cenario}
            onChange={(evento) => setCenario(evento.target.value)}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {CENARIOS.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={ocupado !== null || cenario === cenarioAtual}
          onClick={() =>
            executar(
              { acao: 'TROCAR_CENARIO', cenario },
              'Cenário trocado. Os eventos futuros foram regerados.',
            )
          }
          className={`${botao} bg-brand text-white`}
        >
          {ocupado === 'TROCAR_CENARIO' ? 'Trocando…' : 'Trocar cenário'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-borda-campo pt-4">
        <label className="flex w-64 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Aplicar status agora</span>
          <select
            value={codigoAplicar}
            onChange={(evento) => setCodigoAplicar(evento.target.value)}
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {codigosDisponiveis.map((codigo) => (
              <option key={codigo} value={codigo}>
                {codigo}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={ocupado !== null || !codigoAplicar}
          onClick={() =>
            executar(
              { acao: 'APLICAR_STATUS', codigo: codigoAplicar },
              `Status ${codigoAplicar} aplicado agora.`,
            )
          }
          className={`${botao} border border-borda-campo text-texto-principal`}
        >
          {ocupado === 'APLICAR_STATUS' ? 'Aplicando…' : 'Aplicar'}
        </button>

        <p className="w-full text-sm text-texto-secundario">
          Grava um evento forçado agora e move o envio para o status correspondente, se a máquina
          de estados permitir o salto. O passado é preservado; do futuro, some apenas o que o
          salto tornou inalcançável.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-borda-campo pt-4">
        <button
          type="button"
          disabled={ocupado !== null || !temEventoPendente}
          onClick={() =>
            executar({ acao: 'FORCAR_EVENTO' }, 'Próximo evento antecipado para agora.')
          }
          className={`${botao} border border-borda-campo text-texto-principal`}
        >
          {ocupado === 'FORCAR_EVENTO' ? 'Antecipando…' : 'Forçar próximo evento'}
        </button>

        {confirmandoReinicio ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-texto-principal">
              Reiniciar apaga todos os eventos, inclusive os que o cliente já viu. Confirmar?
            </span>
            <button
              type="button"
              disabled={ocupado !== null}
              onClick={() =>
                executar({ acao: 'REINICIAR' }, 'Linha do tempo reiniciada a partir de agora.')
              }
              className={`${botao} bg-erro text-white`}
            >
              {ocupado === 'REINICIAR' ? 'Reiniciando…' : 'Confirmar reinício'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoReinicio(false)}
              className={`${botao} border border-borda-campo text-texto-principal`}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={ocupado !== null}
            onClick={() => setConfirmandoReinicio(true)}
            className={`${botao} border border-erro text-erro`}
          >
            Reiniciar linha do tempo
          </button>
        )}
      </div>

      {!temEventoPendente ? (
        <p className="text-sm text-texto-secundario">
          Este envio não tem evento pendente: a linha do tempo chegou ao fim.
        </p>
      ) : null}
    </section>
  )
}

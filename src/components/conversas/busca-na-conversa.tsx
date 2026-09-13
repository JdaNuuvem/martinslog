'use client'

import { useEffect, useRef } from 'react'
import { IconeFechar } from '@/components/layout/icones'
import { IconeSetaBaixo, IconeSetaCima } from './icones'

type BuscaProps = {
  termo: string
  total: number
  /** Posição do resultado em foco, contada do mais recente (0) para o mais antigo. */
  posicao: number
  temMais: boolean
  carregandoAntigas: boolean
  aoMudarTermo: (termo: string) => void
  aoMudarPosicao: (posicao: number) => void
  aoCarregarAntigas: () => void
  aoFechar: () => void
}

const BOTAO =
  'flex h-9 w-9 items-center justify-center rounded-pilula text-texto-secundario hover:bg-superficie-bloco disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Busca dentro da conversa aberta.
 *
 * Procura nas mensagens já carregadas e marca cada ocorrência; as setas
 * pulam de uma para outra, da mais recente para a mais antiga, como no
 * WhatsApp. A busca não vai ao servidor: o que não está carregado se traz com
 * "Buscar em mensagens anteriores", e a contagem se atualiza sozinha.
 */
export function BuscaNaConversa(props: BuscaProps) {
  const { termo, total, posicao, temMais, carregandoAntigas } = props
  const campoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campoRef.current?.focus()
  }, [])

  const maisAntiga = () => props.aoMudarPosicao(Math.min(total - 1, posicao + 1))
  const maisRecente = () => props.aoMudarPosicao(Math.max(0, posicao - 1))

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-superficie-bloco bg-superficie-card px-3 py-2" role="search">
      <input
        ref={campoRef}
        type="search"
        value={termo}
        onChange={(e) => props.aoMudarTermo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.aoFechar()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) maisRecente()
            else maisAntiga()
          }
        }}
        placeholder="Pesquisar nesta conversa…"
        aria-label="Pesquisar nesta conversa"
        className="min-w-0 flex-1 rounded-pilula border border-borda-campo bg-superficie-bloco px-4 py-1.5 text-dado text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      />
      <span className="min-w-16 text-center text-rotulo text-texto-secundario" aria-live="polite">
        {termo.trim() ? (total > 0 ? `${posicao + 1} de ${total}` : 'Nenhuma') : ''}
      </span>
      <button type="button" onClick={maisAntiga} disabled={total === 0 || posicao >= total - 1} aria-label="Ocorrência anterior (mais antiga)" className={BOTAO}>
        <IconeSetaCima />
      </button>
      <button type="button" onClick={maisRecente} disabled={total === 0 || posicao <= 0} aria-label="Próxima ocorrência (mais recente)" className={BOTAO}>
        <IconeSetaBaixo />
      </button>
      <button type="button" onClick={props.aoFechar} aria-label="Fechar pesquisa" className={BOTAO}>
        <IconeFechar />
      </button>
      {termo.trim() && temMais ? (
        <button
          type="button"
          onClick={props.aoCarregarAntigas}
          disabled={carregandoAntigas}
          className="basis-full text-left text-rotulo font-medium text-brand-texto hover:underline disabled:opacity-60"
        >
          {carregandoAntigas ? 'Carregando…' : 'Buscar também em mensagens anteriores'}
        </button>
      ) : null}
    </div>
  )
}

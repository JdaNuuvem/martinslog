'use client'

import type { Loja } from './api'
import { telefoneFormatado } from './formatadores'

type SeletorLojaProps = { lojas: Loja[]; perfilId: string; aoTrocar: (perfilId: string) => void }

function Situacao({ loja }: { loja: Loja }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-rotulo text-texto-secundario">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-pilula ${loja.conectado ? 'bg-emerald-600' : 'bg-texto-riscado'}`}
      />
      {loja.conectado ? 'Conectado' : 'Desconectado'}
    </span>
  )
}

/**
 * Qual loja (número de WhatsApp) a tela mostra.
 *
 * Com uma loja só não há o que escolher, e um `<select>` de uma opção só
 * parece defeito; aparece o nome e a situação da conexão, que continua sendo
 * a informação que importa antes de responder alguém.
 */
export function SeletorLoja({ lojas, perfilId, aoTrocar }: SeletorLojaProps) {
  const atual = lojas.find((l) => l.perfilId === perfilId)
  if (!atual) return null

  if (lojas.length === 1) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-dado font-bold text-texto-principal">
          {atual.nome}
          {atual.numero ? <span className="font-normal text-texto-secundario"> · {telefoneFormatado(atual.numero)}</span> : null}
        </span>
        <Situacao loja={atual} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Loja</span>
        <select
          value={perfilId}
          onChange={(e) => aoTrocar(e.target.value)}
          className="w-full rounded-campo border border-borda-campo bg-superficie-card px-3 py-1.5 text-dado font-medium text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {lojas.map((l) => (
            <option key={l.perfilId} value={l.perfilId}>
              {l.nome} {l.conectado ? '· conectado' : '· desconectado'}
            </option>
          ))}
        </select>
      </label>
      <Situacao loja={atual} />
    </div>
  )
}

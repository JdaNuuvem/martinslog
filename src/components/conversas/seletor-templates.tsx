'use client'

import Link from 'next/link'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Template } from './api'

export const ID_LISTA_TEMPLATES = 'lista-templates-whatsapp'

type SeletorProps = {
  templates: Template[]
  carregando: boolean
  erro: string | null
  indice: number
  /** Busca própria quando aberto pelo ⚡; `null` quando o filtro vem do "/" no campo. */
  termoBusca: string | null
  perfilId: string
  aoMudarTermo: (termo: string) => void
  aoTeclar: (evento: KeyboardEvent<HTMLElement>) => void
  aoPassarPor: (indice: number) => void
  aoEscolher: (template: Template) => void
}

/**
 * Lista de templates sobre o campo de mensagem.
 *
 * O foco fica no campo (modo "/") ou na busca (modo ⚡) e as setas movem a
 * seleção por `aria-activedescendant` — o padrão de combobox. Mover o foco
 * de verdade para os itens tiraria o cursor do texto que a pessoa digitava.
 */
export function SeletorTemplates(props: SeletorProps) {
  const { templates, carregando, erro, indice, termoBusca, perfilId } = props
  const buscaRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (termoBusca !== null) buscaRef.current?.focus()
    // Só ao abrir: refocar a cada letra brigaria com o próprio campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${indice}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [indice])

  return (
    <div className="absolute inset-x-2 bottom-full mb-2 flex max-h-80 flex-col overflow-hidden rounded-cartao bg-superficie-card shadow-flutuante">
      <div className="flex items-center justify-between gap-2 border-b border-superficie-bloco px-3 py-2">
        <span className="text-rotulo font-bold uppercase text-texto-secundario">Templates</span>
        <Link
          href={`/conversas/templates?perfilId=${encodeURIComponent(perfilId)}`}
          className="text-dado font-medium text-brand-texto hover:underline"
        >
          Gerenciar
        </Link>
      </div>

      {termoBusca !== null ? (
        <input
          ref={buscaRef}
          value={termoBusca}
          onChange={(e) => props.aoMudarTermo(e.target.value)}
          onKeyDown={props.aoTeclar}
          placeholder="Buscar template…"
          aria-label="Buscar template"
          role="combobox"
          aria-expanded="true"
          aria-controls={ID_LISTA_TEMPLATES}
          aria-activedescendant={templates[indice] ? `template-${templates[indice].id}` : undefined}
          className="mx-3 my-2 rounded-campo border border-borda-campo bg-superficie-bloco px-3 py-1.5 text-dado text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        />
      ) : null}

      {carregando ? <p className="px-3 py-3 text-dado text-texto-secundario">Carregando templates…</p> : null}
      {erro ? (
        <p role="alert" className="px-3 py-3 text-dado text-erro">
          {erro}
        </p>
      ) : null}
      {!carregando && !erro && templates.length === 0 ? (
        <p className="px-3 py-3 text-dado text-texto-secundario">
          Nenhum template encontrado.{' '}
          <Link href={`/conversas/templates?perfilId=${encodeURIComponent(perfilId)}`} className="text-brand-texto underline">
            Criar template
          </Link>
        </p>
      ) : null}

      <ul ref={listaRef} id={ID_LISTA_TEMPLATES} role="listbox" aria-label="Templates" className="overflow-y-auto py-1">
        {templates.map((t, i) => (
          <li
            key={t.id}
            id={`template-${t.id}`}
            role="option"
            aria-selected={i === indice}
            data-indice={i}
            // mousedown e não click: o click chega depois do blur do campo.
            onMouseDown={(e) => {
              e.preventDefault()
              props.aoEscolher(t)
            }}
            onMouseEnter={() => props.aoPassarPor(i)}
            className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 ${i === indice ? 'bg-brand-bg' : ''}`}
          >
            <span className="flex items-center gap-2 text-dado font-medium text-texto-principal">
              {t.titulo}
              {t.atalho ? <span className="text-rotulo text-texto-secundario">/{t.atalho}</span> : null}
            </span>
            <span className="line-clamp-1 text-rotulo text-texto-secundario">{t.texto}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

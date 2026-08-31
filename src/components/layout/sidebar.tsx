'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type RefObject } from 'react'
import {
  IconeAjuda,
  IconeCalcular,
  IconeConvide,
  IconeEtiquetas,
  IconeFechar,
  IconeIntegracoes,
  IconePerfil,
  IconeRastreio,
} from './icones'

export const SIDEBAR_ID = 'menu-navegacao'

const ITENS = [
  { rotulo: 'Calcular', href: '/', Icone: IconeCalcular },
  { rotulo: 'Etiquetas', href: '/etiquetas', Icone: IconeEtiquetas },
  { rotulo: 'Rastreio', href: '/rastreio', Icone: IconeRastreio },
  { rotulo: 'Ajuda', href: '/ajuda', Icone: IconeAjuda },
  { rotulo: 'Integrações', href: '/integracoes', Icone: IconeIntegracoes },
  { rotulo: 'Convide e ganhe', href: '/convide', Icone: IconeConvide },
  { rotulo: 'Perfil', href: '/perfil', Icone: IconePerfil },
] as const

type SidebarProps = {
  aberta: boolean
  onFechar: () => void
  /** Botão que abre o menu; recebe o foco de volta quando ele fecha. */
  botaoMenuRef?: RefObject<HTMLButtonElement | null>
}

/**
 * Sidebar única (sem duplicar o `<nav>` para mobile) que fica sempre
 * visível em telas >=1024px e vira um menu retrátil sobreposto abaixo
 * disso, deslizando para dentro/fora com `translate`. Operável por
 * teclado e fechável com Escape.
 */
export function Sidebar({ aberta, onFechar, botaoMenuRef }: SidebarProps) {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)
  const estavaAberta = useRef(false)

  useEffect(() => {
    if (!aberta) return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    navRef.current?.querySelector('a')?.focus()
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberta, onFechar])

  /**
   * Devolve o foco ao botão de menu quando ele fecha.
   *
   * Ao abrir, o foco é movido para dentro da sidebar; sem devolvê-lo, quem
   * fecha o menu por teclado fica com o foco no `<body>` e recomeça a
   * navegação do topo da página. A devolução só acontece na transição de
   * aberta para fechada — no desktop a sidebar está sempre visível e
   * `aberta` nunca muda, então nada é roubado de quem está digitando.
   *
   * E só quando o foco ficaria órfão: se ele já saiu da sidebar (o caso de
   * clicar num link, que navega), respeita-se onde ele está em vez de
   * puxá-lo de volta para o botão.
   */
  useEffect(() => {
    if (aberta) {
      estavaAberta.current = true
      return
    }

    if (!estavaAberta.current) return
    estavaAberta.current = false

    const focado = document.activeElement
    const ficouOrfao = !focado || focado === document.body || !!navRef.current?.contains(focado)
    if (ficouOrfao) {
      botaoMenuRef?.current?.focus()
    }
  }, [aberta, botaoMenuRef])

  return (
    <>
      {aberta ? (
        <button
          type="button"
          aria-label="Fechar menu de navegação"
          onClick={onFechar}
          className="fixed inset-x-0 bottom-0 top-topbar z-30 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        id={SIDEBAR_ID}
        className={`${aberta ? 'fixed flex shadow-xl' : 'hidden'} bottom-0 left-0 top-topbar z-40 w-sidebar border-r border-superficie-bloco bg-superficie-card lg:fixed lg:flex`}
      >
        <nav ref={navRef} aria-label="Navegação principal" className="flex h-full flex-col gap-1 p-3">
          <div className="mb-2 flex items-center justify-between lg:hidden">
            <span className="text-sm font-bold uppercase text-texto-secundario">Menu</span>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar menu de navegação"
              className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <IconeFechar />
            </button>
          </div>

          {ITENS.map(({ rotulo, href, Icone }) => {
            const ativo = href === '/' ? pathname === '/' : pathname?.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onFechar}
                aria-current={ativo ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-r-lg border-l-4 px-3 py-2 text-sm font-medium transition ${
                  ativo
                    ? 'border-brand bg-brand-bg text-brand-texto'
                    : 'border-transparent text-texto-secundario hover:bg-superficie-bloco'
                }`}
              >
                <Icone />
                {rotulo}
              </Link>
            )
          })}

          <div className="mt-auto rounded-xl bg-superficie-bloco p-4 text-center text-xs text-texto-secundario">
            Espaço reservado para campanha
          </div>
        </nav>
      </aside>
    </>
  )
}

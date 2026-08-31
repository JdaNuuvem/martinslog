'use client'

import Link from 'next/link'
import type { RefObject } from 'react'
import { IconeCarteira, IconeMenu, IconeSair, IconeSino } from './icones'
import { SIDEBAR_ID } from './sidebar'
import { useLogout } from './usar-logout'

type TopbarProps = {
  nomeUsuario: string
  menuAberto: boolean
  onAlternarMenu: () => void
  /** Alvo para o qual a sidebar devolve o foco ao fechar. */
  botaoMenuRef?: RefObject<HTMLButtonElement | null>
  /**
   * A calculadora pública usa este mesmo shell para visitantes sem sessão
   * (nome fixo "VISITANTE"). Sem esta flag o botão "Sair" apareceria para
   * quem nunca entrou — clicável, mas sem sessão nenhuma para encerrar.
   */
  autenticado: boolean
}

/**
 * Topbar do shell autenticado. O saldo é um elemento de navegação — verde,
 * sublinhado e clicável — não um enfeite. A carteira só nasce na Task 11;
 * até lá o link aponta para `/carteira`, que exibe a página "Em breve".
 */
export function Topbar({ nomeUsuario, menuAberto, onAlternarMenu, botaoMenuRef, autenticado }: TopbarProps) {
  const { sair, saindo } = useLogout()

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-topbar items-center justify-between border-b border-superficie-bloco bg-superficie-card px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          ref={botaoMenuRef}
          onClick={onAlternarMenu}
          aria-label={menuAberto ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
          aria-controls={SIDEBAR_ID}
          aria-expanded={menuAberto}
          className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:hidden"
        >
          <IconeMenu />
        </button>
        <span className="text-sm font-bold uppercase tracking-wide text-texto-principal">
          {nomeUsuario}
        </span>
        <IconeCarteira className="text-texto-secundario" />
        <Link
          href="/carteira"
          className="text-sm font-bold text-brand-texto underline underline-offset-2 hover:text-brand-light"
        >
          R$ 0,00
        </Link>
      </div>

      <span className="text-lg font-extrabold tracking-tight text-texto-principal">Frete</span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Notificações"
          className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <IconeSino />
        </button>

        {/*
         * Escondido em mobile: a topbar já está apertada com nome, saldo e
         * sino nessa largura, e "Sair" com rótulo visível espremeria o
         * resto. No menu retrátil (`Sidebar`) o mesmo botão aparece com
         * espaço de sobra, então a ação não desaparece — só muda de lugar.
         */}
        {autenticado ? (
          <button
            type="button"
            onClick={sair}
            disabled={saindo}
            aria-busy={saindo}
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 lg:flex"
          >
            <IconeSair />
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
        ) : null}
      </div>
    </header>
  )
}

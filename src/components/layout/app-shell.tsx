'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

type AppShellProps = {
  children: ReactNode
  nomeUsuario?: string
}

/**
 * Compõe topbar, sidebar e área de conteúdo — o esqueleto visual comum a
 * todas as telas autenticadas. Abaixo de 1024px a sidebar vira menu
 * retrátil controlado por este componente.
 *
 * O ref do botão de menu nasce aqui porque os dois lados precisam dele: a
 * topbar o usa como alvo, e a sidebar o usa para devolver o foco quando o
 * menu fecha. Sem esse par, quem navega por teclado perde a posição ao
 * fechar o menu e cai no início da página.
 */
export function AppShell({ children, nomeUsuario = 'VISITANTE' }: AppShellProps) {
  const [menuAberto, setMenuAberto] = useState(false)
  const botaoMenuRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="min-h-screen bg-superficie-pagina">
      <Topbar
        nomeUsuario={nomeUsuario}
        menuAberto={menuAberto}
        onAlternarMenu={() => setMenuAberto((atual) => !atual)}
        botaoMenuRef={botaoMenuRef}
      />
      <Sidebar
        aberta={menuAberto}
        onFechar={() => setMenuAberto(false)}
        botaoMenuRef={botaoMenuRef}
      />
      <main className="min-w-0 px-4 pb-8 pt-topbar lg:pl-sidebar">
        <div className="pt-8">{children}</div>
      </main>
    </div>
  )
}

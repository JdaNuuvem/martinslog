'use client'

import { useState, type ReactNode } from 'react'
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
 */
export function AppShell({ children, nomeUsuario = 'VISITANTE' }: AppShellProps) {
  const [menuAberto, setMenuAberto] = useState(false)

  return (
    <div className="min-h-screen bg-superficie-pagina">
      <Topbar nomeUsuario={nomeUsuario} onAbrirMenu={() => setMenuAberto(true)} />
      <div className="flex">
        <Sidebar aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
        <main className="min-w-0 flex-1 px-4 py-8">{children}</main>
      </div>
    </div>
  )
}

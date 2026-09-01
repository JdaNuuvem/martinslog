'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

type AppShellProps = {
  children: ReactNode
  nomeUsuario?: string
  /**
   * A calculadora pública renderiza este shell para visitantes sem sessão
   * (nome fixo "VISITANTE"); só o grupo `(app)`, atrás da guarda de sessão,
   * passa `true`. Controla a exibição do botão "Sair" — sem sessão não há
   * o que encerrar.
   */
  autenticado?: boolean
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
export function AppShell({ children, nomeUsuario = 'VISITANTE', autenticado = false }: AppShellProps) {
  const [menuAberto, setMenuAberto] = useState(false)
  const botaoMenuRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="min-h-screen bg-superficie-pagina">
      <Topbar
        nomeUsuario={nomeUsuario}
        menuAberto={menuAberto}
        onAlternarMenu={() => setMenuAberto((atual) => !atual)}
        botaoMenuRef={botaoMenuRef}
        autenticado={autenticado}
      />
      <Sidebar
        aberta={menuAberto}
        onFechar={() => setMenuAberto(false)}
        botaoMenuRef={botaoMenuRef}
        autenticado={autenticado}
      />
      {/*
        `px-5` em vez de `px-4`: texto encostado na borda da janela é a
        reclamação silenciosa de toda tela estreita, e 16px é o mínimo — não a
        meta. O `pb-secao` fecha a página com o mesmo respiro que separa suas
        seções, em vez de cortar o conteúdo rente ao fim da rolagem.
      */}
      <main className="min-w-0 px-5 pb-secao pt-topbar sm:px-8 lg:pl-sidebar">
        <div className="pt-bloco lg:pt-secao">{children}</div>
      </main>
    </div>
  )
}

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
  IconeFluxo,
  IconeIntegracoes,
  IconePerfil,
  IconeRastreio,
  IconeSair,
} from './icones'
import { useLogout } from './usar-logout'

export const SIDEBAR_ID = 'menu-navegacao'

const ITENS = [
  { rotulo: 'Calcular', href: '/', Icone: IconeCalcular },
  { rotulo: 'Etiquetas', href: '/etiquetas', Icone: IconeEtiquetas },
  { rotulo: 'Rastreio', href: '/rastreio', Icone: IconeRastreio },
  { rotulo: 'Fluxo do rastreio', href: '/rastreio/status', Icone: IconeFluxo },
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
  /** Ver `TopbarProps.autenticado` — controla se "Sair" aparece no menu mobile. */
  autenticado: boolean
}

/**
 * Sidebar única (sem duplicar o `<nav>` para mobile) que fica sempre
 * visível em telas >=1024px e vira um menu retrátil sobreposto abaixo
 * disso, deslizando para dentro/fora com `translate`. Operável por
 * teclado e fechável com Escape.
 */
export function Sidebar({ aberta, onFechar, botaoMenuRef, autenticado }: SidebarProps) {
  const pathname = usePathname()

  /**
   * Item destacado: o de rota mais específica que casa com a página atual.
   *
   * Um `startsWith` por item destacaria dois de uma vez desde que existem
   * rotas aninhadas — em `/rastreio/status`, tanto "Rastreio" quanto "Fluxo
   * do rastreio" casariam, e a navegação diria ao usuário que ele está em
   * dois lugares.
   */
  const hrefAtivo = ITENS.map((item) => item.href)
    .filter((href) =>
      href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(`${href}/`),
    )
    .sort((a, b) => b.length - a.length)[0]
  const navRef = useRef<HTMLElement>(null)
  const estavaAberta = useRef(false)
  const { sair, saindo } = useLogout()

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
        /*
          Gaveta aberta flutua sobre o conteúdo: sombra, sem borda. Fixada no
          desktop, ela é parte da estrutura: borda, sem sombra. Cada estado
          escolhe um dos dois — os dois juntos são o vício que a auditoria de
          estilo chama de "hairline border with wide shadow".
        */
        /*
          No desktop a lateral sobe até o topo da janela (`lg:top-0`) e leva a
          marca consigo: é ela que carrega a identidade, e não o cabeçalho.
          Em telas estreitas continua abrindo abaixo do cabeçalho, onde o
          botão que a abre está.
        */
        className={`${aberta ? 'fixed flex shadow-flutuante' : 'hidden'} bottom-0 left-0 top-topbar z-40 w-sidebar bg-sidebar lg:fixed lg:top-0 lg:flex lg:border-r lg:border-sidebar-borda lg:shadow-none`}
      >
        <nav ref={navRef} aria-label="Navegação principal" className="flex h-full flex-col gap-1 p-3">
          <div className="mb-3 hidden items-center gap-2.5 px-2 pt-2 lg:flex">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.webp" alt="" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
            <span className="text-base font-extrabold uppercase tracking-tight text-white">
              Martins<span className="text-sidebar-marcador">Log</span>
            </span>
          </div>

          <div className="mb-2 flex items-center justify-between lg:hidden">
            <span className="text-sm font-bold uppercase text-sidebar-texto">Menu</span>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar menu de navegação"
              className="rounded-lg p-2 text-white hover:bg-sidebar-ativo focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-marcador"
            >
              <IconeFechar />
            </button>
          </div>

          {ITENS.map(({ rotulo, href, Icone }) => {
            const ativo = href === hrefAtivo
            return (
              <Link
                key={href}
                href={href}
                onClick={onFechar}
                aria-current={ativo ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-r-lg border-l-4 px-3 py-2 text-sm font-medium transition ${
                  ativo
                    ? 'border-sidebar-marcador bg-sidebar-ativo text-white'
                    : 'border-transparent text-sidebar-texto hover:bg-sidebar-ativo hover:text-white'
                }`}
              >
                <Icone />
                {rotulo}
              </Link>
            )
          })}

          {/*
           * Só em mobile: no desktop o "Sair" já vive na topbar, ao lado do
           * sino. Aqui, dentro do menu retrátil, é onde ele cabe sem
           * espremer nome, saldo e sino na largura estreita da topbar.
           */}
          {autenticado ? (
            <button
              type="button"
              onClick={sair}
              disabled={saindo}
              aria-busy={saindo}
              className="flex items-center gap-3 rounded-r-lg border-l-4 border-transparent px-3 py-2 text-sm font-medium text-sidebar-texto hover:bg-sidebar-ativo hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-marcador disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
            >
              <IconeSair />
              {saindo ? 'Saindo…' : 'Sair'}
            </button>
          ) : null}

          <div className="mt-auto rounded-xl bg-sidebar-ativo p-4 text-center text-xs text-sidebar-texto">
            Espaço reservado para campanha
          </div>
        </nav>
      </aside>
    </>
  )
}

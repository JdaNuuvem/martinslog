'use client'

import Link from 'next/link'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Loja, ResumoConversa } from './api'
import { IconeBusca, IconeRaio, IconeSincronizar } from './icones'
import { ItemConversa } from './item-conversa'
import { SeletorLoja } from './seletor-loja'

type ListaProps = {
  lojas: Loja[]
  perfilId: string
  aoTrocarLoja: (perfilId: string) => void
  textoBusca: string
  buscaAplicada: string
  aoMudarBusca: (texto: string) => void
  conversas: ResumoConversa[]
  carregando: boolean
  carregandoMais: boolean
  temMais: boolean
  erro: string | null
  aoCarregarMais: () => void
  aoRecarregar: () => void
  selecionadaId: string | null
  aoAbrir: (conversa: ResumoConversa) => void
  sincronizando: boolean
  avisoSincronia: string | null
  aoSincronizar: () => void
}

const TECLAS_NAVEGACAO = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/** Setas, Home e End andam entre as conversas sem precisar de Tab item a item. */
function navegar(e: KeyboardEvent<HTMLUListElement>) {
  if (!TECLAS_NAVEGACAO.includes(e.key)) return
  const itens = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-item-conversa]')]
  if (itens.length === 0) return
  e.preventDefault()
  const atual = itens.indexOf(document.activeElement as HTMLButtonElement)
  const proximo =
    e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1 : atual + (e.key === 'ArrowDown' ? 1 : -1)
  itens[Math.max(0, Math.min(itens.length - 1, proximo))]?.focus()
}

export function ListaConversas(props: ListaProps) {
  const { lojas, perfilId, conversas, carregando, temMais, erro } = props
  const rolagemRef = useRef<HTMLDivElement>(null)
  const sentinelaRef = useRef<HTMLDivElement>(null)
  const loja = lojas.find((l) => l.perfilId === perfilId)
  const { aoCarregarMais } = props

  // Rolagem infinita: a sentinela no fim da lista pede a próxima página antes de aparecer.
  useEffect(() => {
    const alvo = sentinelaRef.current
    if (!alvo || !temMais) return
    const observador = new IntersectionObserver((entradas) => entradas[0]?.isIntersecting && aoCarregarMais(), {
      root: rolagemRef.current,
      rootMargin: '200px',
    })
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [temMais, aoCarregarMais, conversas.length])

  const vazia = !carregando && !erro && conversas.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-superficie-bloco p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-subtitulo font-bold text-texto-principal">Conversas</h2>
          <div className="flex items-center gap-1">
            <Link
              href={`/conversas/templates?perfilId=${encodeURIComponent(perfilId)}`}
              aria-label="Gerenciar templates de WhatsApp"
              title="Templates"
              className="flex h-9 w-9 items-center justify-center rounded-pilula text-texto-secundario hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <IconeRaio />
            </Link>
            <button
              type="button"
              onClick={props.aoSincronizar}
              disabled={props.sincronizando || !loja?.conectado}
              aria-label="Sincronizar conversas com o WhatsApp"
              title={loja?.conectado ? 'Sincronizar' : 'Conecte o WhatsApp para sincronizar'}
              className="flex h-9 w-9 items-center justify-center rounded-pilula text-texto-secundario hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
            >
              <IconeSincronizar className={props.sincronizando ? 'animate-spin motion-reduce:animate-none' : ''} />
            </button>
          </div>
        </div>

        <SeletorLoja lojas={lojas} perfilId={perfilId} aoTrocar={props.aoTrocarLoja} />

        <label className="relative block">
          <span className="sr-only">Pesquisar conversas</span>
          <IconeBusca width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-secundario" />
          <input
            type="search"
            value={props.textoBusca}
            onChange={(e) => props.aoMudarBusca(e.target.value)}
            placeholder="Pesquisar nome, telefone ou mensagem"
            className="w-full rounded-lg border-0 bg-[#f0f2f5] py-1.5 pl-9 pr-3 text-dado text-[#111b21] placeholder:text-[#667781] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00a884]"
          />
        </label>

        {props.avisoSincronia ? (
          <p role="status" className="text-rotulo text-texto-secundario">
            {props.avisoSincronia}
          </p>
        ) : null}
        {loja && !loja.conectado ? (
          <p className="rounded-campo bg-alerta/15 px-3 py-2 text-rotulo text-texto-principal">
            WhatsApp desconectado: mensagens não serão enviadas.{' '}
            <Link href="/whatsapp" className="font-bold text-brand-texto underline">
              Conectar
            </Link>
          </p>
        ) : null}
      </div>

      <div ref={rolagemRef} className="min-h-0 flex-1 overflow-y-auto">
        {carregando && conversas.length === 0 ? (
          <p className="p-4 text-dado text-texto-secundario">Carregando conversas…</p>
        ) : null}

        {erro ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-4 text-dado text-erro">
            {erro}
            <button type="button" onClick={props.aoRecarregar} className="font-bold text-brand-texto underline">
              Tentar de novo
            </button>
          </div>
        ) : null}

        {vazia && props.buscaAplicada ? (
          <p className="p-4 text-dado text-texto-secundario">Nada encontrado para “{props.buscaAplicada}”.</p>
        ) : null}

        {vazia && !props.buscaAplicada ? (
          <div className="flex flex-col items-start gap-3 p-4 text-dado text-texto-secundario">
            {loja?.conectado ? (
              <>
                <p>Nenhuma conversa por aqui ainda. Traga as conversas que já estão no celular:</p>
                <button
                  type="button"
                  onClick={props.aoSincronizar}
                  disabled={props.sincronizando}
                  className="rounded-pilula bg-brand px-5 py-2 font-medium text-white hover:bg-brand-light disabled:opacity-60"
                >
                  {props.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
                </button>
              </>
            ) : (
              <>
                <p>O WhatsApp desta loja não está conectado. Conecte o celular pelo QR code para ver e responder conversas.</p>
                <Link href="/whatsapp" className="rounded-pilula bg-brand px-5 py-2 font-medium text-white hover:bg-brand-light">
                  Conectar WhatsApp
                </Link>
              </>
            )}
          </div>
        ) : null}

        <ul aria-label="Lista de conversas" onKeyDown={navegar} className="divide-y divide-[#e9edef]">
          {conversas.map((c) => (
            <ItemConversa key={c.id} conversa={c} selecionada={c.id === props.selecionadaId} aoAbrir={props.aoAbrir} />
          ))}
        </ul>

        {temMais ? (
          <div ref={sentinelaRef} className="p-3 text-center text-rotulo text-texto-secundario">
            {props.carregandoMais ? 'Carregando mais…' : ' '}
          </div>
        ) : null}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Mensagem } from './api'
import { BalaoMensagem } from './balao-mensagem'
import { agruparPorDia } from './formatadores'
import { IconeSetaBaixo } from './icones'
import type { Mudanca } from './usar-mensagens'

type AreaProps = {
  mensagens: Mensagem[]
  mudanca: Mudanca
  versao: number
  temMais: boolean
  carregando: boolean
  carregandoAntigas: boolean
  termo: string
  idFoco: string | null
  podeTentarDeNovo: (id: string) => boolean
  aoTentarDeNovo: (id: string) => void
  aoCarregarAntigas: () => void
  aoAbrirImagem: (url: string, legenda: string | null) => void
}

/** Distância do fim abaixo da qual a pessoa ainda "está no fim" e acompanha o que chega. */
const FOLGA_FIM_PX = 120
/** Distância do topo que já dispara a carga de mensagens antigas. */
const FOLGA_TOPO_PX = 80

/**
 * Área rolável das mensagens.
 *
 * A rolagem segue três regras, e cada uma evita uma irritação conhecida:
 * abrir a conversa leva ao fim (é lá que está a última mensagem); carregar
 * antigas mantém na tela a mensagem que a pessoa estava lendo (sem isso ela
 * seria arremessada cinquenta mensagens para cima); e mensagem nova só puxa
 * para o fim quem já estava no fim — quem subiu para reler algo não é
 * interrompido.
 */
export function AreaMensagens(props: AreaProps) {
  const { mensagens, mudanca, versao, temMais, carregando, carregandoAntigas, idFoco } = props
  const rolagemRef = useRef<HTMLDivElement>(null)
  const pertoDoFim = useRef(true)
  const antesDaCarga = useRef<{ altura: number; topo: number } | null>(null)
  const [longeDoFim, setLongeDoFim] = useState(false)

  useLayoutEffect(() => {
    const el = rolagemRef.current
    if (!el) return
    if (mudanca === 'antigas' && antesDaCarga.current) {
      el.scrollTop = el.scrollHeight - antesDaCarga.current.altura + antesDaCarga.current.topo
      antesDaCarga.current = null
      return
    }
    if (mudanca === 'inicial' || mudanca === 'envio' || pertoDoFim.current) {
      el.scrollTop = el.scrollHeight
      pertoDoFim.current = true
    }
  }, [versao, mudanca])

  useEffect(() => {
    if (!idFoco) return
    rolagemRef.current
      ?.querySelector(`[data-mensagem-id="${CSS.escape(idFoco)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idFoco])

  function carregarAntigas() {
    const el = rolagemRef.current
    if (!el || !temMais || carregandoAntigas) return
    antesDaCarga.current = { altura: el.scrollHeight, topo: el.scrollTop }
    props.aoCarregarAntigas()
  }

  function aoRolar() {
    const el = rolagemRef.current
    if (!el) return
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < FOLGA_FIM_PX
    pertoDoFim.current = perto
    setLongeDoFim(!perto)
    if (el.scrollTop < FOLGA_TOPO_PX) carregarAntigas()
  }

  function irParaOFim() {
    const el = rolagemRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const grupos = agruparPorDia(mensagens)

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={rolagemRef}
        onScroll={aoRolar}
        // Foto que termina de carregar cresce o conteúdo; quem estava no fim continua no fim.
        onLoadCapture={() => {
          if (pertoDoFim.current && rolagemRef.current) {
            rolagemRef.current.scrollTop = rolagemRef.current.scrollHeight
          }
        }}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensagens da conversa"
        tabIndex={0}
        className="fundo-whatsapp h-full overflow-y-auto px-3 pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-10 xl:px-16"
      >
        {temMais ? (
          <div className="flex justify-center pt-3">
            <button
              type="button"
              onClick={carregarAntigas}
              disabled={carregandoAntigas}
              className="rounded-lg bg-white px-4 py-1.5 text-dado text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
            >
              {carregandoAntigas ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          </div>
        ) : null}

        {carregando ? (
          <p className="mx-auto mt-8 w-fit rounded-lg bg-white/90 px-4 py-1.5 text-center text-dado text-[#54656f]">
            Carregando mensagens…
          </p>
        ) : null}
        {!carregando && mensagens.length === 0 ? (
          <p className="mx-auto mt-8 w-fit rounded-lg bg-[#ffeecd] px-4 py-1.5 text-center text-dado text-[#54656f]">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        ) : null}

        {grupos.map((grupo) => (
          <section key={grupo.chave} aria-label={grupo.rotulo} className="flex flex-col">
            <div className="sticky top-0 z-10 flex justify-center pb-1 pt-3">
              <span className="rounded-lg bg-white px-3 py-1 text-[0.78rem] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                {grupo.rotulo}
              </span>
            </div>
            {grupo.mensagens.map((m, i) => (
              <BalaoMensagem
                key={m.id}
                mensagem={m}
                termo={props.termo}
                destacada={m.id === idFoco}
                inicioDaSequencia={i === 0 || (grupo.mensagens[i - 1]!.autor === 'CLIENTE') !== (m.autor === 'CLIENTE')}
                podeTentarDeNovo={m.status === 'ERRO' && props.podeTentarDeNovo(m.id)}
                aoTentarDeNovo={props.aoTentarDeNovo}
                aoAbrirImagem={props.aoAbrirImagem}
              />
            ))}
          </section>
        ))}
      </div>

      {longeDoFim ? (
        <button
          type="button"
          onClick={irParaOFim}
          aria-label="Ir para a mensagem mais recente"
          className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-pilula bg-white text-[#54656f] shadow-flutuante focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <IconeSetaBaixo />
        </button>
      ) : null}
    </div>
  )
}

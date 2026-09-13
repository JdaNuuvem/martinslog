'use client'

import { useEffect, useRef, useState } from 'react'
import { duracaoLegivel } from './formatadores'
import { IconePausa, IconePlay } from './icones'

/**
 * Evento que avisa os outros players que um áudio começou.
 *
 * No WhatsApp dar play num áudio pausa o anterior; sem isto, dois áudios
 * tocando juntos viram ruído e o atendente não entende nenhum.
 */
const EVENTO_TOCANDO = 'conversas:audio-tocando'

type PlayerAudioProps = { url: string; duracao: number | null; doCliente: boolean }

/**
 * Player compacto de áudio.
 *
 * O `<audio controls>` nativo ocupa a largura inteira do balão e muda de cara
 * a cada navegador. Aqui o elemento fica escondido e a interface é só
 * play/pausa, barra e tempo. `preload="none"`: numa conversa com vinte áudios,
 * baixar todos ao abrir custaria megabytes que ninguém pediu.
 */
export function PlayerAudio({ url, duracao, doCliente }: PlayerAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [tocando, setTocando] = useState(false)
  const [atual, setAtual] = useState(0)
  const [total, setTotal] = useState<number | null>(duracao)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    function aoOutroTocar(evento: Event) {
      if ((evento as CustomEvent<HTMLAudioElement>).detail !== audio) audio?.pause()
    }
    document.addEventListener(EVENTO_TOCANDO, aoOutroTocar)
    return () => document.removeEventListener(EVENTO_TOCANDO, aoOutroTocar)
  }, [])

  function alternar() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      setFalhou(false)
      document.dispatchEvent(new CustomEvent(EVENTO_TOCANDO, { detail: audio }))
      audio.play().catch(() => setFalhou(true))
    } else {
      audio.pause()
    }
  }

  // Áudio gravado no navegador (webm) costuma informar duração infinita até
  // tocar inteiro; nesse caso vale a duração que veio do servidor.
  const duracaoConhecida = total !== null && Number.isFinite(total) && total > 0 ? total : null
  const progresso = duracaoConhecida ? Math.min(100, (atual / duracaoConhecida) * 100) : 0

  return (
    <div className="flex w-64 max-w-full items-center gap-3 py-1">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false)
          setAtual(0)
        }}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setTotal(d)
        }}
        onError={() => setFalhou(true)}
      />
      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? 'Pausar áudio' : 'Tocar áudio'}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-pilula text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          doCliente ? 'bg-texto-secundario' : 'bg-brand'
        }`}
      >
        {tocando ? <IconePausa /> : <IconePlay width={16} height={16} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duracaoConhecida ?? 0}
          step={0.1}
          value={Math.min(atual, duracaoConhecida ?? 0)}
          disabled={!duracaoConhecida}
          aria-label="Posição do áudio"
          aria-valuetext={`${duracaoLegivel(atual)} de ${duracaoLegivel(duracaoConhecida)}`}
          onChange={(e) => {
            const audio = audioRef.current
            if (audio) audio.currentTime = Number(e.target.value)
            setAtual(Number(e.target.value))
          }}
          style={{ backgroundSize: `${progresso}% 100%` }}
          className="h-1 w-full cursor-pointer appearance-none rounded-pilula bg-borda-campo bg-gradient-to-r from-brand to-brand bg-no-repeat accent-brand disabled:cursor-default"
        />
        <span className="text-rotulo text-texto-secundario">
          {falhou ? 'Não foi possível tocar' : duracaoLegivel(tocando || atual > 0 ? atual : duracaoConhecida)}
        </span>
      </div>
    </div>
  )
}

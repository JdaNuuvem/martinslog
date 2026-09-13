'use client'

import { useEffect, useRef } from 'react'
import { IconeFechar } from '@/components/layout/icones'

type VisualizadorProps = { url: string | null; legenda: string | null; aoFechar: () => void }

/**
 * Foto em tela cheia.
 *
 * `<dialog>` nativo com `showModal()`: prende o foco, fecha com Esc e devolve
 * o foco à miniatura sozinho — três coisas que um `div` fixo teria de
 * reimplementar, e que costumam ficar pela metade.
 */
export function VisualizadorImagem({ url, legenda, aoFechar }: VisualizadorProps) {
  const dialogoRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogo = dialogoRef.current
    if (!dialogo) return
    if (url && !dialogo.open) dialogo.showModal()
    if (!url && dialogo.open) dialogo.close()
  }, [url])

  return (
    <dialog
      ref={dialogoRef}
      onClose={aoFechar}
      onClick={(e) => {
        // Clique no fundo escuro (o próprio dialog, fora da imagem) fecha.
        if (e.target === e.currentTarget) dialogoRef.current?.close()
      }}
      aria-label="Foto em tela cheia"
      className="m-0 h-full max-h-none w-full max-w-none bg-black/90 p-0 backdrop:bg-black/60"
    >
      {url ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
          <button
            type="button"
            onClick={() => dialogoRef.current?.close()}
            aria-label="Fechar foto"
            className="absolute right-4 top-4 rounded-pilula bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <IconeFechar />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={legenda ?? 'Foto enviada na conversa'} className="max-h-[85vh] max-w-full object-contain" />
          {legenda ? <p className="max-w-leitura text-center text-corpo text-white">{legenda}</p> : null}
        </div>
      ) : null}
    </dialog>
  )
}

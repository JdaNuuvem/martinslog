'use client'

import { useEffect, useRef, useState } from 'react'
import { IconeFechar } from '@/components/layout/icones'
import { tamanhoLegivel, tipoDoArquivo } from './formatadores'
import { IconeDocumento, IconeEnviar } from './icones'

type PreviaProps = {
  arquivo: File
  aoEnviar: (legenda: string) => void
  aoCancelar: () => void
}

/**
 * Prévia do anexo antes de mandar, com legenda.
 *
 * Enviar direto ao escolher o arquivo é o jeito mais rápido de mandar a foto
 * errada para um cliente — e mensagem de WhatsApp não tem "desfazer".
 */
export function PreviaAnexo({ arquivo, aoEnviar, aoCancelar }: PreviaProps) {
  const [legenda, setLegenda] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const legendaRef = useRef<HTMLInputElement>(null)
  const tipo = tipoDoArquivo(arquivo.type)

  useEffect(() => {
    const criada = URL.createObjectURL(arquivo)
    setUrl(criada)
    legendaRef.current?.focus()
    return () => URL.revokeObjectURL(criada)
  }, [arquivo])

  return (
    <div
      role="dialog"
      aria-label="Enviar anexo"
      className="flex flex-col gap-3 border-t border-superficie-bloco bg-superficie-card p-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-campo bg-superficie-bloco">
          {url && tipo === 'IMAGEM' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Prévia do anexo" className="h-full w-full object-cover" />
          ) : url && tipo === 'VIDEO' ? (
            <video src={url} muted className="h-full w-full object-cover" />
          ) : (
            <IconeDocumento width={36} height={36} className="text-brand-texto" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-dado font-medium text-texto-principal">{arquivo.name}</span>
          <span className="text-rotulo text-texto-secundario">{tamanhoLegivel(arquivo.size)}</span>
        </div>
        <button
          type="button"
          onClick={aoCancelar}
          aria-label="Descartar anexo"
          className="rounded-pilula p-1.5 text-texto-secundario hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <IconeFechar />
        </button>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          aoEnviar(legenda)
        }}
      >
        <input
          ref={legendaRef}
          value={legenda}
          onChange={(e) => setLegenda(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && aoCancelar()}
          placeholder="Adicione uma legenda…"
          aria-label="Legenda do anexo"
          className="flex-1 rounded-pilula border border-borda-campo bg-superficie-bloco px-4 py-2 text-corpo text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        />
        <button
          type="submit"
          aria-label="Enviar anexo"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pilula bg-brand text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <IconeEnviar />
        </button>
      </form>
    </div>
  )
}

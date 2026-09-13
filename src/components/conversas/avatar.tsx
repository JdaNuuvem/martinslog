'use client'

import { useState } from 'react'
import { IconePerfil } from '@/components/layout/icones'
import { iniciais } from './formatadores'

type AvatarProps = { fotoUrl: string | null; nome: string | null; tamanho?: 'lista' | 'cabecalho' }

/**
 * Foto do contato, com as iniciais como reserva.
 *
 * A URL de foto do WhatsApp expira em alguns dias; quando ela quebra, o
 * `onError` troca para as iniciais em vez de deixar o ícone de imagem
 * partida na lista inteira.
 */
export function Avatar({ fotoUrl, nome, tamanho = 'lista' }: AvatarProps) {
  const [quebrou, setQuebrou] = useState(false)
  const medida = tamanho === 'cabecalho' ? 'h-10 w-10 text-dado' : 'h-12 w-12 text-corpo'
  const letras = iniciais(nome)

  if (fotoUrl && !quebrou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fotoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setQuebrou(true)}
        className={`${medida} shrink-0 rounded-pilula bg-superficie-bloco object-cover`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${medida} flex shrink-0 items-center justify-center rounded-pilula bg-[#dfe5e7] font-medium text-[#54656f]`}
    >
      {letras || <IconePerfil />}
    </span>
  )
}

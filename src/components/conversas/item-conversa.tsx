'use client'

import { memo } from 'react'
import type { ResumoConversa } from './api'
import { Avatar } from './avatar'
import { horarioDaLista, nomeDoContato, previaDaConversa } from './formatadores'

type ItemProps = {
  conversa: ResumoConversa
  selecionada: boolean
  aoAbrir: (conversa: ResumoConversa) => void
}

export const ItemConversa = memo(function ItemConversa({ conversa, selecionada, aoAbrir }: ItemProps) {
  const nome = nomeDoContato(conversa)
  const previa = previaDaConversa(conversa)
  const naoLidas = conversa.naoLidas

  return (
    <li>
      <button
        id={`conversa-${conversa.id}`}
        type="button"
        data-item-conversa=""
        onClick={() => aoAbrir(conversa)}
        aria-current={selecionada ? 'true' : undefined}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
          selecionada ? 'bg-[#f0f2f5]' : 'hover:bg-[#f5f6f6]'
        }`}
      >
        <Avatar fotoUrl={conversa.fotoUrl} nome={conversa.nome} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-corpo text-[#111b21]">{nome}</span>
            <time
              dateTime={conversa.ultimaMensagemEm}
              className={`shrink-0 text-rotulo ${naoLidas > 0 ? 'font-medium text-[#1fa855]' : 'text-[#667781]'}`}
            >
              {horarioDaLista(conversa.ultimaMensagemEm)}
            </time>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-dado ${naoLidas > 0 ? 'text-[#111b21]' : 'text-[#667781]'}`}>
              {previa || ' '}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {conversa.roboPausado ? (
                <span
                  title="Robô pausado: um atendente assumiu esta conversa"
                  className="rounded-pilula bg-alerta/20 px-2 text-rotulo font-medium text-texto-principal"
                >
                  Robô pausado
                </span>
              ) : null}
              {naoLidas > 0 ? (
                <span className="min-w-5 rounded-pilula bg-[#25d366] px-1.5 text-center text-rotulo font-bold text-white">
                  {naoLidas > 99 ? '99+' : naoLidas}
                  <span className="sr-only"> não lidas</span>
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
})

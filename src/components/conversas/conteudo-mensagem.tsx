'use client'

import { Fragment } from 'react'
import type { Mensagem } from './api'
import { hrefDoLink, segmentarTexto, tamanhoLegivel } from './formatadores'
import { IconeDocumento } from './icones'
import { PlayerAudio } from './player-audio'

type ConteudoProps = {
  mensagem: Mensagem
  termo: string
  aoAbrirImagem: (url: string, legenda: string | null) => void
}

/**
 * Texto com links clicáveis e o termo da busca marcado.
 *
 * Cada trecho sai como texto do React, nunca como HTML: a mensagem foi escrita
 * por um terceiro, e um `dangerouslySetInnerHTML` aqui seria uma porta aberta
 * para quem mandasse `<script>` pelo WhatsApp.
 */
export function TextoRico({ texto, termo }: { texto: string; termo: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-corpo text-texto-principal">
      {segmentarTexto(texto, termo).map((s, i) => {
        const conteudo = s.destaque ? <mark className="rounded-sm bg-alerta/40 text-inherit">{s.valor}</mark> : s.valor
        return s.tipo === 'link' ? (
          <a
            key={i}
            href={hrefDoLink(s.valor)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-texto underline underline-offset-2"
          >
            {conteudo}
          </a>
        ) : (
          <Fragment key={i}>{conteudo}</Fragment>
        )
      })}
    </p>
  )
}

/** O miolo do balão conforme o tipo — texto, foto, vídeo, áudio, documento ou figurinha. */
export function ConteudoMensagem({ mensagem, termo, aoAbrirImagem }: ConteudoProps) {
  const { midia, texto, tipo } = mensagem
  const legenda = texto ? <TextoRico texto={texto} termo={termo} /> : null

  if (tipo === 'TEXTO' || !midia) {
    if (tipo !== 'TEXTO' && tipo !== 'OUTRO' && !texto) {
      return <p className="text-dado italic text-texto-secundario">Mídia indisponível</p>
    }
    if (tipo === 'OUTRO' && !texto) {
      return <p className="text-dado italic text-texto-secundario">Mensagem não suportada</p>
    }
    return legenda
  }

  switch (tipo) {
    case 'IMAGEM':
      return (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => aoAbrirImagem(midia.url, texto)}
            aria-label="Abrir foto em tela cheia"
            className="overflow-hidden rounded-campo focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={midia.url}
              alt={texto ?? 'Foto'}
              loading="lazy"
              className="max-h-72 w-full min-w-40 bg-superficie-bloco object-cover"
            />
          </button>
          {legenda}
        </div>
      )
    case 'VIDEO':
      return (
        <div className="flex flex-col gap-1">
          <video
            src={midia.url}
            controls
            preload="none"
            playsInline
            className="max-h-72 w-full min-w-48 rounded-campo bg-black"
          />
          {legenda}
        </div>
      )
    case 'AUDIO':
      return (
        <div className="flex flex-col gap-1">
          <PlayerAudio url={midia.url} duracao={midia.duracao} doCliente={mensagem.autor === 'CLIENTE'} />
          {legenda}
        </div>
      )
    case 'DOCUMENTO':
      return (
        <div className="flex flex-col gap-1">
          <a
            href={midia.url}
            download={midia.nome ?? true}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-52 items-center gap-3 rounded-campo bg-black/5 p-3 hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <IconeDocumento width={28} height={28} className="shrink-0 text-brand-texto" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-dado font-medium text-texto-principal">{midia.nome ?? 'Documento'}</span>
              <span className="text-rotulo text-texto-secundario">
                {[tamanhoLegivel(midia.tamanho), 'Baixar'].filter(Boolean).join(' · ')}
              </span>
            </span>
          </a>
          {legenda}
        </div>
      )
    case 'FIGURINHA':
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={midia.url} alt="Figurinha" loading="lazy" className="h-32 w-32 object-contain" />
    default:
      return legenda ?? <p className="text-dado italic text-texto-secundario">Mensagem não suportada</p>
  }
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { duracaoLegivel } from './formatadores'
import { IconeEnviar, IconeLixeira } from './icones'

type GravadorProps = {
  aoEnviar: (audio: Blob, nomeArquivo: string, duracao: number) => void
  aoCancelar: () => void
  aoErro: (mensagem: string) => void
}

/**
 * Formatos na ordem de preferência.
 *
 * OGG/Opus é o formato de áudio de voz do próprio WhatsApp: chega no celular
 * do cliente como "mensagem de voz", não como arquivo. O Chrome não grava OGG,
 * só WebM/Opus — mesmo codec, outro envelope, que o servidor converte.
 */
const FORMATOS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']

function escolherFormato(): string | undefined {
  return FORMATOS.find((f) => MediaRecorder.isTypeSupported(f))
}

function explicarFalha(erro: unknown): string {
  const nome = erro instanceof DOMException ? erro.name : ''
  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    return 'O navegador bloqueou o microfone. Libere o acesso no cadeado ao lado do endereço e tente de novo.'
  }
  if (nome === 'NotFoundError') return 'Nenhum microfone encontrado neste computador.'
  if (nome === 'NotReadableError') return 'O microfone está sendo usado por outro programa.'
  return 'Não foi possível acessar o microfone.'
}

/**
 * Gravação de áudio: começa ao montar, termina em "enviar" ou "cancelar".
 *
 * As faixas do microfone são paradas em todos os caminhos de saída — enviar,
 * cancelar, trocar de conversa. Esquecer uma deixa o indicador vermelho de
 * "gravando" aceso na aba do navegador, e o atendente com razão desconfia
 * que a plataforma continua ouvindo.
 */
export function GravadorAudio({ aoEnviar, aoCancelar, aoErro }: GravadorProps) {
  const [inicio, setInicio] = useState<number | null>(null)
  const [segundos, setSegundos] = useState(0)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const destinoRef = useRef<'enviar' | 'cancelar'>('cancelar')
  const callbacks = useRef({ aoEnviar, aoErro })

  useEffect(() => {
    callbacks.current = { aoEnviar, aoErro }
  }, [aoEnviar, aoErro])

  useEffect(() => {
    let desmontado = false
    let stream: MediaStream | null = null
    const pararFaixas = () => stream?.getTracks().forEach((faixa) => faixa.stop())

    async function comecar() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        callbacks.current.aoErro('Este navegador não grava áudio. Use Chrome, Edge ou Firefox atualizados.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (erro) {
        if (!desmontado) callbacks.current.aoErro(explicarFalha(erro))
        return
      }
      if (desmontado) return pararFaixas()

      const formato = escolherFormato()
      const gravador = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined)
      const pedacos: Blob[] = []
      const comecouEm = Date.now()

      gravador.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.push(e.data)
      }
      gravador.onstop = () => {
        pararFaixas()
        if (destinoRef.current !== 'enviar') return
        if (pedacos.length === 0) {
          callbacks.current.aoErro('Nenhum som foi gravado. Confira o microfone e tente de novo.')
          return
        }
        const tipo = (gravador.mimeType || formato || 'audio/webm').split(';')[0] ?? 'audio/webm'
        const extensao = tipo.includes('ogg') ? 'ogg' : 'webm'
        callbacks.current.aoEnviar(
          new Blob(pedacos, { type: tipo }),
          `audio-${comecouEm}.${extensao}`,
          (Date.now() - comecouEm) / 1000,
        )
      }
      gravador.start(250)
      gravadorRef.current = gravador
      setInicio(comecouEm)
    }

    void comecar()
    return () => {
      desmontado = true
      const gravador = gravadorRef.current
      if (gravador && gravador.state !== 'inactive') gravador.stop()
      pararFaixas()
    }
  }, [])

  useEffect(() => {
    if (inicio === null) return
    const timer = setInterval(() => setSegundos((Date.now() - inicio) / 1000), 250)
    return () => clearInterval(timer)
  }, [inicio])

  function terminar(destino: 'enviar' | 'cancelar') {
    destinoRef.current = destino
    const gravador = gravadorRef.current
    if (gravador && gravador.state !== 'inactive') gravador.stop()
    if (destino === 'cancelar' || !gravador) aoCancelar()
  }

  return (
    <div className="flex flex-1 items-center gap-3" role="group" aria-label="Gravando áudio">
      <button
        type="button"
        onClick={() => terminar('cancelar')}
        aria-label="Cancelar gravação"
        className="rounded-pilula p-2 text-texto-secundario hover:bg-superficie-bloco hover:text-erro focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <IconeLixeira />
      </button>

      <div className="flex flex-1 items-center gap-3 rounded-lg bg-white px-4 py-2">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-pilula bg-erro motion-reduce:animate-none" aria-hidden="true" />
        <span className="font-mono text-dado tabular-nums text-texto-principal" aria-live="off">
          {duracaoLegivel(segundos)}
        </span>
        <span className="flex h-6 flex-1 items-center gap-1 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <span
              key={i}
              className="w-1 animate-pulse rounded-pilula bg-[#00a884]/60 motion-reduce:animate-none"
              style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 6) * 120}ms` }}
            />
          ))}
        </span>
        <span className="sr-only">{inicio === null ? 'Aguardando o microfone' : 'Gravando'}</span>
      </div>

      <button
        type="button"
        onClick={() => terminar('enviar')}
        disabled={inicio === null}
        aria-label="Enviar áudio"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pilula bg-[#00a884] text-white hover:bg-[#008f72] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
      >
        <IconeEnviar />
      </button>
    </div>
  )
}

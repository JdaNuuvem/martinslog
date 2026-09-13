'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api, mensagemDeErro, type Template } from './api'
import { filtrarTemplates, termoDaBarra, validarAnexo } from './formatadores'
import { GravadorAudio } from './gravador-audio'
import { IconeClipe, IconeEnviar, IconeMicrofone, IconeRaio } from './icones'
import { PreviaAnexo } from './previa-anexo'
import { ID_LISTA_TEMPLATES, SeletorTemplates } from './seletor-templates'
import type { Envio } from './usar-mensagens'

type CompositorProps = {
  conversaId: string
  perfilId: string
  aoEnviar: (envio: Envio) => void
  /** Arquivo solto sobre a conversa (arrastar e soltar), entregue pela tela de cima. */
  anexoRecebido: File | null
  aoReceberAnexo: () => void
}

const ACEITOS = 'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv,.zip'
const BOTAO_ICONE =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-pilula text-texto-secundario hover:bg-superficie-bloco hover:text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/** Seis linhas do corpo (16px × 1,6) mais o respiro vertical do campo. */
const ALTURA_MAXIMA_PX = 6 * 16 * 1.6 + 20

export function Compositor({ conversaId, perfilId, aoEnviar, anexoRecebido, aoReceberAnexo }: CompositorProps) {
  const [texto, setTexto] = useState('')
  const [anexo, setAnexo] = useState<File | null>(null)
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [erroTemplates, setErroTemplates] = useState<string | null>(null)
  const [buscaBotao, setBuscaBotao] = useState<string | null>(null)
  const [barraDispensada, setBarraDispensada] = useState<string | null>(null)
  const [indice, setIndice] = useState(0)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)

  const termoBarra = termoDaBarra(texto)
  const modoBarra = termoBarra !== null && texto !== barraDispensada
  const aberto = buscaBotao !== null || modoBarra
  const filtrados = aberto ? filtrarTemplates(templates ?? [], buscaBotao ?? termoBarra ?? '') : []

  useLayoutEffect(() => {
    const campo = campoRef.current
    if (!campo) return
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, ALTURA_MAXIMA_PX)}px`
  }, [texto])

  useEffect(() => {
    if (!aberto || templates !== null) return
    api
      .listarTemplates(perfilId)
      .then((r) => setTemplates(r.templates))
      .catch((e: unknown) => setErroTemplates(mensagemDeErro(e)))
  }, [aberto, templates, perfilId])

  useEffect(() => {
    if (!anexoRecebido) return
    const problema = validarAnexo(anexoRecebido)
    setErro(problema)
    if (!problema) setAnexo(anexoRecebido)
    aoReceberAnexo()
  }, [anexoRecebido, aoReceberAnexo])

  function escolherAnexo(arquivo: File) {
    const problema = validarAnexo(arquivo)
    setErro(problema)
    if (!problema) setAnexo(arquivo)
  }

  function enviarTexto() {
    const limpo = texto.trim()
    if (!limpo) return
    aoEnviar({ tipo: 'texto', texto: limpo })
    setTexto('')
    setErro(null)
  }

  function fecharSeletor() {
    setBuscaBotao(null)
    if (modoBarra) setBarraDispensada(texto)
    setIndice(0)
  }

  async function escolherTemplate(template: Template) {
    const substituir = modoBarra || !texto.trim()
    fecharSeletor()
    try {
      // O texto resolvido vai para o campo, nunca direto para o cliente: a
      // variável pode ter vindo vazia (pedido sem rastreio ainda) e só quem
      // atende percebe antes de mandar.
      const r = await api.aplicarTemplate(conversaId, template.id)
      setTexto((atual) => (substituir ? r.texto : `${atual.replace(/\s+$/, '')}\n${r.texto}`))
      setErro(null)
      requestAnimationFrame(() => {
        const campo = campoRef.current
        campo?.focus()
        campo?.setSelectionRange(campo.value.length, campo.value.length)
      })
    } catch (e) {
      setErro(mensagemDeErro(e))
    }
  }

  function teclarNoSeletor(e: KeyboardEvent<HTMLElement>): boolean {
    if (!aberto) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      fecharSeletor()
      campoRef.current?.focus()
      return true
    }
    if (filtrados.length === 0) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setIndice((i) => (i + passo + filtrados.length) % filtrados.length)
      return true
    }
    const escolhido = filtrados[Math.min(indice, filtrados.length - 1)]
    if ((e.key === 'Enter' || e.key === 'Tab') && escolhido) {
      e.preventDefault()
      void escolherTemplate(escolhido)
      return true
    }
    return false
  }

  if (anexo) {
    return (
      <PreviaAnexo
        arquivo={anexo}
        aoCancelar={() => setAnexo(null)}
        aoEnviar={(legenda) => {
          aoEnviar({ tipo: 'arquivo', arquivo: anexo, legenda })
          setAnexo(null)
        }}
      />
    )
  }

  return (
    <div className="relative border-t border-superficie-bloco bg-superficie-card px-2 py-2">
      {aberto ? (
        <SeletorTemplates
          templates={filtrados}
          carregando={templates === null && !erroTemplates}
          erro={erroTemplates}
          indice={Math.min(indice, Math.max(0, filtrados.length - 1))}
          termoBusca={buscaBotao}
          perfilId={perfilId}
          aoMudarTermo={(t) => {
            setBuscaBotao(t)
            setIndice(0)
          }}
          aoTeclar={teclarNoSeletor}
          aoPassarPor={setIndice}
          aoEscolher={(t) => void escolherTemplate(t)}
        />
      ) : null}

      {erro ? (
        <p role="alert" className="mx-2 mb-2 rounded-campo bg-erro-fundo px-3 py-2 text-dado text-erro">
          {erro}
        </p>
      ) : null}

      <div className="flex items-end gap-1">
        {gravando ? (
          <GravadorAudio
            aoCancelar={() => setGravando(false)}
            aoErro={(mensagem) => {
              setErro(mensagem)
              setGravando(false)
            }}
            aoEnviar={(audio, nomeArquivo, duracao) => {
              aoEnviar({ tipo: 'audio', audio, nomeArquivo, duracao })
              setGravando(false)
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => (buscaBotao === null ? setBuscaBotao('') : fecharSeletor())}
              aria-label="Templates de mensagem"
              aria-expanded={buscaBotao !== null}
              className={BOTAO_ICONE}
            >
              <IconeRaio />
            </button>
            <button type="button" onClick={() => arquivoRef.current?.click()} aria-label="Anexar arquivo" className={BOTAO_ICONE}>
              <IconeClipe />
            </button>
            <input
              ref={arquivoRef}
              type="file"
              accept={ACEITOS}
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0]
                if (arquivo) escolherAnexo(arquivo)
                e.target.value = ''
              }}
            />
            <textarea
              ref={campoRef}
              rows={1}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value)
                setIndice(0)
              }}
              onKeyDown={(e) => {
                if (teclarNoSeletor(e)) return
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  enviarTexto()
                }
              }}
              onPaste={(e) => {
                const imagem = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
                if (imagem) {
                  e.preventDefault()
                  escolherAnexo(imagem)
                }
              }}
              placeholder="Mensagem  ·  / para templates"
              aria-label="Mensagem"
              role={modoBarra ? 'combobox' : undefined}
              aria-expanded={modoBarra ? true : undefined}
              aria-controls={modoBarra ? ID_LISTA_TEMPLATES : undefined}
              aria-activedescendant={modoBarra && filtrados[indice] ? `template-${filtrados[indice].id}` : undefined}
              className="min-h-11 flex-1 resize-none rounded-cartao border border-borda-campo bg-superficie-bloco px-4 py-2.5 text-corpo text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
            {texto.trim() ? (
              <button
                type="button"
                onClick={enviarTexto}
                aria-label="Enviar mensagem"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pilula bg-brand text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <IconeEnviar />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setErro(null)
                  setGravando(true)
                }}
                aria-label="Gravar áudio"
                className={BOTAO_ICONE}
              >
                <IconeMicrofone />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

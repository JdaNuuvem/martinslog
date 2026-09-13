'use client'

import { useRef, useState, type FormEvent } from 'react'
import { mensagemDeErro, type Template } from '../api'
import {
  VARIAVEIS,
  marcadorDaVariavel,
  normalizarAtalho,
  previaComExemplos,
  validarTemplate,
  type ErrosTemplate,
} from './regras-template'

export type DadosFormulario = { titulo: string; atalho: string | null; texto: string }

type FormularioProps = {
  inicial: Template | null
  atalhosEmUso: Array<string | null>
  aoSalvar: (dados: DadosFormulario) => Promise<void>
  aoCancelar: () => void
}

const CAMPO =
  'w-full rounded-campo border bg-superficie-card px-3 py-2 text-corpo text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export function FormularioTemplate({ inicial, atalhosEmUso, aoSalvar, aoCancelar }: FormularioProps) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [atalho, setAtalho] = useState(inicial?.atalho ?? '')
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [erros, setErros] = useState<ErrosTemplate>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const textoRef = useRef<HTMLTextAreaElement>(null)

  /** Insere a variável onde está o cursor — no fim só se o campo nunca recebeu foco. */
  function inserirVariavel(chave: string) {
    const campo = textoRef.current
    const marcador = marcadorDaVariavel(chave)
    const inicio = campo?.selectionStart ?? texto.length
    const fim = campo?.selectionEnd ?? texto.length
    setTexto(texto.slice(0, inicio) + marcador + texto.slice(fim))
    requestAnimationFrame(() => {
      campo?.focus()
      campo?.setSelectionRange(inicio + marcador.length, inicio + marcador.length)
    })
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const encontrados = validarTemplate({ titulo, atalho, texto }, atalhosEmUso)
    setErros(encontrados)
    setErroGeral(null)
    const primeiro = (['titulo', 'atalho', 'texto'] as const).find((campo) => encontrados[campo])
    if (primeiro) {
      document.getElementById(`template-${primeiro}`)?.focus()
      return
    }
    setSalvando(true)
    try {
      await aoSalvar({ titulo: titulo.trim(), atalho: normalizarAtalho(atalho), texto })
    } catch (erro) {
      setErroGeral(mensagemDeErro(erro))
    } finally {
      setSalvando(false)
    }
  }

  const borda = (campo: keyof ErrosTemplate) => (erros[campo] ? 'border-erro' : 'border-borda-campo')

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4 rounded-cartao bg-superficie-card p-bloco shadow-elevado">
      <h2 className="text-subtitulo font-bold text-texto-principal">{inicial ? 'Editar template' : 'Novo template'}</h2>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-dado font-medium text-texto-principal">Título</span>
          <input
            id="template-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Código de rastreio"
            aria-invalid={Boolean(erros.titulo)}
            aria-describedby={erros.titulo ? 'erro-template-titulo' : undefined}
            className={`${CAMPO} ${borda('titulo')}`}
          />
          {erros.titulo ? <span id="erro-template-titulo" className="text-rotulo text-erro">{erros.titulo}</span> : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-dado font-medium text-texto-principal">
            Atalho <span className="font-normal text-texto-secundario">(opcional)</span>
          </span>
          <span className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-secundario">/</span>
            <input
              id="template-atalho"
              value={atalho}
              onChange={(e) => setAtalho(e.target.value.replace(/\s/g, ''))}
              placeholder="rastreio"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(erros.atalho)}
              aria-describedby="ajuda-template-atalho"
              className={`${CAMPO} ${borda('atalho')} pl-6`}
            />
          </span>
          <span id="ajuda-template-atalho" className={`text-rotulo ${erros.atalho ? 'text-erro' : 'text-texto-secundario'}`}>
            {erros.atalho ?? 'Digite /atalho na conversa para usar.'}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="template-texto" className="text-dado font-medium text-texto-principal">
          Texto da mensagem
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Inserir variável">
          {VARIAVEIS.map((v) => (
            <button
              key={v.chave}
              type="button"
              onClick={() => inserirVariavel(v.chave)}
              className="rounded-pilula border border-borda-campo px-3 py-1 text-rotulo font-medium text-brand-texto hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              + {v.rotulo}
            </button>
          ))}
        </div>
        <textarea
          id="template-texto"
          ref={textoRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="Olá {{cliente}}! Seu pedido {{pedido}} já foi postado. Acompanhe: {{link_rastreio}}"
          aria-invalid={Boolean(erros.texto)}
          aria-describedby={erros.texto ? 'erro-template-texto' : undefined}
          className={`${CAMPO} ${borda('texto')} resize-y`}
        />
        {erros.texto ? <span id="erro-template-texto" className="text-rotulo text-erro">{erros.texto}</span> : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-dado font-medium text-texto-principal">Prévia com valores de exemplo</span>
        <div className="rounded-cartao bg-superficie-bloco p-4">
          <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-cartao bg-brand-bg px-3 py-2 text-corpo text-texto-principal shadow-elevado">
            {texto.trim() ? previaComExemplos(texto) : 'A mensagem aparece aqui enquanto você escreve.'}
          </p>
        </div>
      </div>

      {erroGeral ? (
        <p role="alert" className="rounded-campo bg-erro-fundo px-3 py-2 text-dado text-erro">
          {erroGeral}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={salvando}
          className="rounded-pilula bg-brand px-6 py-2 text-dado font-medium text-white hover:bg-brand-light disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : 'Salvar template'}
        </button>
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded-pilula border border-borda-campo px-6 py-2 text-dado font-medium text-texto-secundario"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

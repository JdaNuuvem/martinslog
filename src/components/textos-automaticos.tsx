'use client'

import { useCallback, useEffect, useState } from 'react'

type Template = {
  evento: string
  rotulo: string
  texto: string
  ativo: boolean
  personalizado: boolean
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Os textos que saem sozinhos a cada passo do pedido.
 *
 * Antes disto eles nasciam do código e ficavam iguais para todas as lojas —
 * não havia tela nenhuma. Editar aqui é o que faz cada marca falar como ela
 * fala, que é o motivo de `nomeExibicao` existir.
 */
export function TextosAutomaticos() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [variaveis, setVariaveis] = useState<string[]>([])
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    const resposta = await fetch('/api/mensagens/templates')
    if (!resposta.ok) {
      setErro('Não foi possível carregar os textos.')
      setCarregando(false)
      return
    }
    const corpo = (await resposta.json()) as { templates: Template[]; variaveis: string[] }
    setTemplates(corpo.templates)
    setVariaveis(corpo.variaveis)
    setRascunhos(Object.fromEntries(corpo.templates.map((t) => [t.evento, t.texto])))
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar(evento: string) {
    setSalvando(evento)
    setErro(null)
    setAviso(null)
    try {
      const resposta = await fetch('/api/mensagens/templates', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evento, texto: rascunhos[evento] ?? '' }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar.')
        return
      }
      setAviso('Texto salvo. Vale a partir da próxima mensagem.')
      await carregar()
    } finally {
      setSalvando(null)
    }
  }

  async function restaurar(evento: string) {
    await fetch(`/api/mensagens/templates?evento=${encodeURIComponent(evento)}`, {
      method: 'DELETE',
    })
    setAviso('Texto voltou ao padrão.')
    await carregar()
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Mensagens de cada etapa</h2>
        <p className="text-sm text-texto-secundario">
          O que o comprador recebe sozinho quando o pedido anda. Use{' '}
          {variaveis.map((v) => (
            <span key={v} className="font-mono text-xs">
              {`{{${v}}} `}
            </span>
          ))}
          para encaixar os dados do pedido.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-3 text-sm text-erro">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="rounded-lg bg-brand-bg p-3 text-sm text-brand-texto">
          {aviso}
        </p>
      ) : null}

      {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}

      <div className="flex flex-col gap-4">
        {templates.map((t) => (
          <div key={t.evento} className="flex flex-col gap-2 border-t border-borda-campo pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`texto-${t.evento}`} className="text-sm font-medium text-texto-principal">
                {t.rotulo}
                {t.personalizado ? (
                  <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-normal text-brand-texto">
                    personalizado
                  </span>
                ) : null}
              </label>
              {t.personalizado ? (
                <button
                  type="button"
                  onClick={() => void restaurar(t.evento)}
                  className="text-xs font-medium text-texto-secundario hover:underline"
                >
                  Voltar ao padrão
                </button>
              ) : null}
            </div>

            <textarea
              id={`texto-${t.evento}`}
              value={rascunhos[t.evento] ?? ''}
              onChange={(e) => setRascunhos((r) => ({ ...r, [t.evento]: e.target.value }))}
              rows={2}
              className={CAMPO}
            />

            <button
              type="button"
              onClick={() => void salvar(t.evento)}
              disabled={salvando === t.evento || rascunhos[t.evento] === t.texto}
              className="self-start rounded-pilula bg-brand px-5 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando === t.evento ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

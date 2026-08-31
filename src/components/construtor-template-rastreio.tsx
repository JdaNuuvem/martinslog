'use client'

import { useCallback, useEffect, useState } from 'react'

type ItemPaleta = {
  codigo: string
  rotulo: string
  descricaoPadrao: string
  statusResultante: string
  diasSugeridos: number
  terminal: boolean
}

type Passo = {
  codigo: string
  titulo: string
  descricao: string
  diasAposEmissao: number
}

const CAMPO =
  'rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Construtor do percurso do rastreio.
 *
 * A conta escolhe entre dois modos: o caminho padrão da simulação, que varia
 * por cenário, ou um template próprio — uma sequência literal pela qual todo
 * envio dela passa, na ordem declarada.
 *
 * A ordem é o dado principal, então a interface é uma lista com subir e
 * descer, e não um formulário de campos soltos. A posição no tempo já nasce
 * preenchida com o valor sugerido de cada etapa: quem não quiser mexer só
 * ordena.
 */
export function ConstrutorTemplateRastreio() {
  const [paleta, setPaleta] = useState<ItemPaleta[]>([])
  const [padrao, setPadrao] = useState<Passo[]>([])
  const [passos, setPassos] = useState<Passo[]>([])
  const [usaTemplate, setUsaTemplate] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/rastreio-template')
      if (!resposta.ok) {
        setErro('Não foi possível carregar o template.')
        return
      }
      const corpo = (await resposta.json()) as {
        template: { passos: Passo[]; ativo: boolean } | null
        paleta: ItemPaleta[]
        padrao: Passo[]
      }
      setPaleta(corpo.paleta)
      setPadrao(corpo.padrao)
      setUsaTemplate(Boolean(corpo.template))
      setPassos(corpo.template?.passos ?? corpo.padrao)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function acrescentar(item: ItemPaleta) {
    setErro(null)
    setPassos((atuais) => [
      ...atuais,
      {
        codigo: item.codigo,
        titulo: item.rotulo,
        descricao: item.descricaoPadrao,
        diasAposEmissao: item.diasSugeridos,
      },
    ])
  }

  function remover(indice: number) {
    setPassos((atuais) => atuais.filter((_, i) => i !== indice))
  }

  function mover(indice: number, direcao: -1 | 1) {
    setPassos((atuais) => {
      const destino = indice + direcao
      if (destino < 0 || destino >= atuais.length) return atuais
      const copia = [...atuais]
      const [movido] = copia.splice(indice, 1)
      copia.splice(destino, 0, movido!)
      return copia
    })
  }

  function editar(indice: number, campo: keyof Passo, valor: string | number) {
    setPassos((atuais) =>
      atuais.map((passo, i) => (i === indice ? { ...passo, [campo]: valor } : passo)),
    )
  }

  async function salvar() {
    setErro(null)
    setAviso(null)
    setSalvando(true)
    try {
      const resposta = await fetch('/api/rastreio-template', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passos }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar o template.')
        return
      }
      setUsaTemplate(true)
      setAviso('Template salvo. Envios novos passam a seguir este percurso.')
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function voltarAoPadrao() {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/rastreio-template', { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 204) {
      setErro('Não foi possível voltar ao caminho padrão.')
      return
    }
    setUsaTemplate(false)
    setPassos(padrao)
    setAviso('Voltou ao caminho padrão. Envios novos seguem a simulação por cenário.')
  }

  const jaUsados = new Set(passos.map((passo) => passo.codigo))

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Percurso do rastreio</h2>
        <p className="text-sm text-texto-secundario">
          Use o caminho padrão, que varia conforme o que acontece com a encomenda, ou monte a
          sequência exata pela qual todos os seus envios passam.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg bg-superficie-bloco p-2" role="radiogroup" aria-label="Modo do percurso">
        <button
          type="button"
          role="radio"
          aria-checked={!usaTemplate}
          onClick={voltarAoPadrao}
          className={`rounded-pilula px-4 py-2 text-sm font-medium ${
            !usaTemplate ? 'bg-brand text-white' : 'text-texto-secundario'
          }`}
        >
          Caminho padrão
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={usaTemplate}
          onClick={() => setUsaTemplate(true)}
          className={`rounded-pilula px-4 py-2 text-sm font-medium ${
            usaTemplate ? 'bg-brand text-white' : 'text-texto-secundario'
          }`}
        >
          Template personalizado
        </button>
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

      {!carregando && !usaTemplate ? (
        <p className="text-sm text-texto-secundario">
          Seus envios seguem a simulação padrão: entrega normal, atraso, tentativa sem sucesso,
          extravio ou devolução, conforme o cenário de cada envio.
        </p>
      ) : null}

      {!carregando && usaTemplate ? (
        <>
          <ol className="flex flex-col gap-3">
            {passos.map((passo, indice) => (
              <li
                key={`${passo.codigo}-${indice}`}
                className="flex flex-col gap-2 rounded-lg border border-borda-campo bg-superficie-bloco p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-texto-principal">
                    {indice + 1}. {passo.codigo}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => mover(indice, -1)}
                      disabled={indice === 0}
                      aria-label={`Subir passo ${indice + 1}`}
                      className="rounded-lg px-2 py-1 text-sm text-brand-texto disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(indice, 1)}
                      disabled={indice === passos.length - 1}
                      aria-label={`Descer passo ${indice + 1}`}
                      className="rounded-lg px-2 py-1 text-sm text-brand-texto disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remover(indice)}
                      aria-label={`Remover passo ${indice + 1}`}
                      className="rounded-lg px-2 py-1 text-sm text-erro"
                    >
                      Remover
                    </button>
                  </div>
                </div>

                <label className="flex flex-col gap-1 text-xs text-texto-secundario">
                  Título na timeline
                  <input
                    className={CAMPO}
                    value={passo.titulo}
                    onChange={(e) => editar(indice, 'titulo', e.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-texto-secundario">
                  Descrição
                  <input
                    className={CAMPO}
                    value={passo.descricao}
                    onChange={(e) => editar(indice, 'descricao', e.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-texto-secundario">
                  Dias após a emissão
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    className={`${CAMPO} w-32`}
                    value={passo.diasAposEmissao}
                    onChange={(e) => editar(indice, 'diasAposEmissao', Number(e.target.value))}
                  />
                </label>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2 border-t border-borda-campo pt-4">
            <h3 className="text-sm font-bold text-texto-principal">Acrescentar etapa</h3>
            <div className="flex flex-wrap gap-2">
              {paleta.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  onClick={() => acrescentar(item)}
                  disabled={jaUsados.has(item.codigo)}
                  title={
                    item.terminal ? 'Encerra o envio: precisa ser o último passo' : undefined
                  }
                  className="rounded-pilula border border-borda-campo px-3 py-1.5 text-sm text-texto-principal hover:bg-superficie-bloco disabled:opacity-40"
                >
                  {item.rotulo}
                  {item.terminal ? ' ·' : ''}
                </button>
              ))}
            </div>
            <p className="text-xs text-texto-secundario">
              As etapas marcadas com · encerram o envio e só podem ser a última do percurso.
            </p>
          </div>

          <button
            type="button"
            onClick={salvar}
            disabled={salvando || passos.length === 0}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar template'}
          </button>
        </>
      ) : null}
    </section>
  )
}

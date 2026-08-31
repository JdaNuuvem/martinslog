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

type StatusPadrao = { codigo: string; titulo: string; descricao: string }

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const ROTULO_STATUS: Record<string, string> = {
  GENERATED: 'Etiqueta gerada',
  POSTED: 'Em trânsito',
  DELIVERED: 'Entregue',
  LOST: 'Extraviado',
}

/**
 * Configuração do percurso do rastreio, como um fluxo.
 *
 * Esta tela é a única superfície de configuração: o texto de cada etapa, a
 * posição no tempo e a existência da etapa se editam no próprio nó do fluxo.
 * Antes havia três mecanismos concorrentes na mesma página — um formulário
 * de status avulso, uma lista de padrões e o construtor —, e era preciso
 * saber qual deles mexia em quê. Um fluxo com nós editáveis diz sozinho o
 * que cada coisa faz.
 *
 * Dois modos:
 * - **Caminho padrão**: os nós vêm da simulação e são só de leitura, exceto
 *   o texto, que a conta pode reescrever.
 * - **Template personalizado**: a conta declara a sequência inteira.
 */
export function ConstrutorTemplateRastreio() {
  const [paleta, setPaleta] = useState<ItemPaleta[]>([])
  const [padraoDoFluxo, setPadraoDoFluxo] = useState<Passo[]>([])
  const [statusPadrao, setStatusPadrao] = useState<StatusPadrao[]>([])
  const [passos, setPassos] = useState<Passo[]>([])
  const [usaTemplate, setUsaTemplate] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Set<number>>(new Set())

  const carregar = useCallback(async () => {
    try {
      const [respTemplate, respCatalogo] = await Promise.all([
        fetch('/api/rastreio-template'),
        fetch('/api/status-rastreio'),
      ])

      if (!respTemplate.ok) {
        setErro('Não foi possível carregar o percurso.')
        return
      }

      const corpo = (await respTemplate.json()) as {
        template: { passos: Passo[]; ativo: boolean } | null
        paleta: ItemPaleta[]
        padrao: Passo[]
      }
      setPaleta(corpo.paleta)
      setPadraoDoFluxo(corpo.padrao)
      setUsaTemplate(Boolean(corpo.template))
      setPassos(corpo.template?.passos ?? corpo.padrao)

      if (respCatalogo.ok) {
        const cat = (await respCatalogo.json()) as {
          padrao: StatusPadrao[]
          personalizados: StatusPadrao[]
        }
        // A personalização da conta cobre o texto padrão, então ela vence na
        // exibição — é o que o destinatário vai ler.
        const porCodigo = new Map(cat.padrao.map((item) => [item.codigo, item]))
        for (const item of cat.personalizados) porCodigo.set(item.codigo, item)
        setStatusPadrao([...porCodigo.values()])
      }
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function alternarAberto(indice: number) {
    setAbertos((atuais) => {
      const copia = new Set(atuais)
      if (copia.has(indice)) copia.delete(indice)
      else copia.add(indice)
      return copia
    })
  }

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
        setErro(corpo.mensagem ?? 'Não foi possível salvar o fluxo.')
        return
      }
      setUsaTemplate(true)
      setAviso('Fluxo salvo. Envios novos passam a seguir este percurso.')
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  /** Reescreve o texto de uma etapa do caminho padrão, via catálogo. */
  async function salvarTextoPadrao(codigo: string, titulo: string, descricao: string) {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/status-rastreio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: codigo, titulo, descricao }),
    })
    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
      setErro(corpo.mensagem ?? 'Não foi possível salvar o texto.')
      return
    }
    setAviso(`Texto de "${titulo}" salvo.`)
    await carregar()
  }

  async function usarCaminhoPadrao() {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/rastreio-template', { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 204) {
      setErro('Não foi possível voltar ao caminho padrão.')
      return
    }
    setUsaTemplate(false)
    setPassos(padraoDoFluxo)
    setAviso('Voltou ao caminho padrão. Envios novos seguem a simulação por cenário.')
  }

  const jaUsados = new Set(passos.map((passo) => passo.codigo))
  const nosVisiveis = usaTemplate ? passos : padraoDoFluxo

  return (
    <section
      aria-label="Fluxo do rastreio"
      className="flex flex-col gap-5 rounded-xl bg-superficie-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Fluxo do rastreio</h2>
        <p className="text-sm text-texto-secundario">
          Cada nó é uma etapa que o seu cliente vê na timeline. Clique em um nó para editar o
          texto e quando ele acontece.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Modo do fluxo"
        className="flex flex-wrap gap-2 rounded-lg bg-superficie-bloco p-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!usaTemplate}
          onClick={usarCaminhoPadrao}
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
          Fluxo personalizado
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
          Estes são os nós da simulação padrão. Você pode reescrever o texto de cada um; para
          mudar quais etapas existem e quando acontecem, use o fluxo personalizado.
        </p>
      ) : null}

      {!carregando ? (
        <ol className="flex flex-col">
          {nosVisiveis.map((passo, indice) => {
            const item = paleta.find((p) => p.codigo === passo.codigo)
            const aberto = abertos.has(indice)
            const textoPadrao = statusPadrao.find((s) => s.codigo === passo.codigo)
            const titulo = usaTemplate ? passo.titulo : (textoPadrao?.titulo ?? passo.titulo)
            const descricao = usaTemplate
              ? passo.descricao
              : (textoPadrao?.descricao ?? passo.descricao)

            return (
              <li key={`${passo.codigo}-${indice}`} className="flex flex-col">
                <div className="flex items-stretch gap-3">
                  {/* Trilho do fluxo: bolinha do nó e linha até o próximo. */}
                  <div className="flex w-6 flex-col items-center pt-4" aria-hidden="true">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ${
                        item?.terminal ? 'bg-texto-secundario' : 'bg-brand'
                      }`}
                    />
                    {indice < nosVisiveis.length - 1 ? (
                      <span className="w-0.5 flex-1 bg-borda-campo" />
                    ) : null}
                  </div>

                  <div className="mb-3 flex-1 rounded-lg border border-borda-campo bg-superficie-bloco">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => alternarAberto(indice)}
                        aria-expanded={aberto}
                        className="flex flex-1 flex-col items-start text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        <span className="text-sm font-bold text-texto-principal">{titulo}</span>
                        <span className="text-xs text-texto-secundario">
                          {usaTemplate ? `Dia ${passo.diasAposEmissao} · ` : ''}
                          {ROTULO_STATUS[item?.statusResultante ?? ''] ?? 'Em trânsito'}
                          {item?.terminal ? ' · encerra o envio' : ''}
                        </span>
                      </button>

                      {usaTemplate ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => mover(indice, -1)}
                            disabled={indice === 0}
                            aria-label={`Subir ${titulo}`}
                            className="rounded-lg px-2 py-1 text-brand-texto disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => mover(indice, 1)}
                            disabled={indice === nosVisiveis.length - 1}
                            aria-label={`Descer ${titulo}`}
                            className="rounded-lg px-2 py-1 text-brand-texto disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => remover(indice)}
                            aria-label={`Remover ${titulo}`}
                            className="rounded-lg px-2 py-1 text-sm text-erro"
                          >
                            Remover
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {aberto ? (
                      <div className="flex flex-col gap-3 border-t border-borda-campo p-3">
                        {usaTemplate ? (
                          <>
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
                                className={`${CAMPO} w-32`}
                                value={passo.diasAposEmissao}
                                onChange={(e) =>
                                  editar(indice, 'diasAposEmissao', Number(e.target.value))
                                }
                              />
                            </label>
                          </>
                        ) : (
                          <EditorTextoPadrao
                            codigo={passo.codigo}
                            titulo={titulo}
                            descricao={descricao}
                            onSalvar={salvarTextoPadrao}
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}

      {!carregando && usaTemplate ? (
        <>
          <div className="flex flex-col gap-2 border-t border-borda-campo pt-4">
            <h3 className="text-sm font-bold text-texto-principal">Acrescentar nó ao fluxo</h3>
            <div className="flex flex-wrap gap-2">
              {paleta.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  onClick={() => acrescentar(item)}
                  disabled={jaUsados.has(item.codigo)}
                  title={item.terminal ? 'Encerra o envio: precisa ser o último nó' : undefined}
                  className="rounded-pilula border border-borda-campo px-3 py-1.5 text-sm text-texto-principal hover:bg-superficie-bloco disabled:opacity-40"
                >
                  {item.rotulo}
                  {item.terminal ? ' ·' : ''}
                </button>
              ))}
            </div>
            <p className="text-xs text-texto-secundario">
              As etapas marcadas com · encerram o envio e só podem ser o último nó.
            </p>
          </div>

          <button
            type="button"
            onClick={salvar}
            disabled={salvando || passos.length === 0}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar fluxo'}
          </button>
        </>
      ) : null}
    </section>
  )
}

/** Edição do texto de uma etapa do caminho padrão, gravada no catálogo. */
function EditorTextoPadrao({
  codigo,
  titulo,
  descricao,
  onSalvar,
}: {
  codigo: string
  titulo: string
  descricao: string
  onSalvar: (codigo: string, titulo: string, descricao: string) => Promise<void>
}) {
  const [rascunhoTitulo, setRascunhoTitulo] = useState(titulo)
  const [rascunhoDescricao, setRascunhoDescricao] = useState(descricao)
  const [salvando, setSalvando] = useState(false)

  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-texto-secundario">
        Título na timeline
        <input
          className={CAMPO}
          value={rascunhoTitulo}
          onChange={(e) => setRascunhoTitulo(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-texto-secundario">
        Descrição
        <input
          className={CAMPO}
          value={rascunhoDescricao}
          onChange={(e) => setRascunhoDescricao(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={salvando}
        onClick={async () => {
          setSalvando(true)
          await onSalvar(codigo, rascunhoTitulo, rascunhoDescricao)
          setSalvando(false)
        }}
        className="self-start rounded-pilula bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {salvando ? 'Salvando…' : 'Salvar texto'}
      </button>
    </>
  )
}

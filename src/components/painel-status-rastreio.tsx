'use client'

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import {
  CENARIOS,
  STATUS_RESULTANTES,
  type StatusRastreioResposta,
} from '@/lib/status-rastreio-schema'

const ROTULO_CENARIO: Record<string, string> = {
  ENTREGA_NORMAL: 'Entrega normal',
  ATRASO: 'Atraso',
  TENTATIVA_FALHA: 'Tentativa de entrega falha',
  EXTRAVIO: 'Extravio',
  DEVOLUCAO: 'Devolução',
}

const ROTULO_STATUS: Record<string, string> = {
  GENERATED: 'Etiqueta gerada',
  POSTED: 'Em trânsito',
}

type Padrao = { codigo: string; titulo: string; descricao: string }

type EstadoForm = {
  nome: string
  titulo: string
  descricao: string
  entraNaTimeline: boolean
  cenario: string
  fracaoPrazo: string
  statusResultante: string
}

const FORM_VAZIO: EstadoForm = {
  nome: '',
  titulo: '',
  descricao: '',
  entraNaTimeline: false,
  cenario: 'ENTREGA_NORMAL',
  fracaoPrazo: '0.5',
  statusResultante: 'POSTED',
}

const CAMPO =
  'rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Painel onde a conta reescreve as copies do rastreio e cria etapas próprias.
 *
 * Duas coisas distintas convivem aqui, e a interface precisa deixar claro
 * qual é qual: reescrever o texto de um evento que já existe não muda a
 * forma da timeline; criar uma etapa nova acrescenta um evento a ela.
 */
export function PainelStatusRastreio() {
  const idBase = useId()
  const [personalizados, setPersonalizados] = useState<StatusRastreioResposta[]>([])
  const [padrao, setPadrao] = useState<Padrao[]>([])
  const [codigosPadrao, setCodigosPadrao] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<EstadoForm>(FORM_VAZIO)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/status-rastreio')
      if (!resposta.ok) {
        setErro('Não foi possível carregar os status.')
        return
      }
      const corpo = (await resposta.json()) as {
        personalizados: StatusRastreioResposta[]
        padrao: Padrao[]
        codigosPadrao: string[]
      }
      setPersonalizados(corpo.personalizados)
      setPadrao(corpo.padrao)
      setCodigosPadrao(corpo.codigosPadrao)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function atualizar<K extends keyof EstadoForm>(campo: K, valor: EstadoForm[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSalvando(true)

    try {
      const resposta = await fetch('/api/status-rastreio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome,
          titulo: form.titulo,
          descricao: form.descricao,
          cenario: form.entraNaTimeline ? form.cenario : null,
          fracaoPrazo: form.entraNaTimeline ? Number(form.fracaoPrazo) : null,
          statusResultante: form.entraNaTimeline ? form.statusResultante : null,
        }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar o status.')
        return
      }

      setForm(FORM_VAZIO)
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(id: string) {
    setErro(null)
    const resposta = await fetch(`/api/status-rastreio/${id}`, { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 204) {
      setErro('Não foi possível remover o status.')
      return
    }
    await carregar()
  }

  function personalizar(codigo: string) {
    const base = padrao.find((p) => p.codigo === codigo)
    setForm({
      ...FORM_VAZIO,
      nome: codigo,
      titulo: base?.titulo ?? '',
      descricao: base?.descricao ?? '',
    })
  }

  return (
    <div className="mx-auto flex max-w-conteudo flex-col gap-6 py-8">
      <header>
        <h1 className="text-2xl font-bold text-texto-principal">Status do rastreio</h1>
        <p className="mt-1 text-sm text-texto-secundario">
          Reescreva o texto que seu cliente lê na timeline e crie etapas próprias. O que você não
          personalizar continua com o texto padrão.
        </p>
      </header>

      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      <form onSubmit={salvar} className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Novo status ou personalização</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-nome`} className="text-sm font-medium text-texto-secundario">
            Nome do status
          </label>
          <input
            id={`${idBase}-nome`}
            value={form.nome}
            onChange={(e) => atualizar('nome', e.target.value)}
            placeholder="Em conferência"
            className={CAMPO}
          />
          <p className="text-xs text-texto-secundario">
            Use o nome de um status padrão para reescrever o texto dele, ou um nome novo para criar
            uma etapa.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-titulo`} className="text-sm font-medium text-texto-secundario">
            Título na timeline
          </label>
          <input
            id={`${idBase}-titulo`}
            value={form.titulo}
            onChange={(e) => atualizar('titulo', e.target.value)}
            placeholder="Sua encomenda saiu da nossa loja"
            className={CAMPO}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${idBase}-descricao`}
            className="text-sm font-medium text-texto-secundario"
          >
            Descrição
          </label>
          <input
            id={`${idBase}-descricao`}
            value={form.descricao}
            onChange={(e) => atualizar('descricao', e.target.value)}
            placeholder="Já separamos seu pedido e ele está a caminho"
            className={CAMPO}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-texto-principal">
          <input
            type="checkbox"
            checked={form.entraNaTimeline}
            onChange={(e) => atualizar('entraNaTimeline', e.target.checked)}
          />
          Este status é uma etapa nova na linha do tempo
        </label>

        {form.entraNaTimeline ? (
          <div className="flex flex-col gap-4 rounded-lg border border-borda-campo p-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor={`${idBase}-cenario`}
                className="text-sm font-medium text-texto-secundario"
              >
                Cenário
              </label>
              <select
                id={`${idBase}-cenario`}
                value={form.cenario}
                onChange={(e) => atualizar('cenario', e.target.value)}
                className={CAMPO}
              >
                {CENARIOS.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CENARIO[c] ?? c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor={`${idBase}-fracao`}
                className="text-sm font-medium text-texto-secundario"
              >
                Posição no prazo
              </label>
              <input
                id={`${idBase}-fracao`}
                type="number"
                step="0.05"
                min="0.05"
                max="5"
                value={form.fracaoPrazo}
                onChange={(e) => atualizar('fracaoPrazo', e.target.value)}
                className={CAMPO}
              />
              <p className="text-xs text-texto-secundario">
                Fração do prazo: 0,5 é a metade do caminho; 1,0 é a entrega.
              </p>
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor={`${idBase}-status`}
                className="text-sm font-medium text-texto-secundario"
              >
                Status do envio
              </label>
              <select
                id={`${idBase}-status`}
                value={form.statusResultante}
                onChange={(e) => atualizar('statusResultante', e.target.value)}
                className={CAMPO}
              >
                {STATUS_RESULTANTES.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={salvando}
          className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : 'Salvar status'}
        </button>
      </form>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Seus status</h2>
        {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}
        {!carregando && personalizados.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Nenhuma personalização ainda. Sua timeline usa os textos padrão.
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {personalizados.map((status) => (
            <li
              key={status.id}
              className="flex flex-col gap-2 rounded-lg border border-borda-campo bg-superficie-bloco p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-texto-principal">
                  {status.titulo}
                  {status.fracaoPrazo != null ? (
                    <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                      Etapa em {status.fracaoPrazo}× o prazo
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-texto-secundario">Texto personalizado</span>
                  )}
                </p>
                <p className="text-sm text-texto-secundario">{status.descricao}</p>
                <p className="font-mono text-xs text-texto-secundario">{status.codigo}</p>
              </div>
              <button
                type="button"
                onClick={() => remover(status.id)}
                className="text-sm font-medium text-erro hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Status padrão</h2>
        <p className="text-sm text-texto-secundario">
          Estes são gerados automaticamente. Clique para reescrever o texto de qualquer um.
        </p>
        <ul className="flex flex-col gap-2">
          {codigosPadrao.map((codigo) => {
            const base = padrao.find((p) => p.codigo === codigo)
            const jaPersonalizado = personalizados.some((p) => p.codigo === codigo)
            return (
              <li
                key={codigo}
                className="flex items-center justify-between gap-3 rounded-lg border border-borda-campo p-3"
              >
                <div>
                  <p className="text-sm text-texto-principal">{base?.titulo ?? codigo}</p>
                  <p className="font-mono text-xs text-texto-secundario">{codigo}</p>
                </div>
                <button
                  type="button"
                  onClick={() => personalizar(codigo)}
                  className="text-sm font-medium text-brand-texto hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {jaPersonalizado ? 'Editar texto' : 'Personalizar'}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

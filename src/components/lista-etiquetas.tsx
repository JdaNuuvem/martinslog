'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ABAS,
  ROTULOS_ABA,
  type AbaEtiquetas,
  type EtiquetaResumo,
  type ListaEtiquetasResposta,
} from '@/lib/etiquetas-schema'

const ROTULO_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'Aguardando pagamento',
  RELEASED: 'Pago',
  GENERATED: 'Aguardando postagem',
  POSTED: 'Em trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  LOST: 'Extraviado',
}

const COR_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'bg-alerta text-texto-principal',
  RELEASED: 'bg-brand-bg text-brand-texto',
  GENERATED: 'bg-brand-bg text-brand-texto',
  POSTED: 'bg-info-bg text-info-text',
  DELIVERED: 'bg-brand text-white',
  CANCELLED: 'bg-superficie-bloco text-texto-secundario',
  LOST: 'bg-erro text-white',
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function Selo({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-pilula px-2 py-0.5 text-xs font-medium ${
        COR_STATUS[status] ?? 'bg-superficie-bloco text-texto-secundario'
      }`}
    >
      {ROTULO_STATUS[status] ?? status}
    </span>
  )
}

/**
 * Confirmação do cancelamento.
 *
 * O texto diz, sem rodeio, que o valor pago **não** volta. Um cliente que
 * cancela achando que recupera o dinheiro foi enganado pela tela, não pela
 * regra — e a regra aqui é irreversível.
 */
function ConfirmarCancelamento({
  etiqueta,
  cancelando,
  onConfirmar,
  onDesistir,
}: {
  etiqueta: EtiquetaResumo
  cancelando: boolean
  onConfirmar: () => void
  onDesistir: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-erro-fundo p-4">
      <p className="text-sm text-texto-principal">
        Cancelar o envio para <strong>{etiqueta.destinatarioNome}</strong>? O valor pago de{' '}
        <strong>{reais(etiqueta.valorCentavos)}</strong> não será devolvido, e a ação não pode
        ser desfeita.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={cancelando}
          onClick={onConfirmar}
          className="rounded-lg bg-erro px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {cancelando ? 'Cancelando…' : 'Cancelar sem reembolso'}
        </button>
        <button
          type="button"
          onClick={onDesistir}
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Manter o envio
        </button>
      </div>
    </div>
  )
}

export function ListaEtiquetas() {
  const [aba, setAba] = useState<AbaEtiquetas>('todos')
  const [busca, setBusca] = useState('')
  const [dados, setDados] = useState<ListaEtiquetasResposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const [avancandoId, setAvancandoId] = useState<string | null>(null)
  const [avancoRecente, setAvancoRecente] = useState<{ id: string; titulo: string } | null>(null)
  /*
    A seleção guarda IDS, não índices nem posições. A lista se refaz a cada
    carregamento — e recarregar é o que acontece logo depois de avançar — então
    posição não sobrevive à própria ação que a criou.
  */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [avancandoLote, setAvancandoLote] = useState(false)
  const [resumoLote, setResumoLote] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    setCarregando(true)

    try {
      const parametros = new URLSearchParams({ aba })
      if (busca.trim()) parametros.set('busca', busca.trim())

      const resposta = await fetch(`/api/etiquetas?${parametros}`)
      if (!resposta.ok) {
        setErro('Não foi possível carregar suas etiquetas.')
        return
      }

      setDados((await resposta.json()) as ListaEtiquetasResposta)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [aba, busca])

  useEffect(() => {
    // A busca dispara a cada tecla; o atraso evita uma consulta por
    // caractere digitado.
    const temporizador = setTimeout(carregar, busca ? 300 : 0)
    return () => clearTimeout(temporizador)
  }, [carregar, busca])

  async function cancelar(id: string) {
    setCancelandoId(id)
    setErro(null)

    try {
      const resposta = await fetch(`/api/etiquetas/${id}/cancelar`, { method: 'POST' })
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível cancelar este envio.')
        return
      }

      setConfirmandoId(null)
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCancelandoId(null)
    }
  }

  /*
    Avança o envio para a próxima etapa do percurso: a linha do tempo já
    existe inteira, datada no futuro, e isto puxa o próximo evento para agora
    — os seguintes andam junto, mantendo os intervalos do fluxo.
  */
  async function avancarEtapa(id: string) {
    setAvancandoId(id)
    setErro(null)
    setAvancoRecente(null)

    try {
      const resposta = await fetch(`/api/etiquetas/${id}/avancar`, { method: 'POST' })
      const corpo = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        etapa?: { titulo: string }
      }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível avançar a etapa deste envio.')
        return
      }

      if (corpo.etapa) setAvancoRecente({ id, titulo: corpo.etapa.titulo })
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setAvancandoId(null)
    }
  }

  const etiquetas = dados?.etiquetas ?? []

  /*
    Só entra na seleção quem PODE avançar. Deixar marcar o que não pode
    produziria um lote com metade de falhas previsíveis — e a mensagem de erro
    contando de volta algo que a tela já sabia antes de clicar.
  */
  const selecionaveis = etiquetas.filter((e) => e.podeAvancarEtapa)
  const marcados = selecionaveis.filter((e) => selecionados.has(e.id))
  const todosMarcados = selecionaveis.length > 0 && marcados.length === selecionaveis.length

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  function alternarTodos() {
    setSelecionados((atual) => {
      if (todosMarcados) {
        // Desmarca só os DESTA aba: quem selecionou em outra situação e trocou
        // de aba não perde a seleção que fez antes.
        const proximo = new Set(atual)
        for (const e of selecionaveis) proximo.delete(e.id)
        return proximo
      }
      return new Set([...atual, ...selecionaveis.map((e) => e.id)])
    })
  }

  /*
    Avança todos os marcados de uma vez.

    O resultado vem por envio, e é isso que a tela mostra: "38 avançados, 2 não
    deram" com o motivo do primeiro. Um "deu erro" seco depois de mover
    quarenta encomendas deixaria quem clicou sem saber o que aconteceu com
    quais — e a segunda tentativa puxaria OUTRA etapa nos que já andaram.
  */
  async function avancarSelecionados() {
    const ids = marcados.map((e) => e.id)
    if (ids.length === 0) return

    setAvancandoLote(true)
    setErro(null)
    setAvancoRecente(null)
    setResumoLote(null)

    try {
      const resposta = await fetch('/api/etiquetas/avancar-lote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const corpo = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        avancados?: number
        falhas?: number
        itens?: { ok: boolean; erro?: string }[]
      }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível avançar a etapa dos envios selecionados.')
        return
      }

      const avancados = corpo.avancados ?? 0
      const falhas = corpo.falhas ?? 0
      const primeiroErro = corpo.itens?.find((i) => !i.ok)?.erro

      setResumoLote(
        falhas === 0
          ? `${avancados} ${avancados === 1 ? 'envio avançou' : 'envios avançaram'} de etapa.`
          : `${avancados} avançaram, ${falhas} não. Primeiro motivo: ${primeiroErro ?? 'não informado'}`,
      )

      // Limpa só o que de fato andou não é possível saber linha a linha sem
      // devolver id por id — e o recarregamento abaixo já tira da aba quem
      // mudou de situação. Limpar tudo é o comportamento previsível.
      setSelecionados(new Set())
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setAvancandoLote(false)
    }
  }

  return (
    // Duas distâncias, não uma: os filtros são um bloco só (abas e busca
    // coladas, porque fazem a mesma coisa) e os resultados vêm a `bloco` de
    // distância. Com o `gap-4` uniforme de antes, a busca parecia tão
    // desligada das abas quanto a lista inteira.
    <div className="flex flex-col gap-bloco">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Situação das etiquetas">
          {ABAS.map((chave) => (
            <button
              key={chave}
              type="button"
              role="tab"
              aria-selected={aba === chave}
              onClick={() => setAba(chave)}
              className={`rounded-pilula px-4 py-2 text-dado font-medium focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                aba === chave ? 'bg-brand text-white' : 'bg-superficie-card text-texto-principal'
              }`}
            >
              {ROTULOS_ABA[chave]}
              {dados ? ` (${dados.contagem[chave]})` : ''}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-dado">
          <span className="text-texto-secundario">Buscar por código ou destinatário</span>
          <input
            type="search"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="FR000000000BR ou nome do destinatário"
            className="w-full max-w-md rounded-campo border border-borda-campo bg-superficie-card px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>
      </div>

      {erro ? (
        <p role="alert" className="rounded-campo bg-erro-fundo p-4 text-dado text-erro">
          {erro}
        </p>
      ) : null}

      {resumoLote ? (
        <p role="status" className="rounded-campo bg-superficie-card p-4 text-dado text-texto-principal">
          {resumoLote}
        </p>
      ) : null}

      {/*
        A barra da seleção.

        Fica ACIMA da lista e some quando não há nada selecionável, em vez de
        virar uma linha morta no topo de toda tela. E o botão só aparece com
        algo marcado: ação em lote com zero selecionados é um botão que existe
        para não fazer nada.
      */}
      {selecionaveis.length > 0 ? (
        <div className="flex flex-wrap items-center gap-4 rounded-campo bg-superficie-card p-4">
          <label className="flex cursor-pointer items-center gap-2 text-dado text-texto-principal">
            <input
              type="checkbox"
              checked={todosMarcados}
              onChange={alternarTodos}
              className="h-4 w-4 accent-brand"
            />
            Selecionar todos ({selecionaveis.length})
          </label>

          {marcados.length > 0 ? (
            <>
              <span className="text-dado text-texto-secundario">
                {marcados.length} selecionado{marcados.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => void avancarSelecionados()}
                disabled={avancandoLote}
                className="rounded-lg bg-brand px-4 py-2 text-dado font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                {avancandoLote
                  ? `Avançando ${marcados.length}…`
                  : `Avançar para o próximo passo (${marcados.length})`}
              </button>
              <button
                type="button"
                onClick={() => setSelecionados(new Set())}
                disabled={avancandoLote}
                className="text-dado text-texto-secundario underline underline-offset-2 disabled:opacity-60"
              >
                limpar seleção
              </button>
            </>
          ) : (
            <span className="text-dado text-texto-secundario">
              Marque as encomendas para movê-las de uma vez.
            </span>
          )}
        </div>
      ) : null}

      {carregando && !dados ? (
        <p className="text-dado text-texto-secundario">Carregando…</p>
      ) : etiquetas.length === 0 ? (
        <p className="rounded-cartao bg-superficie-card p-6 text-dado text-texto-secundario">
          {busca
            ? 'Nenhuma etiqueta encontrada para esta busca.'
            : 'Nenhuma etiqueta nesta situação.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {etiquetas.map((etiqueta) => (
            /*
              Três distâncias dentro do cartão, e é isso que dá a leitura:
              4px entre as linhas de um mesmo dado (nome, destino, código),
              12px entre os dados e a situação atual do envio, 20px antes das
              ações. Com tudo a 12px, como estava, o botão "Cancelar" parecia
              tão ligado ao código de rastreio quanto o código ao nome.
            */
            <li key={etiqueta.id} className="flex flex-col gap-5 rounded-cartao bg-superficie-card p-5">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex flex-1 items-start gap-3">
                    {/*
                      A caixa só existe para quem PODE avançar. Mostrá-la
                      desabilitada em envio entregue ou cancelado convidaria o
                      clique para depois recusá-lo, e a lista tem centenas
                      deles.
                    */}
                    {etiqueta.podeAvancarEtapa ? (
                      <input
                        type="checkbox"
                        checked={selecionados.has(etiqueta.id)}
                        onChange={() => alternar(etiqueta.id)}
                        aria-label={`Selecionar o envio de ${etiqueta.destinatarioNome}`}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand"
                      />
                    ) : (
                      // Espaço reservado: sem ele, as linhas com e sem caixa
                      // ficariam desalinhadas e a coluna deixaria de ser coluna.
                      <span aria-hidden className="mt-1 h-4 w-4 shrink-0" />
                    )}
                  <div className="flex flex-col gap-1">
                    {/*
                      A loja só aparece na visão de administração, onde a lista
                      mistura contas. Para o lojista o campo vem nulo — repetir
                      o nome da própria loja em cada linha seria ruído.
                    */}
                    {etiqueta.loja ? (
                      <p className="text-rotulo uppercase tracking-wide text-brand-texto">
                        {etiqueta.loja}
                      </p>
                    ) : null}
                    <p className="font-medium text-texto-principal">{etiqueta.destinatarioNome}</p>
                    <p className="text-dado text-texto-secundario">
                      {etiqueta.destinoCidade
                        ? `${etiqueta.destinoCidade}/${etiqueta.destinoUf}`
                        : '—'}
                      {' · '}
                      {etiqueta.servico}
                    </p>
                    <p className="font-mono text-xs text-texto-secundario">
                      {etiqueta.codigoRastreio ?? 'sem código'}
                    </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <Selo status={etiqueta.status} />
                    <p className="text-dado font-medium text-texto-principal">
                      {reais(etiqueta.valorCentavos)}
                    </p>
                    <p className="text-xs text-texto-secundario">{dataHora(etiqueta.ocorridoEm)}</p>
                  </div>
                </div>

                {etiqueta.ultimoEvento ? (
                  <p className="text-dado text-texto-secundario">{etiqueta.ultimoEvento}</p>
                ) : null}
              </div>

              {confirmandoId === etiqueta.id ? (
                <ConfirmarCancelamento
                  etiqueta={etiqueta}
                  cancelando={cancelandoId === etiqueta.id}
                  onConfirmar={() => cancelar(etiqueta.id)}
                  onDesistir={() => setConfirmandoId(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/etiquetas/${etiqueta.id}`}
                    className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    Ver detalhes
                  </Link>

                  {etiqueta.codigoRastreio ? (
                    <Link
                      href={`/r/${etiqueta.codigoRastreio}`}
                      className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      Rastrear
                    </Link>
                  ) : null}

                  {etiqueta.podeAvancarEtapa ? (
                    <button
                      type="button"
                      onClick={() => void avancarEtapa(etiqueta.id)}
                      disabled={avancandoId === etiqueta.id}
                      className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {avancandoId === etiqueta.id ? 'Avançando…' : 'Avançar etapa'}
                    </button>
                  ) : null}

                  {avancoRecente?.id === etiqueta.id ? (
                    <p role="status" className="self-center text-sm text-texto-secundario">
                      Avançou para “{avancoRecente.titulo}”.
                    </p>
                  ) : null}

                  {etiqueta.podeCancelar ? (
                    <button
                      type="button"
                      onClick={() => setConfirmandoId(etiqueta.id)}
                      className="rounded-lg border border-erro px-4 py-2 text-sm font-medium text-erro focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

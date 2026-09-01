'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  codigoRastreioSchema,
  type EventoRastreio,
  type RastreioResposta,
} from '@/lib/rastreio-schema'
import { FluxoRastreio } from './fluxo-rastreio'

/**
 * Cor da faixa e do título de cada evento, conforme a referência visual
 * (seção 6): verde quando concluído, azul em trânsito, laranja aguardando
 * ação do cliente, vermelho quando extraviado.
 */
const TOM_POR_EVENTO: Record<string, 'concluido' | 'transito' | 'aguardando' | 'falha'> = {
  ETIQUETA_EMITIDA: 'aguardando',
  POSTADO: 'transito',
  TRANSFERENCIA: 'transito',
  AGUARDANDO_TRATAMENTO: 'aguardando',
  SAIU_PARA_ENTREGA: 'transito',
  TENTATIVA_FRUSTRADA: 'aguardando',
  AGUARDANDO_RETIRADA: 'aguardando',
  ENTREGUE: 'concluido',
  EXTRAVIADO: 'falha',
  DEVOLUCAO_INICIADA: 'aguardando',
  DEVOLVIDO: 'concluido',
}

const FAIXA_POR_TOM = {
  concluido: 'bg-brand text-white',
  transito: 'bg-info-text text-white',
  aguardando: 'bg-alerta text-texto-principal',
  falha: 'bg-erro text-white',
} as const

const PONTO_POR_TOM = {
  concluido: 'bg-brand',
  transito: 'bg-info-text',
  aguardando: 'bg-alerta',
  falha: 'bg-erro',
} as const

const TITULO_POR_TOM = {
  concluido: 'text-brand-texto',
  transito: 'text-info-text',
  aguardando: 'text-texto-principal',
  falha: 'text-erro',
} as const

function tomDoEvento(codigo: string) {
  return TOM_POR_EVENTO[codigo] ?? 'transito'
}

function formatarDia(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function ItemTimeline({ evento, ultimo }: { evento: EventoRastreio; ultimo: boolean }) {
  const tom = tomDoEvento(evento.codigo)

  return (
    <li className="flex gap-4">
      <div className="w-20 shrink-0 pt-0.5 text-right">
        <p className="text-sm font-medium text-texto-principal">{formatarDia(evento.ocorridoEm)}</p>
        <p className="text-xs text-texto-secundario">às {formatarHora(evento.ocorridoEm)}</p>
      </div>

      <div className="flex flex-col items-center" aria-hidden="true">
        <span className={`mt-1 size-3 shrink-0 rounded-full ${PONTO_POR_TOM[tom]}`} />
        {ultimo ? null : <span className="w-px flex-1 bg-borda-campo" />}
      </div>

      <div className="flex-1 pb-6">
        <p className={`font-medium ${TITULO_POR_TOM[tom]}`}>{evento.descricao}</p>
        {evento.unidadeOrigem ? (
          <p className="text-sm text-texto-secundario">De: {evento.unidadeOrigem}</p>
        ) : null}
        {evento.unidadeDestino ? (
          <p className="text-sm text-texto-secundario">Para: {evento.unidadeDestino}</p>
        ) : null}
        <p className="text-sm text-texto-secundario">
          {evento.cidade}/{evento.uf}
        </p>
      </div>
    </li>
  )
}

function Resultado({ rastreio }: { rastreio: RastreioResposta }) {
  const ultimo = rastreio.eventos[0]
  const tom = ultimo ? tomDoEvento(ultimo.codigo) : 'aguardando'

  return (
    <section className="flex flex-col gap-4 overflow-hidden rounded-xl bg-superficie-card pb-2">
      <div
        className={`flex flex-col gap-1 p-6 sm:flex-row sm:items-center sm:justify-between ${FAIXA_POR_TOM[tom]}`}
      >
        <p className="text-lg font-bold">
          {ultimo ? ultimo.descricao : 'Envio ainda sem movimentação'}
        </p>
        {ultimo ? (
          <p className="text-sm">
            {formatarDia(ultimo.ocorridoEm)} às {formatarHora(ultimo.ocorridoEm)}
          </p>
        ) : null}
      </div>

      <p className="mx-6 rounded-lg bg-info-bg p-4 text-sm text-info-text">
        Acompanhe abaixo o histórico do envio. Só aparecem movimentações que já aconteceram.
      </p>

      <dl className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase text-texto-secundario">Serviço</dt>
          <dd className="font-medium text-texto-principal">{rastreio.servico}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-texto-secundario">Código de rastreio</dt>
          <dd className="font-mono font-medium text-texto-principal">{rastreio.codigoRastreio}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-texto-secundario">Prazo</dt>
          <dd className="font-medium text-texto-principal">
            {rastreio.prazoDias} {rastreio.prazoDias === 1 ? 'dia útil' : 'dias úteis'}
          </dd>
        </div>
      </dl>

      {rastreio.eventos.length === 0 ? (
        <p className="px-6 pb-4 text-sm text-texto-secundario">
          Ainda não há movimentações registradas para este envio.
        </p>
      ) : (
        // A lista é nomeada porque não é a única da página: o diagrama do
        // caminho do envio também é um `<ol>`. Sem nome, leitor de tela
        // anuncia duas listas indistinguíveis, e teste automatizado não tem
        // como mirar uma das duas sem depender de classe de estilo.
        <ol aria-label="Movimentações do envio" className="flex flex-col px-6">
          {rastreio.eventos.map((evento, indice) => (
            <ItemTimeline
              key={evento.sequencia}
              evento={evento}
              ultimo={indice === rastreio.eventos.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

export function RastreioForm({ codigoInicial = '' }: { codigoInicial?: string }) {
  const [codigo, setCodigo] = useState(codigoInicial)
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [rastreio, setRastreio] = useState<RastreioResposta | null>(null)

  const consultarCodigo = useCallback(async (valor: string) => {
    setErro(null)

    const analise = codigoRastreioSchema.safeParse(valor)
    if (!analise.success) {
      setRastreio(null)
      setErro('Código inválido. Confira os 13 caracteres, no formato AA000000000BR.')
      return
    }

    setConsultando(true)
    try {
      const resposta = await fetch(`/api/rastreio/${encodeURIComponent(analise.data)}`)
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setRastreio(null)
        setErro(corpo.mensagem ?? 'Não foi possível consultar o rastreio.')
        return
      }
      const corpo = (await resposta.json()) as { rastreio: RastreioResposta }
      setRastreio(corpo.rastreio)
    } catch {
      setRastreio(null)
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setConsultando(false)
    }
  }, [])

  // A página pública `/r/[codigo]` já chega com o código na URL: consulta
  // sozinha, sem exigir um clique a mais de quem só quer ver onde está a
  // encomenda.
  useEffect(() => {
    if (codigoInicial) {
      void consultarCodigo(codigoInicial)
    }
  }, [codigoInicial, consultarCodigo])

  async function consultar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    await consultarCodigo(codigo)
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={consultar}
        className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6 sm:flex-row sm:items-end"
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="codigo-rastreio" className="text-sm font-medium text-texto-principal">
            Código de rastreio
          </label>
          <input
            id="codigo-rastreio"
            name="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="AA000000000BR"
            autoComplete="off"
            maxLength={20}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'erro-rastreio' : undefined}
            className="rounded-lg border border-borda-campo bg-superficie-bloco px-4 py-2 font-mono text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </div>
        <button
          type="submit"
          disabled={consultando}
          className="rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {consultando ? 'Consultando…' : 'Rastrear'}
        </button>
      </form>

      {erro ? (
        <p
          id="erro-rastreio"
          role="alert"
          className="rounded-lg bg-erro-fundo p-4 text-sm text-erro"
        >
          {erro}
        </p>
      ) : null}

      {rastreio ? (
        <>
          <Resultado rastreio={rastreio} />
          {/* Depois da timeline: o que já aconteceu vem primeiro, e o mapa do
              percurso serve para situar quem quer saber o que vem pela
              frente. Mostra etapas genéricas, nunca os eventos futuros deste
              envio — ver o comentário em `FluxoRastreio`. */}
          <FluxoRastreio fluxo={rastreio.fluxo} eventos={rastreio.eventos} />
        </>
      ) : null}
    </div>
  )
}

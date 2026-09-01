'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  FILTROS,
  type EnvioResumo,
  type FiltroEnvios,
  type ListaEnviosResposta,
} from '@/lib/meus-envios-schema'

const ROTULO_ABA: Record<FiltroEnvios, string> = {
  todos: 'Todos',
  pendentes: 'Pendentes',
  entregues: 'Entregues',
}

const ROTULO_STATUS: Record<string, string> = {
  PENDING: 'Aguardando pagamento',
  RELEASED: 'Pago',
  GENERATED: 'Etiqueta emitida',
  POSTED: 'Em trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  LOST: 'Extraviado',
}

const TOM_STATUS: Record<string, 'concluido' | 'transito' | 'aguardando' | 'falha'> = {
  PENDING: 'aguardando',
  RELEASED: 'aguardando',
  GENERATED: 'aguardando',
  POSTED: 'transito',
  DELIVERED: 'concluido',
  CANCELLED: 'falha',
  LOST: 'falha',
}

const CIRCULO_POR_TOM = {
  concluido: 'bg-brand text-white',
  transito: 'bg-info-text text-white',
  aguardando: 'bg-alerta text-texto-principal',
  falha: 'bg-erro text-white',
} as const

const TEXTO_POR_TOM = {
  concluido: 'text-brand-texto',
  transito: 'text-info-text',
  aguardando: 'text-texto-principal',
  falha: 'text-erro',
} as const

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function IconeStatus({ tom }: { tom: keyof typeof CIRCULO_POR_TOM }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${CIRCULO_POR_TOM[tom]}`}
    >
      {tom === 'concluido' ? '✓' : tom === 'falha' ? '!' : '•'}
    </span>
  )
}

function LinhaEnvio({ envio }: { envio: EnvioResumo }) {
  const tom = TOM_STATUS[envio.status] ?? 'transito'
  const rotulo = ROTULO_STATUS[envio.status] ?? envio.status

  const conteudo = (
    <>
      <IconeStatus tom={tom} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-texto-principal">{envio.destinatarioNome}</p>
        <p className={`text-sm font-bold ${TEXTO_POR_TOM[tom]}`}>{rotulo}</p>
        <p className="truncate font-mono text-xs text-texto-secundario">
          {envio.codigoRastreio ?? 'Sem código — etiqueta ainda não emitida'}
        </p>
      </div>

      <div className="shrink-0 border-l border-borda-campo pl-4 text-right">
        <p className="text-rotulo uppercase text-texto-secundario">{envio.servico}</p>
        <p className="text-xs text-texto-secundario">
          {formatarData(envio.ocorridoEm ?? envio.criadoEm)}
        </p>
        <p className="text-xs text-texto-secundario">
          {envio.prazoDias} {envio.prazoDias === 1 ? 'dia' : 'dias'}
        </p>
      </div>
    </>
  )

  // Sem código não há página de rastreio para abrir: a linha fica estática
  // em vez de virar um link que leva a lugar nenhum.
  if (!envio.codigoRastreio) {
    return <li className="flex items-center gap-4 border-t border-borda-campo p-4">{conteudo}</li>
  }

  return (
    <li className="border-t border-borda-campo">
      <Link
        href={`/r/${envio.codigoRastreio}`}
        className="flex items-center gap-4 p-4 hover:bg-superficie-bloco focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {conteudo}
      </Link>
    </li>
  )
}

export function ListaRastreios() {
  const [filtro, setFiltro] = useState<FiltroEnvios>('todos')
  const [dados, setDados] = useState<ListaEnviosResposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async (aba: FiltroEnvios) => {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch(`/api/envios/meus?filtro=${aba}`)
      if (!resposta.ok) {
        setErro('Não foi possível carregar seus envios.')
        return
      }
      setDados((await resposta.json()) as ListaEnviosResposta)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar(filtro)
  }, [filtro, carregar])

  return (
    <section className="overflow-hidden rounded-xl bg-superficie-card">
      <div role="tablist" aria-label="Filtrar envios" className="flex border-b border-borda-campo">
        {FILTROS.map((aba) => {
          const ativa = aba === filtro
          return (
            <button
              key={aba}
              role="tab"
              type="button"
              aria-selected={ativa}
              onClick={() => setFiltro(aba)}
              className={`flex-1 px-4 py-3 text-xs font-medium uppercase tracking-wide focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                ativa
                  ? 'border-b-2 border-brand text-brand-texto'
                  : 'text-texto-secundario hover:text-texto-principal'
              }`}
            >
              {ROTULO_ABA[aba]} ({dados?.contagem[aba] ?? 0})
            </button>
          )
        })}
      </div>

      {carregando ? <p className="p-6 text-sm text-texto-secundario">Carregando…</p> : null}

      {erro ? (
        <p role="alert" className="m-6 rounded-lg bg-erro-fundo p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {!carregando && !erro && dados?.envios.length === 0 ? (
        <p className="p-6 text-sm text-texto-secundario">
          {filtro === 'todos'
            ? 'Você ainda não tem envios. Faça uma cotação para começar.'
            : 'Nenhum envio nesta aba.'}
        </p>
      ) : null}

      {!carregando && !erro && dados && dados.envios.length > 0 ? (
        <ul className="flex flex-col">
          {dados.envios.map((envio) => (
            <LinhaEnvio key={envio.id} envio={envio} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

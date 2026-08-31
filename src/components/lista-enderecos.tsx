'use client'

import { useEffect, useState } from 'react'
import { EnderecoForm } from './endereco-form'
import type { EnderecoResposta } from '@/lib/endereco-schema'

type Tipo = 'REMETENTE' | 'DESTINATARIO'

function resumo(endereco: EnderecoResposta): string {
  const complemento = endereco.complemento ? `, ${endereco.complemento}` : ''
  return `${endereco.logradouro}, ${endereco.numero}${complemento} — ${endereco.bairro}, ${endereco.cidade}/${endereco.uf}`
}

type SecaoProps = {
  titulo: string
  tipo: Tipo
  enderecos: EnderecoResposta[]
  carregando: boolean
  onCriado: (endereco: EnderecoResposta) => void
  onAtualizado: (endereco: EnderecoResposta) => void
  onApagado: (id: string) => void
}

function SecaoEnderecos({
  titulo,
  tipo,
  enderecos,
  carregando,
  onCriado,
  onAtualizado,
  onApagado,
}: SecaoProps) {
  const [modo, setModo] = useState<'lista' | 'novo' | string>('lista')
  const [apagandoId, setApagandoId] = useState<string | null>(null)
  const [erroApagar, setErroApagar] = useState<string | null>(null)

  const enderecoEmEdicao = typeof modo === 'string' && modo !== 'lista' && modo !== 'novo'
    ? enderecos.find((e) => e.id === modo)
    : undefined

  async function apagar(id: string) {
    setErroApagar(null)
    setApagandoId(id)
    try {
      const resposta = await fetch(`/api/enderecos/${id}`, { method: 'DELETE' })
      if (!resposta.ok && resposta.status !== 204) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErroApagar(corpo.mensagem ?? 'Não foi possível apagar o endereço.')
        return
      }
      onApagado(id)
    } catch {
      setErroApagar('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setApagandoId(null)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-texto-principal">{titulo}</h2>
        {modo === 'lista' ? (
          <button
            type="button"
            onClick={() => setModo('novo')}
            className="rounded-pilula bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
          >
            Novo {titulo === 'Remetentes' ? 'remetente' : 'destinatário'}
          </button>
        ) : null}
      </div>

      {modo === 'novo' ? (
        <EnderecoForm
          tipo={tipo}
          onSalvar={(endereco) => {
            onCriado(endereco)
            setModo('lista')
          }}
          onCancelar={() => setModo('lista')}
        />
      ) : enderecoEmEdicao ? (
        <EnderecoForm
          tipo={tipo}
          enderecoExistente={enderecoEmEdicao}
          onSalvar={(endereco) => {
            onAtualizado(endereco)
            setModo('lista')
          }}
          onCancelar={() => setModo('lista')}
        />
      ) : (
        <>
          {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}
          {!carregando && enderecos.length === 0 ? (
            <p className="text-sm text-texto-secundario">Nenhum endereço cadastrado ainda.</p>
          ) : null}
          {erroApagar ? (
            <p role="alert" className="text-sm text-erro">
              {erroApagar}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {enderecos.map((endereco) => (
              <li
                key={endereco.id}
                className="flex flex-col gap-2 rounded-lg border border-borda-campo bg-superficie-bloco p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-texto-principal">
                    {endereco.apelido || endereco.nome || 'Endereço sem apelido'}
                    {endereco.padrao ? (
                      <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                        Padrão
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-texto-secundario">{resumo(endereco)}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setModo(endereco.id)}
                    className="text-sm font-medium text-brand-texto hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={apagandoId === endereco.id}
                    onClick={() => apagar(endereco.id)}
                    className="text-sm font-medium text-erro hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {apagandoId === endereco.id ? 'Apagando…' : 'Apagar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function ListaEnderecos() {
  const [enderecos, setEnderecos] = useState<EnderecoResposta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      try {
        const resposta = await fetch('/api/enderecos')
        if (!resposta.ok) {
          if (!cancelado) setErro('Não foi possível carregar seus endereços.')
          return
        }
        const corpo = (await resposta.json()) as { enderecos: EnderecoResposta[] }
        if (!cancelado) setEnderecos(corpo.enderecos)
      } catch {
        if (!cancelado) setErro('Não foi possível conectar ao servidor.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [])

  const remetentes = enderecos.filter((e) => e.tipo === 'REMETENTE')
  const destinatarios = enderecos.filter((e) => e.tipo === 'DESTINATARIO')

  function onCriado(endereco: EnderecoResposta) {
    setEnderecos((atual) => {
      const semAntigoPadrao = endereco.padrao
        ? atual.map((e) => (e.tipo === endereco.tipo ? { ...e, padrao: false } : e))
        : atual
      return [endereco, ...semAntigoPadrao]
    })
  }

  function onAtualizado(endereco: EnderecoResposta) {
    setEnderecos((atual) =>
      atual.map((e) => {
        if (e.id === endereco.id) return endereco
        if (endereco.padrao && e.tipo === endereco.tipo) return { ...e, padrao: false }
        return e
      }),
    )
  }

  function onApagado(id: string) {
    setEnderecos((atual) => atual.filter((e) => e.id !== id))
  }

  return (
    <div className="mx-auto flex max-w-conteudo flex-col gap-6 py-8">
      <header>
        <h1 className="text-2xl font-bold text-texto-principal">Endereços</h1>
        <p className="mt-1 text-sm text-texto-secundario">
          Cadastre remetentes e destinatários para agilizar a geração de etiquetas.
        </p>
      </header>

      {erro ? (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      ) : null}

      <SecaoEnderecos
        titulo="Remetentes"
        tipo="REMETENTE"
        enderecos={remetentes}
        carregando={carregando}
        onCriado={onCriado}
        onAtualizado={onAtualizado}
        onApagado={onApagado}
      />
      <SecaoEnderecos
        titulo="Destinatários"
        tipo="DESTINATARIO"
        enderecos={destinatarios}
        carregando={carregando}
        onCriado={onCriado}
        onAtualizado={onAtualizado}
        onApagado={onApagado}
      />
    </div>
  )
}

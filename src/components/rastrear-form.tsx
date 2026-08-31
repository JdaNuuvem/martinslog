'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { codigoRastreioSchema } from '@/lib/rastreio-schema'

type EstadoErro = { tipo: 'invalido' | 'nao-encontrado' | 'indisponivel' | 'limite'; mensagem: string }

/**
 * Mensagens escritas para quem acabou de comprar e está ansioso pelo
 * pedido — nunca "erro", "404" ou qualquer termo técnico. Cada tipo de
 * falha (código mal formado, envio não localizado, API fora do ar, cota
 * excedida) tem um texto próprio, porque confundir "não encontrado" com
 * "sistema indisponível" faz a pessoa duvidar de um código correto.
 */
function mensagemDeStatus(status: number): EstadoErro {
  if (status === 404) {
    return {
      tipo: 'nao-encontrado',
      mensagem:
        'Não encontramos nenhum pedido com esse código. Confira se todos os caracteres foram digitados certinho — se o pedido acabou de ser postado, pode levar algumas horas até aparecer aqui.',
    }
  }
  if (status === 429) {
    return {
      tipo: 'limite',
      mensagem: 'Muitas consultas em pouco tempo. Aguarde alguns minutos e tente de novo.',
    }
  }
  if (status === 422) {
    return {
      tipo: 'invalido',
      mensagem: 'Esse código não parece válido. Confira se digitou todos os caracteres corretamente.',
    }
  }
  return {
    tipo: 'indisponivel',
    mensagem: 'No momento não conseguimos consultar seu pedido. Tente novamente em instantes.',
  }
}

/**
 * Formulário de entrada em `/rastrear` (spec 2026-08-30, task página
 * rastrear): quem chega aqui só tem um código escrito à mão ou colado do
 * WhatsApp, então normaliza espaços/quebras de linha/minúsculas antes de
 * consultar. Ao confirmar que o código existe, navega para `/r/[codigo]` —
 * o resultado fica com URL própria, compartilhável — em vez de renderizar a
 * timeline aqui mesmo.
 */
export function RastrearForm() {
  const router = useRouter()
  const [codigo, setCodigo] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<EstadoErro | null>(null)
  const idRequisicaoRef = useRef(0)

  async function consultar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)

    const analise = codigoRastreioSchema.safeParse(codigo)
    if (!analise.success) {
      setErro({
        tipo: 'invalido',
        mensagem: 'Esse código não parece válido. Confira se digitou todos os caracteres corretamente.',
      })
      return
    }

    const idRequisicao = (idRequisicaoRef.current += 1)
    setConsultando(true)
    try {
      const resposta = await fetch(`/api/rastreio/${encodeURIComponent(analise.data)}`)
      // Uma consulta mais antiga que ainda estava em voo não deve sobrescrever
      // o estado de uma mais recente (ex.: usuário corrigiu o código e enviou
      // de novo antes da primeira resposta voltar).
      if (idRequisicao !== idRequisicaoRef.current) return

      if (!resposta.ok) {
        setErro(mensagemDeStatus(resposta.status))
        return
      }

      router.push(`/r/${analise.data}`)
    } catch {
      if (idRequisicao !== idRequisicaoRef.current) return
      setErro({
        tipo: 'indisponivel',
        mensagem: 'Não foi possível conectar ao servidor. Tente novamente em instantes.',
      })
    } finally {
      if (idRequisicao === idRequisicaoRef.current) setConsultando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={consultar}
        className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="codigo-rastrear" className="text-sm font-medium text-texto-principal">
            Código de rastreio
          </label>
          <input
            id="codigo-rastrear"
            name="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="AA000000000BR"
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            maxLength={40}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'erro-rastrear' : undefined}
            className="rounded-lg border border-borda-campo bg-superficie-bloco px-4 py-3 text-lg font-mono text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
          <p className="text-xs text-texto-secundario">
            Cole ou digite o código que você recebeu por mensagem. Espaços e letras minúsculas não são
            problema.
          </p>
        </div>
        <button
          type="submit"
          disabled={consultando}
          className="rounded-pilula bg-brand px-6 py-3 text-base font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {consultando ? 'Consultando…' : 'Rastrear pedido'}
        </button>
      </form>

      <div aria-live="polite" role="status">
        {erro ? (
          <p id="erro-rastrear" className="rounded-lg bg-erro-fundo p-4 text-sm text-erro">
            {erro.mensagem}
          </p>
        ) : null}
      </div>
    </div>
  )
}

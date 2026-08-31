'use client'

import { FormEvent, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginRequestSchema } from '@/lib/auth-schema'

type EstadoFormulario = {
  email: string
  senha: string
}

const ESTADO_INICIAL: EstadoFormulario = { email: '', senha: '' }

type ErrosCampo = Partial<Record<keyof EstadoFormulario, string>>

export default function LoginPage() {
  const router = useRouter()
  const idBase = useId()

  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL)
  const [erros, setErros] = useState<ErrosCampo>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  function atualizarCampo<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroGeral(null)

    const analisado = loginRequestSchema.safeParse(form)
    if (!analisado.success) {
      const camposInvalidos = analisado.error.flatten().fieldErrors
      const novosErros: ErrosCampo = {}
      if (camposInvalidos.email) novosErros.email = camposInvalidos.email[0]
      if (camposInvalidos.senha) novosErros.senha = camposInvalidos.senha[0]
      setErros(novosErros)
      return
    }

    setErros({})
    setCarregando(true)

    try {
      const resposta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analisado.data),
      })

      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const erro = corpo as { codigo?: string; mensagem?: string }
        if (erro.codigo === 'LIMITE_TENTATIVAS_EXCEDIDO') {
          setErroGeral('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
        } else {
          setErroGeral(erro.mensagem ?? 'Não foi possível entrar. Tente novamente.')
        }
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setErroGeral('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Entrar</h1>
        <p className="mt-1 text-sm text-slate-600">Acesse sua conta para continuar.</p>
      </header>

      <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-email`} className="text-sm font-medium text-slate-700">
            E-mail
          </label>
          <input
            id={`${idBase}-email`}
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => atualizarCampo('email', e.target.value)}
            aria-invalid={erros.email ? true : undefined}
            aria-describedby={erros.email ? `${idBase}-email-erro` : undefined}
            className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {erros.email ? (
            <p id={`${idBase}-email-erro`} role="alert" className="text-sm text-red-600">
              {erros.email}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-senha`} className="text-sm font-medium text-slate-700">
            Senha
          </label>
          <input
            id={`${idBase}-senha`}
            name="senha"
            type="password"
            autoComplete="current-password"
            value={form.senha}
            onChange={(e) => atualizarCampo('senha', e.target.value)}
            aria-invalid={erros.senha ? true : undefined}
            aria-describedby={erros.senha ? `${idBase}-senha-erro` : undefined}
            className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {erros.senha ? (
            <p id={`${idBase}-senha-erro`} role="alert" className="text-sm text-red-600">
              {erros.senha}
            </p>
          ) : null}
        </div>

        {erroGeral ? (
          <p role="alert" className="text-sm text-red-600">
            {erroGeral}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={carregando}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

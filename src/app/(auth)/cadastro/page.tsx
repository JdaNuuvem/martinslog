'use client'

import { FormEvent, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cadastroRequestSchema } from '@/lib/auth-schema'

type EstadoFormulario = {
  nome: string
  documento: string
  email: string
  telefone: string
  senha: string
}

const ESTADO_INICIAL: EstadoFormulario = {
  nome: '',
  documento: '',
  email: '',
  telefone: '',
  senha: '',
}

type ErrosCampo = Partial<Record<keyof EstadoFormulario, string>>

export default function CadastroPage() {
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

    const candidato = {
      nome: form.nome,
      documento: form.documento,
      email: form.email,
      telefone: form.telefone || undefined,
      senha: form.senha,
    }

    const analisado = cadastroRequestSchema.safeParse(candidato)
    if (!analisado.success) {
      const camposInvalidos = analisado.error.flatten().fieldErrors
      const novosErros: ErrosCampo = {}
      if (camposInvalidos.nome) novosErros.nome = camposInvalidos.nome[0]
      if (camposInvalidos.documento) novosErros.documento = camposInvalidos.documento[0]
      if (camposInvalidos.email) novosErros.email = camposInvalidos.email[0]
      if (camposInvalidos.telefone) novosErros.telefone = camposInvalidos.telefone[0]
      if (camposInvalidos.senha) novosErros.senha = camposInvalidos.senha[0]
      setErros(novosErros)
      return
    }

    setErros({})
    setCarregando(true)

    try {
      const resposta = await fetch('/api/auth/cadastro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analisado.data),
      })

      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const erro = corpo as { codigo?: string; mensagem?: string }
        if (erro.codigo === 'EMAIL_JA_CADASTRADO') {
          setErroGeral('Já existe uma conta com este e-mail ou documento.')
        } else if (erro.codigo === 'LIMITE_TENTATIVAS_EXCEDIDO') {
          setErroGeral('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
        } else {
          setErroGeral(erro.mensagem ?? 'Não foi possível concluir o cadastro. Tente novamente.')
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
        <h1 className="text-2xl font-bold text-texto-principal">Criar conta</h1>
        <p className="mt-1 text-sm text-texto-secundario">
          Cadastre-se para acompanhar suas cotações e envios.
        </p>
      </header>

      <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-nome`} className="text-sm font-medium text-texto-secundario">
            Nome completo
          </label>
          <input
            id={`${idBase}-nome`}
            name="nome"
            type="text"
            autoComplete="name"
            value={form.nome}
            onChange={(e) => atualizarCampo('nome', e.target.value)}
            aria-invalid={erros.nome ? true : undefined}
            aria-describedby={erros.nome ? `${idBase}-nome-erro` : undefined}
            className="rounded-lg border border-borda-campo px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {erros.nome ? (
            <p id={`${idBase}-nome-erro`} role="alert" className="text-sm text-erro">
              {erros.nome}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-documento`} className="text-sm font-medium text-texto-secundario">
            CPF ou CNPJ
          </label>
          <input
            id={`${idBase}-documento`}
            name="documento"
            type="text"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={form.documento}
            onChange={(e) => atualizarCampo('documento', e.target.value)}
            aria-invalid={erros.documento ? true : undefined}
            aria-describedby={erros.documento ? `${idBase}-documento-erro` : undefined}
            className="rounded-lg border border-borda-campo px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {erros.documento ? (
            <p id={`${idBase}-documento-erro`} role="alert" className="text-sm text-erro">
              {erros.documento}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-email`} className="text-sm font-medium text-texto-secundario">
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
            className="rounded-lg border border-borda-campo px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {erros.email ? (
            <p id={`${idBase}-email-erro`} role="alert" className="text-sm text-erro">
              {erros.email}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-telefone`} className="text-sm font-medium text-texto-secundario">
            Telefone (opcional)
          </label>
          <input
            id={`${idBase}-telefone`}
            name="telefone"
            type="tel"
            autoComplete="tel"
            value={form.telefone}
            onChange={(e) => atualizarCampo('telefone', e.target.value)}
            aria-invalid={erros.telefone ? true : undefined}
            aria-describedby={erros.telefone ? `${idBase}-telefone-erro` : undefined}
            className="rounded-lg border border-borda-campo px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {erros.telefone ? (
            <p id={`${idBase}-telefone-erro`} role="alert" className="text-sm text-erro">
              {erros.telefone}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-senha`} className="text-sm font-medium text-texto-secundario">
            Senha
          </label>
          <input
            id={`${idBase}-senha`}
            name="senha"
            type="password"
            autoComplete="new-password"
            value={form.senha}
            onChange={(e) => atualizarCampo('senha', e.target.value)}
            aria-invalid={erros.senha ? true : undefined}
            aria-describedby={erros.senha ? `${idBase}-senha-erro` : undefined}
            className="rounded-lg border border-borda-campo px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {erros.senha ? (
            <p id={`${idBase}-senha-erro`} role="alert" className="text-sm text-erro">
              {erros.senha}
            </p>
          ) : null}
        </div>

        {erroGeral ? (
          <p role="alert" className="text-sm text-erro">
            {erroGeral}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={carregando}
          className="rounded-lg bg-brand px-4 py-2 font-medium text-white focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>
    </div>
  )
}

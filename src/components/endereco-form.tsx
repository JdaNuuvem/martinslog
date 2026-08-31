'use client'

import { FormEvent, useId, useState } from 'react'
import { enderecoRequestSchema, type EnderecoRequest, type EnderecoResposta } from '@/lib/endereco-schema'

type Tipo = 'REMETENTE' | 'DESTINATARIO'

type EstadoFormulario = {
  apelido: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  padrao: boolean
  documento: string
  nome: string
  email: string
  telefone: string
}

function estadoInicial(endereco?: EnderecoResposta): EstadoFormulario {
  return {
    apelido: endereco?.apelido ?? '',
    cep: endereco?.cep ?? '',
    logradouro: endereco?.logradouro ?? '',
    numero: endereco?.numero ?? '',
    complemento: endereco?.complemento ?? '',
    bairro: endereco?.bairro ?? '',
    cidade: endereco?.cidade ?? '',
    uf: endereco?.uf ?? '',
    padrao: endereco?.padrao ?? false,
    documento: endereco?.documento ?? '',
    nome: endereco?.nome ?? '',
    email: endereco?.email ?? '',
    telefone: endereco?.telefone ?? '',
  }
}

type ErrosCampo = Partial<Record<keyof EstadoFormulario, string>>

const classeCampo =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

type EnderecoFormProps = {
  tipo: Tipo
  enderecoExistente?: EnderecoResposta
  onSalvar: (endereco: EnderecoResposta) => void
  onCancelar: () => void
}

export function EnderecoForm({ tipo, enderecoExistente, onSalvar, onCancelar }: EnderecoFormProps) {
  const idBase = useId()
  const [form, setForm] = useState<EstadoFormulario>(estadoInicial(enderecoExistente))
  const [erros, setErros] = useState<ErrosCampo>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [avisoCep, setAvisoCep] = useState<string | null>(null)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [salvando, setSalvando] = useState(false)

  function atualizarCampo<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function buscarCep() {
    const cepDigitado = form.cep.trim()
    if (!/^\d{5}-?\d{3}$/.test(cepDigitado)) {
      return
    }

    setAvisoCep(null)
    setBuscandoCep(true)
    try {
      const resposta = await fetch(`/api/enderecos/cep/${encodeURIComponent(cepDigitado)}`)
      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const erro = corpo as { codigo?: string; mensagem?: string }
        if (erro.codigo === 'SERVICO_INDISPONIVEL') {
          // Provedor fora do ar: nunca bloquear o cadastro nem sugerir que o
          // CEP está errado — só avisar que a busca automática falhou.
          setAvisoCep('Não foi possível buscar o CEP automaticamente agora. Preencha os campos manualmente.')
        } else {
          setErros((atual) => ({ ...atual, cep: erro.mensagem ?? 'CEP inválido.' }))
        }
        return
      }

      const { endereco } = corpo as { endereco: { logradouro: string; bairro: string; cidade: string; uf: string } }
      setForm((atual) => ({
        ...atual,
        logradouro: endereco.logradouro,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        uf: endereco.uf,
      }))
      setErros((atual) => ({ ...atual, cep: undefined }))
    } catch {
      setAvisoCep('Não foi possível buscar o CEP automaticamente agora. Preencha os campos manualmente.')
    } finally {
      setBuscandoCep(false)
    }
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroGeral(null)

    const dados: EnderecoRequest = {
      tipo,
      apelido: form.apelido || undefined,
      cep: form.cep,
      logradouro: form.logradouro,
      numero: form.numero,
      complemento: form.complemento || undefined,
      bairro: form.bairro,
      cidade: form.cidade,
      uf: form.uf,
      padrao: form.padrao,
      documento: form.documento || undefined,
      nome: form.nome,
      email: form.email || undefined,
      telefone: form.telefone || undefined,
    }

    const analisado = enderecoRequestSchema.safeParse(dados)
    if (!analisado.success) {
      const camposInvalidos = analisado.error.flatten().fieldErrors
      const novosErros: ErrosCampo = {}
      for (const campo of Object.keys(camposInvalidos) as (keyof typeof camposInvalidos)[]) {
        const mensagens = camposInvalidos[campo]
        if (mensagens?.[0] && campo in form) {
          novosErros[campo as keyof EstadoFormulario] = mensagens[0]
        }
      }
      setErros(novosErros)
      return
    }

    setErros({})
    setSalvando(true)

    try {
      const url = enderecoExistente ? `/api/enderecos/${enderecoExistente.id}` : '/api/enderecos'
      const metodo = enderecoExistente ? 'PUT' : 'POST'

      const resposta = await fetch(url, {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analisado.data),
      })

      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const erro = corpo as { codigo?: string; mensagem?: string }
        setErroGeral(erro.mensagem ?? 'Não foi possível salvar o endereço. Tente novamente.')
        return
      }

      const { endereco } = corpo as { endereco: EnderecoResposta }
      onSalvar(endereco)
    } catch {
      setErroGeral('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  const ehDestinatario = tipo === 'DESTINATARIO'

  return (
    <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-apelido`} className="text-xs font-medium text-texto-secundario">
          Apelido (opcional)
        </label>
        <input
          id={`${idBase}-apelido`}
          className={classeCampo}
          value={form.apelido}
          onChange={(e) => atualizarCampo('apelido', e.target.value)}
        />
      </div>

      {/* Fora do bloco de destinatário: a etiqueta precisa do nome dos dois
          lados, e `POST /api/envios` recusa o envio sem ele. Enquanto este
          campo só aparecia para o destinatário, todo remetente cadastrado
          pela interface nascia sem nome e travava a criação do envio. */}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-nome`} className="text-xs font-medium text-texto-secundario">
          {ehDestinatario ? 'Nome do destinatário' : 'Nome do remetente'}
        </label>
        <input
          id={`${idBase}-nome`}
          className={classeCampo}
          value={form.nome}
          onChange={(e) => atualizarCampo('nome', e.target.value)}
          aria-invalid={erros.nome ? true : undefined}
          aria-describedby={erros.nome ? `${idBase}-nome-erro` : undefined}
        />
        {erros.nome ? (
          <p id={`${idBase}-nome-erro`} role="alert" className="text-sm text-erro">
            {erros.nome}
          </p>
        ) : null}
      </div>

      {ehDestinatario ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-documento`} className="text-xs font-medium text-texto-secundario">
              CPF ou CNPJ
            </label>
            <input
              id={`${idBase}-documento`}
              className={classeCampo}
              value={form.documento}
              onChange={(e) => atualizarCampo('documento', e.target.value)}
              aria-invalid={erros.documento ? true : undefined}
              aria-describedby={erros.documento ? `${idBase}-documento-erro` : undefined}
            />
            {erros.documento ? (
              <p id={`${idBase}-documento-erro`} role="alert" className="text-sm text-erro">
                {erros.documento}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-cep`} className="text-xs font-medium text-texto-secundario">
          CEP
        </label>
        <input
          id={`${idBase}-cep`}
          className={classeCampo}
          value={form.cep}
          onChange={(e) => atualizarCampo('cep', e.target.value)}
          onBlur={buscarCep}
          aria-invalid={erros.cep ? true : undefined}
          aria-describedby={erros.cep ? `${idBase}-cep-erro` : avisoCep ? `${idBase}-cep-aviso` : undefined}
        />
        {buscandoCep ? <p className="text-xs text-texto-secundario">Buscando CEP…</p> : null}
        {erros.cep ? (
          <p id={`${idBase}-cep-erro`} role="alert" className="text-sm text-erro">
            {erros.cep}
          </p>
        ) : null}
        {avisoCep ? (
          <p id={`${idBase}-cep-aviso`} role="status" className="text-sm text-alerta">
            {avisoCep}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor={`${idBase}-logradouro`} className="text-xs font-medium text-texto-secundario">
            Logradouro
          </label>
          <input
            id={`${idBase}-logradouro`}
            className={classeCampo}
            value={form.logradouro}
            onChange={(e) => atualizarCampo('logradouro', e.target.value)}
            aria-invalid={erros.logradouro ? true : undefined}
            aria-describedby={erros.logradouro ? `${idBase}-logradouro-erro` : undefined}
          />
          {erros.logradouro ? (
            <p id={`${idBase}-logradouro-erro`} role="alert" className="text-sm text-erro">
              {erros.logradouro}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-numero`} className="text-xs font-medium text-texto-secundario">
            Número
          </label>
          <input
            id={`${idBase}-numero`}
            className={classeCampo}
            value={form.numero}
            onChange={(e) => atualizarCampo('numero', e.target.value)}
            aria-invalid={erros.numero ? true : undefined}
            aria-describedby={erros.numero ? `${idBase}-numero-erro` : undefined}
          />
          {erros.numero ? (
            <p id={`${idBase}-numero-erro`} role="alert" className="text-sm text-erro">
              {erros.numero}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-complemento`} className="text-xs font-medium text-texto-secundario">
          Complemento (opcional)
        </label>
        <input
          id={`${idBase}-complemento`}
          className={classeCampo}
          value={form.complemento}
          onChange={(e) => atualizarCampo('complemento', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor={`${idBase}-bairro`} className="text-xs font-medium text-texto-secundario">
            Bairro
          </label>
          <input
            id={`${idBase}-bairro`}
            className={classeCampo}
            value={form.bairro}
            onChange={(e) => atualizarCampo('bairro', e.target.value)}
            aria-invalid={erros.bairro ? true : undefined}
            aria-describedby={erros.bairro ? `${idBase}-bairro-erro` : undefined}
          />
          {erros.bairro ? (
            <p id={`${idBase}-bairro-erro`} role="alert" className="text-sm text-erro">
              {erros.bairro}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-uf`} className="text-xs font-medium text-texto-secundario">
            UF
          </label>
          <input
            id={`${idBase}-uf`}
            className={classeCampo}
            maxLength={2}
            value={form.uf}
            onChange={(e) => atualizarCampo('uf', e.target.value.toUpperCase())}
            aria-invalid={erros.uf ? true : undefined}
            aria-describedby={erros.uf ? `${idBase}-uf-erro` : undefined}
          />
          {erros.uf ? (
            <p id={`${idBase}-uf-erro`} role="alert" className="text-sm text-erro">
              {erros.uf}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idBase}-cidade`} className="text-xs font-medium text-texto-secundario">
          Cidade
        </label>
        <input
          id={`${idBase}-cidade`}
          className={classeCampo}
          value={form.cidade}
          onChange={(e) => atualizarCampo('cidade', e.target.value)}
          aria-invalid={erros.cidade ? true : undefined}
          aria-describedby={erros.cidade ? `${idBase}-cidade-erro` : undefined}
        />
        {erros.cidade ? (
          <p id={`${idBase}-cidade-erro`} role="alert" className="text-sm text-erro">
            {erros.cidade}
          </p>
        ) : null}
      </div>

      {ehDestinatario ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-email`} className="text-xs font-medium text-texto-secundario">
              E-mail (opcional)
            </label>
            <input
              id={`${idBase}-email`}
              type="email"
              className={classeCampo}
              value={form.email}
              onChange={(e) => atualizarCampo('email', e.target.value)}
              aria-invalid={erros.email ? true : undefined}
              aria-describedby={erros.email ? `${idBase}-email-erro` : undefined}
            />
            {erros.email ? (
              <p id={`${idBase}-email-erro`} role="alert" className="text-sm text-erro">
                {erros.email}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-telefone`} className="text-xs font-medium text-texto-secundario">
              Telefone (opcional)
            </label>
            <input
              id={`${idBase}-telefone`}
              className={classeCampo}
              value={form.telefone}
              onChange={(e) => atualizarCampo('telefone', e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <label htmlFor={`${idBase}-padrao`} className="flex items-center gap-2 text-sm text-texto-principal">
        <input
          id={`${idBase}-padrao`}
          type="checkbox"
          checked={form.padrao}
          onChange={(e) => atualizarCampo('padrao', e.target.checked)}
          className="h-4 w-4 rounded border-borda-campo text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        />
        Definir como {ehDestinatario ? 'destinatário' : 'remetente'} padrão
      </label>

      {erroGeral ? (
        <p role="alert" className="text-sm text-erro">
          {erroGeral}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="rounded-pilula bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-pilula border border-borda-campo px-4 py-2 text-sm font-medium text-texto-secundario focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

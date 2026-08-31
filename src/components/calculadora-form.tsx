'use client'

import { FormEvent, useId, useState } from 'react'
import { cotacaoRequestSchema, type CotacaoErro, type CotacaoResposta } from '@/lib/cotacao-schema'
import { OpcaoFreteCard } from './opcao-frete-card'

const FAIXAS_PESO = [
  { valor: '300', rotulo: 'Até 300g' },
  { valor: '1000', rotulo: 'Até 1Kg' },
  { valor: '2000', rotulo: 'Até 2Kg' },
  { valor: '3000', rotulo: 'Até 3Kg' },
  { valor: '4000', rotulo: 'Até 4Kg' },
  { valor: '5000', rotulo: 'Até 5Kg' },
  { valor: '10000', rotulo: 'Até 10Kg' },
  { valor: '20000', rotulo: 'Até 20Kg' },
  { valor: '30000', rotulo: 'Até 30Kg' },
  { valor: 'DIGITAR', rotulo: 'Digitar peso' },
] as const

const FORMATOS = [
  { valor: 'CAIXA', rotulo: 'Caixa/Pacote' },
  { valor: 'ROLO', rotulo: 'Rolo' },
  { valor: 'ENVELOPE', rotulo: 'Envelope' },
] as const

type CampoTexto = 'cepOrigem' | 'cepDestino' | 'alturaCm' | 'larguraCm' | 'comprimentoCm' | 'pesoDigitadoG'

type EstadoFormulario = {
  cepOrigem: string
  cepDestino: string
  formato: 'CAIXA' | 'ROLO' | 'ENVELOPE'
  faixaPeso: string
  pesoDigitadoG: string
  alturaCm: string
  larguraCm: string
  comprimentoCm: string
}

const ESTADO_INICIAL: EstadoFormulario = {
  cepOrigem: '',
  cepDestino: '',
  formato: 'CAIXA',
  faixaPeso: '300',
  pesoDigitadoG: '',
  alturaCm: '',
  larguraCm: '',
  comprimentoCm: '',
}

type ErrosCampo = Partial<Record<CampoTexto, string>>

function paraNumero(valor: string): number | undefined {
  if (valor.trim() === '') return undefined
  const numero = Number(valor.replace(',', '.'))
  return Number.isFinite(numero) ? numero : undefined
}

export function CalculadoraForm() {
  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL)
  const [erros, setErros] = useState<ErrosCampo>({})
  const [carregando, setCarregando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CotacaoResposta | null>(null)
  const idBase = useId()

  const pesoEhDigitado = form.faixaPeso === 'DIGITAR'

  function atualizarCampo<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroGeral(null)
    setResultado(null)

    const pesoG = pesoEhDigitado ? paraNumero(form.pesoDigitadoG) : Number(form.faixaPeso)

    const candidato = {
      cepOrigem: form.cepOrigem,
      cepDestino: form.cepDestino,
      formato: form.formato,
      pesoG,
      alturaCm: paraNumero(form.alturaCm),
      larguraCm: paraNumero(form.larguraCm),
      comprimentoCm: paraNumero(form.comprimentoCm),
    }

    const analisado = cotacaoRequestSchema.safeParse(candidato)
    if (!analisado.success) {
      const camposInvalidos = analisado.error.flatten().fieldErrors
      const novosErros: ErrosCampo = {}
      if (camposInvalidos.cepOrigem) novosErros.cepOrigem = 'Informe o CEP de origem.'
      if (camposInvalidos.cepDestino) novosErros.cepDestino = 'Informe o CEP de destino.'
      if (camposInvalidos.pesoG) novosErros.pesoDigitadoG = 'Informe um peso válido, maior que zero.'
      if (camposInvalidos.alturaCm) novosErros.alturaCm = 'Informe uma altura válida, maior que zero.'
      if (camposInvalidos.larguraCm) novosErros.larguraCm = 'Informe uma largura válida, maior que zero.'
      if (camposInvalidos.comprimentoCm) novosErros.comprimentoCm = 'Informe um comprimento válido, maior que zero.'
      setErros(novosErros)
      return
    }

    setErros({})
    setCarregando(true)

    try {
      const resposta = await fetch('/api/cotacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(analisado.data),
      })

      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const erro = corpo as CotacaoErro
        setErroGeral(erro.mensagem ?? 'Não foi possível calcular o frete. Tente novamente.')
        return
      }

      setResultado(corpo as CotacaoResposta)
    } catch {
      setErroGeral('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Calculadora de frete</h1>
        <p className="mt-1 text-sm text-slate-600">
          Compare preços de balcão e preços com desconto entre as transportadoras.
        </p>
      </header>

      <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-6">
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-bold uppercase tracking-wide text-slate-700">
            Informe a origem
          </legend>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-cepOrigem`} className="text-sm font-medium text-slate-700">
                CEP de origem
              </label>
              <input
                id={`${idBase}-cepOrigem`}
                name="cepOrigem"
                type="text"
                inputMode="numeric"
                placeholder="00000-000"
                value={form.cepOrigem}
                onChange={(e) => atualizarCampo('cepOrigem', e.target.value)}
                aria-invalid={erros.cepOrigem ? true : undefined}
                aria-describedby={erros.cepOrigem ? `${idBase}-cepOrigem-erro` : undefined}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {erros.cepOrigem ? (
                <p id={`${idBase}-cepOrigem-erro`} role="alert" className="text-sm text-red-600">
                  {erros.cepOrigem}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-formato`} className="text-sm font-medium text-slate-700">
                Formato
              </label>
              <select
                id={`${idBase}-formato`}
                name="formato"
                value={form.formato}
                onChange={(e) => atualizarCampo('formato', e.target.value as EstadoFormulario['formato'])}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {FORMATOS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-pesoFaixa`} className="text-sm font-medium text-slate-700">
                Peso
              </label>
              <select
                id={`${idBase}-pesoFaixa`}
                name="pesoFaixa"
                value={form.faixaPeso}
                onChange={(e) => atualizarCampo('faixaPeso', e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {FAIXAS_PESO.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </div>

            {pesoEhDigitado ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-pesoDigitado`} className="text-sm font-medium text-slate-700">
                  Peso (gramas)
                </label>
                <input
                  id={`${idBase}-pesoDigitado`}
                  name="pesoDigitadoG"
                  type="number"
                  min={1}
                  max={30000}
                  value={form.pesoDigitadoG}
                  onChange={(e) => atualizarCampo('pesoDigitadoG', e.target.value)}
                  aria-invalid={erros.pesoDigitadoG ? true : undefined}
                  aria-describedby={erros.pesoDigitadoG ? `${idBase}-pesoDigitado-erro` : undefined}
                  className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {erros.pesoDigitadoG ? (
                  <p id={`${idBase}-pesoDigitado-erro`} role="alert" className="text-sm text-red-600">
                    {erros.pesoDigitadoG}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-altura`} className="text-sm font-medium text-slate-700">
                Altura (cm)
              </label>
              <input
                id={`${idBase}-altura`}
                name="alturaCm"
                type="number"
                min={0.1}
                step="0.1"
                value={form.alturaCm}
                onChange={(e) => atualizarCampo('alturaCm', e.target.value)}
                aria-invalid={erros.alturaCm ? true : undefined}
                aria-describedby={erros.alturaCm ? `${idBase}-altura-erro` : undefined}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {erros.alturaCm ? (
                <p id={`${idBase}-altura-erro`} role="alert" className="text-sm text-red-600">
                  {erros.alturaCm}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-largura`} className="text-sm font-medium text-slate-700">
                Largura (cm)
              </label>
              <input
                id={`${idBase}-largura`}
                name="larguraCm"
                type="number"
                min={0.1}
                step="0.1"
                value={form.larguraCm}
                onChange={(e) => atualizarCampo('larguraCm', e.target.value)}
                aria-invalid={erros.larguraCm ? true : undefined}
                aria-describedby={erros.larguraCm ? `${idBase}-largura-erro` : undefined}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {erros.larguraCm ? (
                <p id={`${idBase}-largura-erro`} role="alert" className="text-sm text-red-600">
                  {erros.larguraCm}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-comprimento`} className="text-sm font-medium text-slate-700">
                Comprimento (cm)
              </label>
              <input
                id={`${idBase}-comprimento`}
                name="comprimentoCm"
                type="number"
                min={0.1}
                step="0.1"
                value={form.comprimentoCm}
                onChange={(e) => atualizarCampo('comprimentoCm', e.target.value)}
                aria-invalid={erros.comprimentoCm ? true : undefined}
                aria-describedby={erros.comprimentoCm ? `${idBase}-comprimento-erro` : undefined}
                className="rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {erros.comprimentoCm ? (
                <p id={`${idBase}-comprimento-erro`} role="alert" className="text-sm text-red-600">
                  {erros.comprimentoCm}
                </p>
              ) : null}
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-bold uppercase tracking-wide text-slate-700">
            Informe o destino
          </legend>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-cepDestino`} className="text-sm font-medium text-slate-700">
              CEP de destino
            </label>
            <input
              id={`${idBase}-cepDestino`}
              name="cepDestino"
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.cepDestino}
              onChange={(e) => atualizarCampo('cepDestino', e.target.value)}
              aria-invalid={erros.cepDestino ? true : undefined}
              aria-describedby={erros.cepDestino ? `${idBase}-cepDestino-erro` : undefined}
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {erros.cepDestino ? (
              <p id={`${idBase}-cepDestino-erro`} role="alert" className="text-sm text-red-600">
                {erros.cepDestino}
              </p>
            ) : null}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={carregando}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-bold uppercase tracking-wide text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? 'Calculando…' : 'Calcular frete com desconto'}
        </button>
      </form>

      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-4">
        {erroGeral ? (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {erroGeral}
          </p>
        ) : null}

        {resultado ? (
          resultado.opcoes.length > 0 ? (
            <ul data-testid="lista-opcoes" className="flex flex-col gap-3">
              {resultado.opcoes.map((opcao) => (
                <OpcaoFreteCard key={opcao.servicoId} opcao={opcao} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Nenhuma opção de frete encontrada para essa rota.</p>
          )
        ) : null}
      </div>
    </div>
  )
}


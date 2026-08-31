'use client'

import { FormEvent, useEffect, useId, useState } from 'react'
import { cotacaoRequestSchema, type CotacaoErro, type CotacaoResposta } from '@/lib/cotacao-schema'
import { OpcaoFreteCard } from './opcao-frete-card'
import { IconeChevron, IconeLimpar, IconeSalvar } from './layout/icones'

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

const CHAVE_LOCAL_STORAGE = 'frete:cep-origem-padrao'

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

const classeCampo =
  'w-full border-0 border-b border-borda-campo bg-transparent px-1 py-2 text-sm text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export function CalculadoraForm() {
  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL)
  const [erros, setErros] = useState<ErrosCampo>({})
  const [carregando, setCarregando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CotacaoResposta | null>(null)
  const [mensagemSalvar, setMensagemSalvar] = useState<string | null>(null)
  const idBase = useId()

  const pesoEhDigitado = form.faixaPeso === 'DIGITAR'

  useEffect(() => {
    let cancelado = false

    async function carregarCepPadrao() {
      try {
        const resposta = await fetch('/api/preferencias/cep-origem')
        if (resposta.ok) {
          const corpo = (await resposta.json()) as { cepOrigem: string | null }
          if (corpo.cepOrigem && !cancelado) {
            setForm((atual) => ({ ...atual, cepOrigem: corpo.cepOrigem as string }))
            return
          }
        }
      } catch {
        // segue para o fallback de localStorage
      }

      if (typeof window === 'undefined' || cancelado) return
      const salvo = window.localStorage.getItem(CHAVE_LOCAL_STORAGE)
      if (salvo) {
        setForm((atual) => ({ ...atual, cepOrigem: salvo }))
      }
    }

    void carregarCepPadrao()
    return () => {
      cancelado = true
    }
  }, [])

  function atualizarCampo<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function aoSalvarOrigem() {
    setMensagemSalvar(null)
    if (!/^\d{5}-?\d{3}$/.test(form.cepOrigem)) {
      setErros((atual) => ({ ...atual, cepOrigem: 'Informe um CEP válido para salvar.' }))
      return
    }

    try {
      const resposta = await fetch('/api/preferencias/cep-origem', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cepOrigem: form.cepOrigem }),
      })

      if (resposta.status === 401) {
        window.localStorage.setItem(CHAVE_LOCAL_STORAGE, form.cepOrigem)
      } else if (!resposta.ok) {
        setMensagemSalvar('Não foi possível salvar o CEP de origem.')
        return
      }
    } catch {
      window.localStorage.setItem(CHAVE_LOCAL_STORAGE, form.cepOrigem)
    }

    setMensagemSalvar('CEP de origem salvo como padrão.')
  }

  function aoLimparOrigem() {
    setForm((atual) => ({
      ...atual,
      cepOrigem: ESTADO_INICIAL.cepOrigem,
      formato: ESTADO_INICIAL.formato,
      faixaPeso: ESTADO_INICIAL.faixaPeso,
      pesoDigitadoG: ESTADO_INICIAL.pesoDigitadoG,
      alturaCm: ESTADO_INICIAL.alturaCm,
      larguraCm: ESTADO_INICIAL.larguraCm,
      comprimentoCm: ESTADO_INICIAL.comprimentoCm,
    }))
    setMensagemSalvar(null)
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
    <div className="mx-auto flex max-w-conteudo flex-col gap-6 py-2">
      <div className="rounded-xl bg-superficie-bloco p-6 text-center text-sm font-medium text-texto-secundario">
        Espaço reservado para campanha
      </div>

      <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-texto-secundario">
            Informe a origem
          </h2>

          <fieldset className="rounded-xl bg-superficie-bloco p-4">
            <legend className="sr-only">Informe a origem</legend>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor={`${idBase}-cepOrigem`} className="text-xs font-medium text-texto-secundario">
                  CEP de origem
                </label>
                <input
                  id={`${idBase}-cepOrigem`}
                  name="cepOrigem"
                  type="text"
                  inputMode="numeric"
                  placeholder="XXXXX-XXX"
                  value={form.cepOrigem}
                  onChange={(e) => atualizarCampo('cepOrigem', e.target.value)}
                  aria-invalid={erros.cepOrigem ? true : undefined}
                  aria-describedby={erros.cepOrigem ? `${idBase}-cepOrigem-erro` : undefined}
                  className={classeCampo}
                />
                {erros.cepOrigem ? (
                  <p id={`${idBase}-cepOrigem-erro`} role="alert" className="text-sm text-erro">
                    {erros.cepOrigem}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={aoSalvarOrigem}
                  className="flex items-center gap-1 rounded-pilula bg-brand px-4 py-2 text-xs font-bold uppercase text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <IconeSalvar width={16} height={16} />
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={aoLimparOrigem}
                  className="flex items-center gap-1 rounded-pilula bg-brand px-4 py-2 text-xs font-bold uppercase text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <IconeLimpar width={16} height={16} />
                  Limpar
                </button>
              </div>
            </div>

            {mensagemSalvar ? (
              <p role="status" className="mt-2 text-sm text-brand-texto">
                {mensagemSalvar}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-formato`} className="text-xs font-medium text-texto-secundario">
                  Formato
                </label>
                <select
                  id={`${idBase}-formato`}
                  name="formato"
                  value={form.formato}
                  onChange={(e) => atualizarCampo('formato', e.target.value as EstadoFormulario['formato'])}
                  className={classeCampo}
                >
                  {FORMATOS.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-pesoFaixa`} className="text-xs font-medium text-texto-secundario">
                  Peso
                </label>
                <select
                  id={`${idBase}-pesoFaixa`}
                  name="pesoFaixa"
                  value={form.faixaPeso}
                  onChange={(e) => atualizarCampo('faixaPeso', e.target.value)}
                  className={classeCampo}
                >
                  {FAIXAS_PESO.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
              </div>

              {pesoEhDigitado ? (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor={`${idBase}-pesoDigitado`} className="text-xs font-medium text-texto-secundario">
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
                    className={classeCampo}
                  />
                  {erros.pesoDigitadoG ? (
                    <p id={`${idBase}-pesoDigitado-erro`} role="alert" className="text-sm text-erro">
                      {erros.pesoDigitadoG}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-altura`} className="text-xs font-medium text-texto-secundario">
                  Altura (cm)
                </label>
                <div className="flex items-center border-b border-borda-campo focus-within:border-brand">
                  <input
                    id={`${idBase}-altura`}
                    name="alturaCm"
                    type="number"
                    min={0.1}
                    step="0.1"
                    placeholder="00"
                    value={form.alturaCm}
                    onChange={(e) => atualizarCampo('alturaCm', e.target.value)}
                    aria-invalid={erros.alturaCm ? true : undefined}
                    aria-describedby={erros.alturaCm ? `${idBase}-altura-erro` : undefined}
                    className="w-full border-0 bg-transparent px-1 py-2 text-sm text-texto-principal focus:outline-none"
                  />
                  <span className="pr-1 text-xs text-texto-secundario">cm</span>
                </div>
                {erros.alturaCm ? (
                  <p id={`${idBase}-altura-erro`} role="alert" className="text-sm text-erro">
                    {erros.alturaCm}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-largura`} className="text-xs font-medium text-texto-secundario">
                  Largura (cm)
                </label>
                <div className="flex items-center border-b border-borda-campo focus-within:border-brand">
                  <input
                    id={`${idBase}-largura`}
                    name="larguraCm"
                    type="number"
                    min={0.1}
                    step="0.1"
                    placeholder="00"
                    value={form.larguraCm}
                    onChange={(e) => atualizarCampo('larguraCm', e.target.value)}
                    aria-invalid={erros.larguraCm ? true : undefined}
                    aria-describedby={erros.larguraCm ? `${idBase}-largura-erro` : undefined}
                    className="w-full border-0 bg-transparent px-1 py-2 text-sm text-texto-principal focus:outline-none"
                  />
                  <span className="pr-1 text-xs text-texto-secundario">cm</span>
                </div>
                {erros.larguraCm ? (
                  <p id={`${idBase}-largura-erro`} role="alert" className="text-sm text-erro">
                    {erros.larguraCm}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-comprimento`} className="text-xs font-medium text-texto-secundario">
                  Comprimento (cm)
                </label>
                <div className="flex items-center border-b border-borda-campo focus-within:border-brand">
                  <input
                    id={`${idBase}-comprimento`}
                    name="comprimentoCm"
                    type="number"
                    min={0.1}
                    step="0.1"
                    placeholder="00"
                    value={form.comprimentoCm}
                    onChange={(e) => atualizarCampo('comprimentoCm', e.target.value)}
                    aria-invalid={erros.comprimentoCm ? true : undefined}
                    aria-describedby={erros.comprimentoCm ? `${idBase}-comprimento-erro` : undefined}
                    className="w-full border-0 bg-transparent px-1 py-2 text-sm text-texto-principal focus:outline-none"
                  />
                  <span className="pr-1 text-xs text-texto-secundario">cm</span>
                </div>
                {erros.comprimentoCm ? (
                  <p id={`${idBase}-comprimento-erro`} role="alert" className="text-sm text-erro">
                    {erros.comprimentoCm}
                  </p>
                ) : null}
              </div>
            </div>

            <details className="mt-4 rounded-lg bg-white px-4 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-center gap-2 text-center text-sm font-medium text-texto-principal">
                Seguro, aviso e mão própria
                <IconeChevron width={16} height={16} />
              </summary>
              <p className="mt-2 text-xs text-texto-secundario">
                Esses opcionais chegam em uma fase futura.
              </p>
            </details>
          </fieldset>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-texto-secundario">
            Informe o destino
          </h2>

          <fieldset className="rounded-xl bg-superficie-bloco p-4">
            <legend className="sr-only">Informe o destino</legend>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor={`${idBase}-cepDestino`} className="text-xs font-medium text-texto-secundario">
                  CEP de destino
                </label>
                <input
                  id={`${idBase}-cepDestino`}
                  name="cepDestino"
                  type="text"
                  inputMode="numeric"
                  placeholder="XXXXX-XXX"
                  value={form.cepDestino}
                  onChange={(e) => atualizarCampo('cepDestino', e.target.value)}
                  aria-invalid={erros.cepDestino ? true : undefined}
                  aria-describedby={erros.cepDestino ? `${idBase}-cepDestino-erro` : undefined}
                  className={classeCampo}
                />
                {erros.cepDestino ? (
                  <p id={`${idBase}-cepDestino-erro`} role="alert" className="text-sm text-erro">
                    {erros.cepDestino}
                  </p>
                ) : null}
              </div>

              <a
                href="https://buscacepinter.correios.com.br/app/endereco/index.php"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm font-medium text-brand-texto underline underline-offset-2 hover:text-brand-light"
              >
                Pesquisar CEP
              </a>
            </div>
          </fieldset>
        </div>

        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-pilula bg-brand px-6 py-3 text-base font-bold uppercase tracking-wide text-white transition hover:bg-brand-light focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {carregando ? 'Calculando…' : 'Calcular frete com desconto'}
        </button>
      </form>

      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-4">
        {erroGeral ? (
          <p role="alert" className="rounded-lg bg-erro-fundo p-3 text-sm text-erro">
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
            <p className="text-sm text-texto-secundario">Nenhuma opção de frete encontrada para essa rota.</p>
          )
        ) : null}
      </div>
    </div>
  )
}

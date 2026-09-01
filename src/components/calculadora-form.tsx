'use client'

import { FormEvent, useEffect, useId, useState, type ReactNode } from 'react'
import { cotacaoRequestSchema, type CotacaoErro, type CotacaoResposta } from '@/lib/cotacao-schema'
import { OpcaoFreteCard } from './opcao-frete-card'
import { ModalCadastro } from './modal-cadastro'
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

/**
 * Campo com caixa, e não com risco embaixo.
 *
 * O sublinhado sozinho funciona em formulário sobre fundo branco, onde a
 * linha é a única coisa na região. Aqui os blocos são cinza sobre um cartão
 * branco, e o risco desaparecia: sobrava um texto de exemplo flutuando no
 * nada, sem nada dizendo onde clicar nem onde o campo termina.
 *
 * `aria-[invalid=true]` pinta a borda de erro a partir do atributo que já é
 * definido para o leitor de tela. Uma classe condicional em paralelo criaria
 * duas fontes para o mesmo estado, e elas divergem no primeiro descuido.
 */
const classeCampo =
  'w-full rounded-campo border border-borda-campo bg-superficie-card px-3 py-2.5 text-dado text-texto-principal transition placeholder:text-texto-riscado focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand aria-[invalid=true]:border-erro'

/**
 * Largura de campo curto.
 *
 * CEP tem nove caracteres. Num cartão de mil pixels, deixá-lo ocupar a linha
 * inteira faz o formulário parecer quebrado antes mesmo de alguém digitar —
 * o olho lê o tamanho da caixa como promessa do tamanho da resposta.
 */
const classeCampoCurto = 'w-full max-w-[15rem]'

/**
 * Salvar e Limpar são ações de apoio, e vazadas dizem isso.
 *
 * Preenchidas de azul, com o mesmo peso do botão que calcula o frete, elas
 * disputavam o olho com a única ação que importa na tela — e quem chega para
 * cotar um frete não veio salvar preferência nenhuma.
 */
const classeBotaoSecundario =
  'flex items-center gap-1.5 rounded-campo border border-borda-campo bg-superficie-card px-3.5 py-2.5 text-dado font-semibold text-brand-texto transition hover:border-brand hover:bg-brand-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/**
 * `autenticado` vem do servidor (a home lê a sessão sem redirecionar) só
 * para o cartão de resultado saber se manda direto ao fluxo de envio ou
 * passa pelo login antes. Esconder ou mostrar dado sensível não depende
 * disto — a decisão é de destino de link, e as rotas protegidas continuam
 * checando sessão por conta própria.
 */
export function CalculadoraForm({ autenticado = false }: { autenticado?: boolean }) {
  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL)
  const [erros, setErros] = useState<ErrosCampo>({})
  const [carregando, setCarregando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CotacaoResposta | null>(null)
  /**
   * Destino do frete escolhido por um visitante — e, enquanto tiver valor, o
   * sinal de que o cadastro está aberto. Guardar o destino em vez de um
   * booleano evita perder qual serviço foi clicado entre a escolha e o fim do
   * cadastro.
   */
  const [destinoCadastro, setDestinoCadastro] = useState<string | null>(null)
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
    /*
      Na página pública a largura vem da moldura (`ShellPublico`), que já
      centraliza em `max-w-5xl`; no app autenticado o `main` não limita nada,
      então o limite de leitura precisa vir daqui — sem ele o formulário se
      estica até a borda do monitor.
    */
    <div
      className={`flex flex-col gap-bloco ${autenticado ? 'mx-auto max-w-conteudo py-2' : ''}`}
    >
      <form
        onSubmit={aoSubmeter}
        noValidate
        className="flex flex-col gap-6 rounded-painel bg-superficie-card p-5 shadow-elevado sm:p-7"
      >
        <div className="flex flex-col gap-3">
          <PassoTitulo numero={1}>De onde sai</PassoTitulo>

          <fieldset className="rounded-cartao bg-superficie-pagina p-4">
            <legend className="sr-only">Informe a origem</legend>

            {/*
              `flex-wrap` em vez de `justify-between`: entre 640 e 768px o CEP
              e os dois botões não cabem lado a lado, e separá-los pelas pontas
              deixava um vão no meio da linha. Envolvendo, os botões descem
              inteiros para a linha de baixo.
            */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className={`flex flex-col gap-1.5 ${classeCampoCurto}`}>
                <label htmlFor={`${idBase}-cepOrigem`} className="text-rotulo font-semibold uppercase text-texto-secundario">
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
                  <p id={`${idBase}-cepOrigem-erro`} role="alert" className="text-dado text-erro">
                    {erros.cepOrigem}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={aoSalvarOrigem}
                  className={classeBotaoSecundario}
                >
                  <IconeSalvar width={16} height={16} />
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={aoLimparOrigem}
                  className={classeBotaoSecundario}
                >
                  <IconeLimpar width={16} height={16} />
                  Limpar
                </button>
              </div>
            </div>

            {mensagemSalvar ? (
              <p role="status" className="mt-2 text-dado text-brand-texto">
                {mensagemSalvar}
              </p>
            ) : null}
          </fieldset>
        </div>

        {/*
          Formato, peso e medidas descrevem o pacote, não a origem — estavam
          no mesmo bloco do CEP de partida só por ordem de escrita. Separados,
          o formulário passa a ter os três blocos que a pessoa já tem na
          cabeça: de onde sai, o que vai dentro, para onde vai.
        */}
        <div className="flex flex-col gap-3">
          <PassoTitulo numero={2}>O que vai dentro</PassoTitulo>

          <fieldset className="rounded-cartao bg-superficie-pagina p-4">
            <legend className="sr-only">O que vai dentro</legend>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-formato`} className="text-rotulo font-semibold uppercase text-texto-secundario">
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
                <label htmlFor={`${idBase}-pesoFaixa`} className="text-rotulo font-semibold uppercase text-texto-secundario">
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
                  <label htmlFor={`${idBase}-pesoDigitado`} className="text-rotulo font-semibold uppercase text-texto-secundario">
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
                    <p id={`${idBase}-pesoDigitado-erro`} role="alert" className="text-dado text-erro">
                      {erros.pesoDigitadoG}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-altura`} className="text-rotulo font-semibold uppercase text-texto-secundario">
                  Altura (cm)
                </label>
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
                  className={classeCampo}
                  />
                {erros.alturaCm ? (
                  <p id={`${idBase}-altura-erro`} role="alert" className="text-dado text-erro">
                  {erros.alturaCm}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-largura`} className="text-rotulo font-semibold uppercase text-texto-secundario">
                  Largura (cm)
                </label>
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
                  className={classeCampo}
                  />
                {erros.larguraCm ? (
                  <p id={`${idBase}-largura-erro`} role="alert" className="text-dado text-erro">
                  {erros.larguraCm}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`${idBase}-comprimento`} className="text-rotulo font-semibold uppercase text-texto-secundario">
                  Comprimento (cm)
                </label>
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
                  className={classeCampo}
                  />
                {erros.comprimentoCm ? (
                  <p id={`${idBase}-comprimento-erro`} role="alert" className="text-dado text-erro">
                  {erros.comprimentoCm}
                  </p>
                ) : null}
              </div>
            </div>

            {/*
              Alinhado à esquerda, com a seta na ponta. Centralizado e ocupando
              a linha inteira, o bloco lia como botão — e quem clicava esperava
              outra coisa que não abrir um texto.
            */}
            <details className="mt-4 rounded-campo border border-borda-campo bg-superficie-card px-4">
              {/* `list-none` some com o triângulo padrão; o seletor do webkit
                  cobre o Safari, que ignora o primeiro. Sem os dois, aparecem
                  duas setas: a do navegador e a nossa. */}
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-dado font-medium text-texto-principal [&::-webkit-details-marker]:hidden">
                Seguro, aviso e mão própria
                <IconeChevron width={16} height={16} />
              </summary>
              <p className="pb-3 text-dado text-texto-secundario">
                Esses opcionais chegam em uma fase futura.
              </p>
            </details>
          </fieldset>
        </div>

        <div className="flex flex-col gap-3">
          <PassoTitulo numero={3}>Para onde vai</PassoTitulo>

          <fieldset className="rounded-cartao bg-superficie-pagina p-4">
            <legend className="sr-only">Para onde vai</legend>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className={`flex flex-col gap-1.5 ${classeCampoCurto}`}>
                <label htmlFor={`${idBase}-cepDestino`} className="text-rotulo font-semibold uppercase text-texto-secundario">
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
                  <p id={`${idBase}-cepDestino-erro`} role="alert" className="text-dado text-erro">
                  {erros.cepDestino}
                  </p>
                ) : null}
              </div>

              <a
                href="https://buscacepinter.correios.com.br/app/endereco/index.php"
                target="_blank"
                rel="noreferrer"
                /* `sm:pb-3` alinha o link com a base do campo ao lado; sem
                   isso ele flutua na altura do rótulo. */
                className="shrink-0 text-dado font-medium text-brand-texto underline underline-offset-2 hover:text-brand-light sm:pb-3"
              >
                Pesquisar CEP
              </a>
            </div>
          </fieldset>
        </div>

        {/*
          Vermelho na página aberta, navy dentro do app — a razão está no
          token `destaque` (tailwind.config.ts). Aqui é a mesma ação do botão
          vermelho de martinslog.net, e é a única ação da tela.
        */}
        <button
          type="submit"
          disabled={carregando}
          /*
            Largura travada no desktop. Um botão de mil pixels não parece
            importante, parece um erro de layout — e o alvo de clique já era
            suficiente na metade disso. No celular ele volta a ocupar a linha,
            onde largura cheia é o que se espera do botão principal.
          */
          className={`w-full rounded-pilula px-6 py-4 text-base font-bold tracking-wide text-white transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:mx-auto sm:w-auto sm:min-w-[18rem] ${
            autenticado
              ? 'bg-brand hover:bg-brand-light focus-visible:outline-brand'
              : 'bg-destaque shadow-elevado hover:bg-destaque-escuro focus-visible:outline-destaque'
          }`}
        >
          {carregando ? 'Calculando…' : 'Calcular frete'}
        </button>

        {autenticado ? null : (
          <p className="text-center text-dado text-texto-secundario">
            Consulta gratuita. Você só cria conta na hora de emitir a etiqueta.
          </p>
        )}
      </form>

      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-4">
        {erroGeral ? (
          <p role="alert" className="rounded-lg bg-erro-fundo p-3 text-dado text-erro">
            {erroGeral}
          </p>
        ) : null}

        {resultado ? (
          resultado.opcoes.length > 0 ? (
            <ul data-testid="lista-opcoes" className="flex flex-col gap-3">
              {resultado.opcoes.map((opcao) => (
                <OpcaoFreteCard
                  key={opcao.servicoId}
                  opcao={opcao}
                  quoteId={resultado.quoteId}
                  autenticado={autenticado}
                  aoEscolherComoVisitante={setDestinoCadastro}
                />
              ))}
            </ul>
          ) : (
            <p className="text-dado text-texto-secundario">Nenhuma opção de frete encontrada para essa rota.</p>
          )
        ) : null}

        {/*
          Visitante que escolhe um frete cria conta aqui mesmo. A cotação
          continua na tela atrás do diálogo, e o destino guardado leva direto
          ao fluxo de envio com o serviço escolhido — sem recalcular nada.
        */}
        {destinoCadastro ? (
          <ModalCadastro destino={destinoCadastro} aoFechar={() => setDestinoCadastro(null)} />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Cabeçalho numerado de cada bloco do formulário.
 *
 * O número não é enfeite: antes os três blocos eram títulos em caixa alta e
 * cinza-claro, do mesmo tamanho e peso dos rótulos de campo logo abaixo. Com
 * tudo cinza sobre cinza, nada dizia onde um bloco terminava e o outro
 * começava — a tela lia como uma lista única de doze campos.
 */
function PassoTitulo({ numero, children }: { numero: number; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-rotulo font-bold text-white"
      >
        {numero}
      </span>
      <span className="text-rotulo font-bold uppercase text-texto-principal">{children}</span>
    </h2>
  )
}

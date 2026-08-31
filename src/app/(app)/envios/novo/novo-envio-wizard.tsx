'use client'

import { FormEvent, useEffect, useId, useState } from 'react'
import { EnderecoForm } from '@/components/endereco-form'
import type { EnderecoResposta } from '@/lib/endereco-schema'

type Etapa = 'cotacao' | 'remetente' | 'destinatario' | 'produtos' | 'revisao'

type OpcaoCotacaoResposta = {
  servicoId: string
  servicoNome: string
  carrierNome: string
  disponivel: boolean
  observacao: string | null
  precoBalcaoCentavos: number
  precoFinalCentavos: number
  descontoCentavos: number
  prazoDias: number
}

type ProdutoLinha = {
  nome: string
  quantidade: string
  valorUnitarioReais: string
}

type PreviaResposta = {
  servicoNome: string
  carrierNome: string
  precoBalcaoCentavos: number
  precoCobradoCentavos: number
  descontoCentavos: number
  prazoDias: number
}

const classeCampo =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const classeBotaoPrimario =
  'rounded-pilula bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60'

const classeBotaoSecundario =
  'rounded-pilula border border-borda-campo px-5 py-2.5 text-sm font-semibold text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function novaLinhaProduto(): ProdutoLinha {
  return { nome: '', quantidade: '1', valorUnitarioReais: '' }
}

function enderecoParaEnvio(endereco: EnderecoResposta) {
  return {
    nome: endereco.nome ?? '',
    documento: endereco.documento ?? undefined,
    email: endereco.email ?? undefined,
    telefone: endereco.telefone ?? undefined,
    cep: endereco.cep,
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento ?? undefined,
    bairro: endereco.bairro,
    cidade: endereco.cidade,
    uf: endereco.uf,
  }
}

type SeletorEnderecoProps = {
  tipo: 'REMETENTE' | 'DESTINATARIO'
  titulo: string
  selecionado: EnderecoResposta | null
  onSelecionar: (endereco: EnderecoResposta) => void
}

/**
 * Lista os endereços salvos do usuário (filtrados por `tipo`) para escolha,
 * com opção de cadastrar um novo — reaproveitando `EnderecoForm`, que já
 * persiste em `/api/enderecos` e segue o padrão de acessibilidade das
 * telas anteriores.
 */
function SeletorEndereco({ tipo, titulo, selecionado, onSelecionar }: SeletorEnderecoProps) {
  const [enderecos, setEnderecos] = useState<EnderecoResposta[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/enderecos')
      if (!resposta.ok) {
        setErro('Não foi possível carregar os endereços salvos.')
        return
      }
      const dados = (await resposta.json()) as { enderecos: EnderecoResposta[] }
      setEnderecos(dados.enderecos.filter((e) => e.tipo === tipo))
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-texto-principal">{titulo}</legend>

      {carregando && <p className="text-sm text-texto-secundario">Carregando endereços…</p>}
      {erro && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {enderecos && enderecos.length > 0 && (
        <div className="flex flex-col gap-2">
          {enderecos.map((endereco) => (
            <label
              key={endereco.id}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-brand ${
                selecionado?.id === endereco.id
                  ? 'border-brand bg-brand-bg'
                  : 'border-borda-campo bg-superficie-card hover:bg-superficie-bloco'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`endereco-${tipo}`}
                  checked={selecionado?.id === endereco.id}
                  onChange={() => onSelecionar(endereco)}
                />
                <span className="font-semibold text-texto-principal">
                  {endereco.apelido || endereco.nome || 'Endereço sem apelido'}
                </span>
              </span>
              <span className="pl-6 text-texto-secundario">
                {endereco.logradouro}, {endereco.numero} — {endereco.bairro}, {endereco.cidade}/{endereco.uf}
              </span>
            </label>
          ))}
        </div>
      )}

      {enderecos && enderecos.length === 0 && !mostrarFormulario && (
        <p className="text-sm text-texto-secundario">Nenhum endereço salvo deste tipo ainda.</p>
      )}

      {!mostrarFormulario ? (
        <button type="button" onClick={() => setMostrarFormulario(true)} className={classeBotaoSecundario}>
          Cadastrar novo endereço
        </button>
      ) : (
        <div className="rounded-lg border border-borda-campo p-4">
          <EnderecoForm
            tipo={tipo}
            onCancelar={() => setMostrarFormulario(false)}
            onSalvar={(endereco) => {
              setMostrarFormulario(false)
              void carregar()
              onSelecionar(endereco)
            }}
          />
        </div>
      )}
    </fieldset>
  )
}

/**
 * Fluxo de criação de envio em etapas: cotação → remetente → destinatário
 * → produtos (declaração de conteúdo) → revisão → confirmar. O preço só é
 * lido do servidor (nunca calculado ou enviado pelo cliente) — a revisão
 * busca a prévia em `GET /api/envios` e o "Confirmar" manda só
 * `quoteId`/`servicoId`/endereços/produtos para `POST /api/envios`.
 */
export function NovoEnvioWizard({
  quoteIdInicial,
  servicoIdInicial,
}: {
  quoteIdInicial?: string
  servicoIdInicial?: string
}) {
  const idCotacao = useId()
  const [etapa, setEtapa] = useState<Etapa>(quoteIdInicial ? 'remetente' : 'cotacao')

  // Etapa 1: cotação
  const [quoteId, setQuoteId] = useState<string | null>(quoteIdInicial ?? null)
  const [servicoId, setServicoId] = useState<string | null>(servicoIdInicial ?? null)
  const [opcoes, setOpcoes] = useState<OpcaoCotacaoResposta[] | null>(null)
  const [formCotacao, setFormCotacao] = useState({
    cepOrigem: '',
    cepDestino: '',
    pesoG: '',
    alturaCm: '',
    larguraCm: '',
    comprimentoCm: '',
    formato: 'CAIXA' as 'CAIXA' | 'ROLO' | 'ENVELOPE',
  })
  const [cotando, setCotando] = useState(false)
  const [erroCotacao, setErroCotacao] = useState<string | null>(null)

  // Etapas 2 e 3: endereços
  const [remetente, setRemetente] = useState<EnderecoResposta | null>(null)
  const [destinatario, setDestinatario] = useState<EnderecoResposta | null>(null)

  // Etapa 4: produtos
  const [produtos, setProdutos] = useState<ProdutoLinha[]>([novaLinhaProduto()])

  // Etapa 5: revisão
  const [previa, setPrevia] = useState<PreviaResposta | null>(null)
  const [saldoCentavos, setSaldoCentavos] = useState<number | null>(null)
  const [carregandoRevisao, setCarregandoRevisao] = useState(false)
  const [erroRevisao, setErroRevisao] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [shipmentIdPendente, setShipmentIdPendente] = useState<string | null>(null)
  const [envioConcluidoId, setEnvioConcluidoId] = useState<string | null>(null)

  // Recarga inline (sem perder o que já foi preenchido no formulário)
  const [mostrarRecarga, setMostrarRecarga] = useState(false)
  const [valorRecarga, setValorRecarga] = useState('')
  const [criandoRecarga, setCriandoRecarga] = useState(false)
  const [erroRecarga, setErroRecarga] = useState<string | null>(null)
  const [qrRecarga, setQrRecarga] = useState<string | null>(null)

  async function submeterCotacao(evento: FormEvent) {
    evento.preventDefault()
    setErroCotacao(null)
    setCotando(true)
    try {
      const resposta = await fetch('/api/cotacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cepOrigem: formCotacao.cepOrigem,
          cepDestino: formCotacao.cepDestino,
          pesoG: Number(formCotacao.pesoG),
          alturaCm: Number(formCotacao.alturaCm),
          larguraCm: Number(formCotacao.larguraCm),
          comprimentoCm: Number(formCotacao.comprimentoCm),
          formato: formCotacao.formato,
        }),
      })
      const corpo: unknown = await resposta.json()
      if (!resposta.ok) {
        const erro = corpo as { mensagem?: string }
        setErroCotacao(erro.mensagem ?? 'Não foi possível gerar a cotação.')
        return
      }
      const dados = corpo as { quoteId: string; opcoes: OpcaoCotacaoResposta[] }
      setQuoteId(dados.quoteId)
      setOpcoes(dados.opcoes)
    } catch {
      setErroCotacao('Não foi possível conectar ao servidor.')
    } finally {
      setCotando(false)
    }
  }

  function irParaRevisao() {
    setEtapa('revisao')
  }

  useEffect(() => {
    if (etapa !== 'revisao' || !quoteId || !servicoId) return

    let cancelado = false
    async function carregar() {
      setCarregandoRevisao(true)
      setErroRevisao(null)
      try {
        const [respostaPrevia, respostaCarteira] = await Promise.all([
          fetch(`/api/envios?quoteId=${encodeURIComponent(quoteId as string)}&servicoId=${encodeURIComponent(servicoId as string)}`),
          fetch('/api/carteira'),
        ])

        if (!respostaPrevia.ok) {
          const erro = (await respostaPrevia.json().catch(() => ({}))) as { mensagem?: string }
          if (!cancelado) setErroRevisao(erro.mensagem ?? 'Não foi possível calcular o preço do envio.')
          return
        }
        const { previa: previaResposta } = (await respostaPrevia.json()) as { previa: PreviaResposta }

        let saldo: number | null = null
        if (respostaCarteira.ok) {
          const dadosCarteira = (await respostaCarteira.json()) as { saldoCentavos: number }
          saldo = dadosCarteira.saldoCentavos
        }

        if (!cancelado) {
          setPrevia(previaResposta)
          setSaldoCentavos(saldo)
        }
      } catch {
        if (!cancelado) setErroRevisao('Não foi possível conectar ao servidor.')
      } finally {
        if (!cancelado) setCarregandoRevisao(false)
      }
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [etapa, quoteId, servicoId])

  function produtosParaEnvio() {
    return produtos
      .filter((p) => p.nome.trim().length > 0)
      .map((p) => ({
        nome: p.nome.trim(),
        quantidade: Math.max(1, Math.round(Number(p.quantidade) || 1)),
        valorUnitarioCentavos: Math.round(Number(p.valorUnitarioReais.replace(',', '.')) * 100) || 0,
      }))
  }

  async function confirmarEnvio() {
    if (!quoteId || !servicoId || !remetente || !destinatario) return
    setConfirmando(true)
    setErroRevisao(null)
    try {
      const resposta = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          servicoId,
          remetente: enderecoParaEnvio(remetente),
          destinatario: enderecoParaEnvio(destinatario),
          produtos: produtosParaEnvio(),
        }),
      })
      const corpo: unknown = await resposta.json()

      if (resposta.status === 201) {
        const dados = corpo as { id: string }
        setEnvioConcluidoId(dados.id)
        return
      }

      if (resposta.status === 402) {
        const dados = corpo as { shipmentId: string; mensagem?: string }
        setShipmentIdPendente(dados.shipmentId)
        setErroRevisao(dados.mensagem ?? 'Saldo insuficiente para pagar este envio.')
        return
      }

      const erro = corpo as { mensagem?: string }
      setErroRevisao(erro.mensagem ?? 'Não foi possível criar o envio agora.')
    } catch {
      setErroRevisao('Não foi possível conectar ao servidor.')
    } finally {
      setConfirmando(false)
    }
  }

  async function tentarPagarNovamente() {
    if (!shipmentIdPendente) return
    setConfirmando(true)
    setErroRevisao(null)
    try {
      const resposta = await fetch('/api/envios', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipmentId: shipmentIdPendente }),
      })
      if (resposta.status === 204) {
        setEnvioConcluidoId(shipmentIdPendente)
        return
      }
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
      setErroRevisao(corpo.mensagem ?? 'Ainda não foi possível pagar este envio.')
    } catch {
      setErroRevisao('Não foi possível conectar ao servidor.')
    } finally {
      setConfirmando(false)
    }
  }

  async function solicitarRecarga(evento: FormEvent) {
    evento.preventDefault()
    setErroRecarga(null)
    const reais = Number(valorRecarga.replace(',', '.').trim())
    if (!valorRecarga || !Number.isFinite(reais) || reais <= 0) {
      setErroRecarga('Informe um valor válido, maior que zero.')
      return
    }
    setCriandoRecarga(true)
    try {
      const resposta = await fetch('/api/carteira/recarga', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ valorCentavos: Math.round(reais * 100) }),
      })
      const corpo: unknown = await resposta.json()
      if (!resposta.ok) {
        const erro = corpo as { mensagem?: string }
        setErroRecarga(erro.mensagem ?? 'Não foi possível criar a recarga agora.')
        return
      }
      const { recarga } = corpo as { recarga: { qrCode: string } }
      setQrRecarga(recarga.qrCode)
    } catch {
      setErroRecarga('Não foi possível conectar ao servidor.')
    } finally {
      setCriandoRecarga(false)
    }
  }

  async function verificarSaldoAposRecarga() {
    try {
      const resposta = await fetch('/api/carteira')
      if (!resposta.ok) return
      const dados = (await resposta.json()) as { saldoCentavos: number }
      setSaldoCentavos(dados.saldoCentavos)
    } catch {
      // silencioso: usuário pode tentar de novo pelo botão
    }
  }

  if (envioConcluidoId) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-xl bg-superficie-card p-8 text-center"
      >
        <h1 className="text-xl font-bold text-texto-principal">Envio criado e pago!</h1>
        <p className="text-sm text-texto-secundario">
          O envio <span className="font-mono">{envioConcluidoId}</span> foi confirmado. A etiqueta será
          gerada em seguida.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Etapas" className="flex flex-wrap gap-2 text-xs font-semibold text-texto-secundario">
        {(['cotacao', 'remetente', 'destinatario', 'produtos', 'revisao'] as Etapa[]).map((passo, indice) => (
          <span
            key={passo}
            aria-current={etapa === passo ? 'step' : undefined}
            className={`rounded-pilula px-3 py-1 ${
              etapa === passo ? 'bg-brand text-white' : 'bg-superficie-bloco'
            }`}
          >
            {indice + 1}. {passo === 'cotacao' && 'Cotação'}
            {passo === 'remetente' && 'Remetente'}
            {passo === 'destinatario' && 'Destinatário'}
            {passo === 'produtos' && 'Produtos'}
            {passo === 'revisao' && 'Revisão'}
          </span>
        ))}
      </nav>

      {etapa === 'cotacao' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6" aria-labelledby={`${idCotacao}-titulo`}>
          <h1 id={`${idCotacao}-titulo`} className="text-lg font-bold text-texto-principal">
            Escolha a cotação
          </h1>
          <form onSubmit={submeterCotacao} className="grid grid-cols-2 gap-3">
            <div className="col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idCotacao}-origem`} className="text-xs font-medium text-texto-secundario">
                  CEP de origem
                </label>
                <input
                  id={`${idCotacao}-origem`}
                  className={classeCampo}
                  value={formCotacao.cepOrigem}
                  onChange={(e) => setFormCotacao((f) => ({ ...f, cepOrigem: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${idCotacao}-destino`} className="text-xs font-medium text-texto-secundario">
                  CEP de destino
                </label>
                <input
                  id={`${idCotacao}-destino`}
                  className={classeCampo}
                  value={formCotacao.cepDestino}
                  onChange={(e) => setFormCotacao((f) => ({ ...f, cepDestino: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idCotacao}-peso`} className="text-xs font-medium text-texto-secundario">
                Peso (g)
              </label>
              <input
                id={`${idCotacao}-peso`}
                type="number"
                min={1}
                className={classeCampo}
                value={formCotacao.pesoG}
                onChange={(e) => setFormCotacao((f) => ({ ...f, pesoG: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idCotacao}-formato`} className="text-xs font-medium text-texto-secundario">
                Formato
              </label>
              <select
                id={`${idCotacao}-formato`}
                className={classeCampo}
                value={formCotacao.formato}
                onChange={(e) => setFormCotacao((f) => ({ ...f, formato: e.target.value as typeof f.formato }))}
              >
                <option value="CAIXA">Caixa</option>
                <option value="ROLO">Rolo</option>
                <option value="ENVELOPE">Envelope</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idCotacao}-altura`} className="text-xs font-medium text-texto-secundario">
                Altura (cm)
              </label>
              <input
                id={`${idCotacao}-altura`}
                type="number"
                min={1}
                className={classeCampo}
                value={formCotacao.alturaCm}
                onChange={(e) => setFormCotacao((f) => ({ ...f, alturaCm: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idCotacao}-largura`} className="text-xs font-medium text-texto-secundario">
                Largura (cm)
              </label>
              <input
                id={`${idCotacao}-largura`}
                type="number"
                min={1}
                className={classeCampo}
                value={formCotacao.larguraCm}
                onChange={(e) => setFormCotacao((f) => ({ ...f, larguraCm: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idCotacao}-comprimento`} className="text-xs font-medium text-texto-secundario">
                Comprimento (cm)
              </label>
              <input
                id={`${idCotacao}-comprimento`}
                type="number"
                min={1}
                className={classeCampo}
                value={formCotacao.comprimentoCm}
                onChange={(e) => setFormCotacao((f) => ({ ...f, comprimentoCm: e.target.value }))}
                required
              />
            </div>

            {erroCotacao && (
              <p role="alert" className="col-span-2 text-sm text-erro">
                {erroCotacao}
              </p>
            )}

            <button type="submit" disabled={cotando} className={`${classeBotaoPrimario} col-span-2 justify-self-start`}>
              {cotando ? 'Calculando…' : 'Calcular cotação'}
            </button>
          </form>

          {opcoes && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-texto-principal">Serviços disponíveis</legend>
              {opcoes.filter((o) => o.disponivel).length === 0 && (
                <p className="text-sm text-texto-secundario">Nenhum serviço disponível para esta rota/peso.</p>
              )}
              {opcoes
                .filter((o) => o.disponivel)
                .map((opcao) => (
                  <label
                    key={opcao.servicoId}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-brand ${
                      servicoId === opcao.servicoId
                        ? 'border-brand bg-brand-bg'
                        : 'border-borda-campo bg-superficie-card hover:bg-superficie-bloco'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="servico"
                        checked={servicoId === opcao.servicoId}
                        onChange={() => setServicoId(opcao.servicoId)}
                      />
                      <span>
                        <span className="block font-semibold text-texto-principal">
                          {opcao.carrierNome} — {opcao.servicoNome}
                        </span>
                        <span className="block text-texto-secundario">Prazo: {opcao.prazoDias} dias úteis</span>
                      </span>
                    </span>
                    <span className="font-bold text-texto-principal">{formatarReais(opcao.precoFinalCentavos)}</span>
                  </label>
                ))}
            </fieldset>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!quoteId || !servicoId}
              onClick={() => setEtapa('remetente')}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'remetente' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <SeletorEndereco tipo="REMETENTE" titulo="Remetente" selecionado={remetente} onSelecionar={setRemetente} />
          <div className="flex justify-between">
            <button type="button" onClick={() => setEtapa('cotacao')} className={classeBotaoSecundario}>
              Voltar
            </button>
            <button
              type="button"
              disabled={!remetente}
              onClick={() => setEtapa('destinatario')}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'destinatario' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <SeletorEndereco
            tipo="DESTINATARIO"
            titulo="Destinatário"
            selecionado={destinatario}
            onSelecionar={setDestinatario}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setEtapa('remetente')} className={classeBotaoSecundario}>
              Voltar
            </button>
            <button
              type="button"
              disabled={!destinatario}
              onClick={() => setEtapa('produtos')}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'produtos' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold text-texto-principal">
              Declaração de conteúdo
            </legend>
            {produtos.map((produto, indice) => (
              <div key={indice} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`produto-nome-${indice}`} className="text-xs font-medium text-texto-secundario">
                    Produto
                  </label>
                  <input
                    id={`produto-nome-${indice}`}
                    className={classeCampo}
                    value={produto.nome}
                    onChange={(e) =>
                      setProdutos((atual) =>
                        atual.map((p, i) => (i === indice ? { ...p, nome: e.target.value } : p)),
                      )
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`produto-qtd-${indice}`} className="text-xs font-medium text-texto-secundario">
                    Quantidade
                  </label>
                  <input
                    id={`produto-qtd-${indice}`}
                    type="number"
                    min={1}
                    className={classeCampo}
                    value={produto.quantidade}
                    onChange={(e) =>
                      setProdutos((atual) =>
                        atual.map((p, i) => (i === indice ? { ...p, quantidade: e.target.value } : p)),
                      )
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`produto-valor-${indice}`} className="text-xs font-medium text-texto-secundario">
                    Valor unitário (R$)
                  </label>
                  <input
                    id={`produto-valor-${indice}`}
                    className={classeCampo}
                    value={produto.valorUnitarioReais}
                    onChange={(e) =>
                      setProdutos((atual) =>
                        atual.map((p, i) => (i === indice ? { ...p, valorUnitarioReais: e.target.value } : p)),
                      )
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setProdutos((atual) => atual.filter((_, i) => i !== indice))}
                  disabled={produtos.length <= 1}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-erro hover:bg-erro-fundo disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Remover produto ${indice + 1}`}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setProdutos((atual) => [...atual, novaLinhaProduto()])}
              className={`${classeBotaoSecundario} self-start`}
            >
              Adicionar produto
            </button>
          </fieldset>

          <div className="flex justify-between">
            <button type="button" onClick={() => setEtapa('destinatario')} className={classeBotaoSecundario}>
              Voltar
            </button>
            <button
              type="button"
              disabled={produtosParaEnvio().length === 0}
              onClick={irParaRevisao}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'revisao' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <h2 className="text-lg font-bold text-texto-principal">Revisão</h2>

          {carregandoRevisao && <p className="text-sm text-texto-secundario">Calculando valores…</p>}

          {previa && (
            <div className="flex flex-col gap-2 rounded-lg bg-superficie-bloco p-4 text-sm">
              <p>
                <span className="font-semibold text-texto-principal">Serviço:</span> {previa.carrierNome} —{' '}
                {previa.servicoNome} ({previa.prazoDias} dias úteis)
              </p>
              <p>
                <span className="font-semibold text-texto-principal">Remetente:</span> {remetente?.nome},{' '}
                {remetente?.cidade}/{remetente?.uf}
              </p>
              <p>
                <span className="font-semibold text-texto-principal">Destinatário:</span> {destinatario?.nome},{' '}
                {destinatario?.cidade}/{destinatario?.uf}
              </p>
              <p>
                <span className="font-semibold text-texto-principal">Valor a debitar:</span>{' '}
                {formatarReais(previa.precoCobradoCentavos)}
              </p>
              {saldoCentavos !== null && (
                <p>
                  <span className="font-semibold text-texto-principal">Saldo após pagar:</span>{' '}
                  {formatarReais(Math.max(0, saldoCentavos - previa.precoCobradoCentavos))}
                  {saldoCentavos < previa.precoCobradoCentavos && (
                    <span className="ml-2 text-erro">(saldo atual insuficiente)</span>
                  )}
                </p>
              )}
            </div>
          )}

          {erroRevisao && (
            <p role="alert" className="text-sm text-erro">
              {erroRevisao}
            </p>
          )}

          {!shipmentIdPendente ? (
            <div className="flex justify-between">
              <button type="button" onClick={() => setEtapa('produtos')} className={classeBotaoSecundario}>
                Voltar
              </button>
              <button type="button" disabled={confirmando || !previa} onClick={confirmarEnvio} className={classeBotaoPrimario}>
                {confirmando ? 'Confirmando…' : 'Confirmar'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg bg-superficie-bloco p-4">
              <p className="text-sm text-texto-principal">
                Seu envio foi criado, mas ainda não foi pago por falta de saldo. Adicione saldo e tente pagar
                novamente — nada do que você preencheu foi perdido.
              </p>

              {!mostrarRecarga && !qrRecarga && (
                <button type="button" onClick={() => setMostrarRecarga(true)} className={classeBotaoSecundario}>
                  Adicionar saldo
                </button>
              )}

              {mostrarRecarga && !qrRecarga && (
                <form onSubmit={solicitarRecarga} className="flex flex-col gap-2">
                  <label htmlFor="valor-recarga" className="text-xs font-medium text-texto-secundario">
                    Valor a recarregar (R$)
                  </label>
                  <input
                    id="valor-recarga"
                    className={classeCampo}
                    value={valorRecarga}
                    onChange={(e) => setValorRecarga(e.target.value)}
                  />
                  {erroRecarga && (
                    <p role="alert" className="text-sm text-erro">
                      {erroRecarga}
                    </p>
                  )}
                  <button type="submit" disabled={criandoRecarga} className={`${classeBotaoPrimario} self-start`}>
                    {criandoRecarga ? 'Gerando QR…' : 'Gerar QR Pix (simulado)'}
                  </button>
                </form>
              )}

              {qrRecarga && (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="text-texto-secundario">
                    Cobrança simulada gerada. Este ambiente é de teste — a confirmação é feita por um
                    administrador, não pelo próprio cliente.
                  </p>
                  <button type="button" onClick={verificarSaldoAposRecarga} className={classeBotaoSecundario}>
                    Verificar saldo novamente
                  </button>
                </div>
              )}

              <button
                type="button"
                disabled={confirmando}
                onClick={tentarPagarNovamente}
                className={classeBotaoPrimario}
              >
                {confirmando ? 'Tentando pagar…' : 'Tentar pagar novamente'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

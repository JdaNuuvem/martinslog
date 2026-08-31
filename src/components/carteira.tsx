'use client'

import { FormEvent, useEffect, useId, useState } from 'react'

type LancamentoResposta = {
  id: string
  tipo: 'CREDITO' | 'DEBITO'
  valorCentavos: number
  saldoAposCentavos: number
  descricao: string
  criadoEm: string
}

type ExtratoResposta = {
  itens: LancamentoResposta[]
  pagina: number
  tamanhoPagina: number
  total: number
  totalPaginas: number
}

type CarteiraResposta = {
  saldoCentavos: number
  extrato: ExtratoResposta
}

type RecargaResposta = {
  paymentIntentId: string
  qrCode: string
  expiraEm: string
  valorCentavos: number
}

const VALORES_SUGERIDOS_CENTAVOS: readonly number[] = [2000, 5000, 10000]
const VALOR_SUGERIDO_PADRAO = 2000

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const classeCampo =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export function Carteira() {
  const idValor = useId()
  const [carteira, setCarteira] = useState<CarteiraResposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)

  const [modoRecarga, setModoRecarga] = useState(false)
  const [valorSelecionado, setValorSelecionado] = useState<number | null>(VALOR_SUGERIDO_PADRAO)
  const [valorLivre, setValorLivre] = useState('')
  const [criandoRecarga, setCriandoRecarga] = useState(false)
  const [erroRecarga, setErroRecarga] = useState<string | null>(null)
  const [recarga, setRecarga] = useState<RecargaResposta | null>(null)

  async function carregar(paginaAlvo: number) {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch(`/api/carteira?pagina=${paginaAlvo}`)
      if (!resposta.ok) {
        setErro('Não foi possível carregar a carteira agora. Tente novamente.')
        return
      }
      const dados = (await resposta.json()) as CarteiraResposta
      setCarteira(dados)
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar(pagina)
  }, [pagina])

  function valorRecargaCentavos(): number | null {
    if (valorSelecionado !== null) {
      return valorSelecionado
    }
    const normalizado = valorLivre.replace(',', '.').trim()
    const reais = Number(normalizado)
    if (!normalizado || !Number.isFinite(reais) || reais <= 0) {
      return null
    }
    return Math.round(reais * 100)
  }

  async function solicitarRecarga(event: FormEvent) {
    event.preventDefault()
    setErroRecarga(null)

    const valorCentavos = valorRecargaCentavos()
    if (valorCentavos === null) {
      setErroRecarga('Informe um valor válido, maior que zero.')
      return
    }

    setCriandoRecarga(true)
    try {
      const resposta = await fetch('/api/carteira/recarga', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ valorCentavos }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErroRecarga(corpo.mensagem ?? 'Não foi possível criar a recarga agora.')
        return
      }

      const { recarga: criada } = (await resposta.json()) as { recarga: RecargaResposta }
      setRecarga(criada)
    } catch {
      setErroRecarga('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setCriandoRecarga(false)
    }
  }

  function fecharRecarga() {
    setModoRecarga(false)
    setRecarga(null)
    setErroRecarga(null)
    setValorSelecionado(VALOR_SUGERIDO_PADRAO)
    setValorLivre('')
    void carregar(pagina)
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-start gap-4 rounded-xl bg-superficie-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-texto-principal">Carteira</h1>
          <p className="mt-1 text-sm text-texto-secundario">Saldo disponível para gerar etiquetas</p>
          <p className="mt-2 text-3xl font-extrabold text-texto-principal">
            {carregando && !carteira ? '—' : formatarReais(carteira?.saldoCentavos ?? 0)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModoRecarga(true)}
          className="rounded-pilula bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Adicionar saldo
        </button>
      </section>

      {erro && (
        <div className="rounded-lg bg-erro-fundo p-4 text-sm text-erro" role="alert">
          {erro}
        </div>
      )}

      {modoRecarga && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6" aria-labelledby="titulo-recarga">
          <div className="flex items-center justify-between">
            <h2 id="titulo-recarga" className="text-lg font-bold text-texto-principal">
              Adicionar saldo
            </h2>
            <button
              type="button"
              onClick={fecharRecarga}
              className="text-sm font-semibold text-texto-secundario hover:text-texto-principal"
            >
              Fechar
            </button>
          </div>

          <div className="rounded-lg bg-info-bg p-3 text-sm text-info-text" role="status">
            Ambiente de teste: nenhum dinheiro real é movimentado. Este QR é <strong>simulado</strong> e não
            pode ser pago de verdade.
          </div>

          {!recarga ? (
            <form onSubmit={solicitarRecarga} className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold text-texto-principal">Valor</legend>
                <div className="flex flex-wrap gap-2">
                  {VALORES_SUGERIDOS_CENTAVOS.map((valor) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => {
                        setValorSelecionado(valor)
                        setValorLivre('')
                      }}
                      aria-pressed={valorSelecionado === valor}
                      className={`rounded-pilula border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                        valorSelecionado === valor
                          ? 'border-brand bg-brand-bg text-brand-texto'
                          : 'border-borda-campo bg-superficie-card text-texto-principal hover:bg-superficie-bloco'
                      }`}
                    >
                      {formatarReais(valor)}
                    </button>
                  ))}
                </div>

                <label htmlFor={idValor} className="mt-2 text-sm text-texto-secundario">
                  Ou outro valor (R$)
                </label>
                <input
                  id={idValor}
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  className={classeCampo}
                  value={valorLivre}
                  onChange={(event) => {
                    setValorLivre(event.target.value)
                    setValorSelecionado(null)
                  }}
                />
              </fieldset>

              {erroRecarga && (
                <p className="text-sm text-erro" role="alert">
                  {erroRecarga}
                </p>
              )}

              <button
                type="submit"
                disabled={criandoRecarga}
                className="self-start rounded-pilula bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                {criandoRecarga ? 'Gerando QR...' : 'Gerar QR Pix (simulado)'}
              </button>
            </form>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-superficie-bloco p-6 text-center">
              <p className="text-sm font-semibold text-texto-principal">
                Cobrança simulada de {formatarReais(recarga.valorCentavos)}
              </p>
              <div
                aria-label="QR Pix simulado"
                className="flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-brand bg-superficie-card p-3 text-center text-xs font-mono text-texto-secundario"
              >
                QR SIMULADO — NÃO PAGÁVEL
              </div>
              <p className="max-w-xs text-xs text-texto-secundario">
                Código: <span className="font-mono">{recarga.qrCode}</span>
              </p>
              <p className="text-xs text-texto-secundario">
                Este ambiente é de teste. A confirmação desta recarga é feita por um administrador — o
                cliente não confirma o próprio pagamento.
              </p>
              <button
                type="button"
                onClick={fecharRecarga}
                className="rounded-pilula border border-brand px-4 py-2 text-sm font-semibold text-brand-texto hover:bg-brand-bg"
              >
                Concluir
              </button>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Extrato</h2>

        {carteira && carteira.extrato.itens.length === 0 && (
          <p className="text-sm text-texto-secundario">Nenhum lançamento ainda.</p>
        )}

        {carteira && carteira.extrato.itens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-superficie-bloco text-texto-secundario">
                  <th className="py-2 pr-4 font-semibold">Data</th>
                  <th className="py-2 pr-4 font-semibold">Descrição</th>
                  <th className="py-2 pr-4 font-semibold">Valor</th>
                  <th className="py-2 pr-4 font-semibold">Saldo após</th>
                </tr>
              </thead>
              <tbody>
                {carteira.extrato.itens.map((item) => (
                  <tr key={item.id} className="border-b border-superficie-bloco last:border-0">
                    <td className="py-2 pr-4 text-texto-secundario">{formatarData(item.criadoEm)}</td>
                    <td className="py-2 pr-4 text-texto-principal">{item.descricao}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${
                        item.tipo === 'CREDITO' ? 'text-brand-texto' : 'text-erro'
                      }`}
                    >
                      {item.tipo === 'CREDITO' ? '+ ' : '− '}
                      {formatarReais(item.valorCentavos)}
                    </td>
                    <td className="py-2 pr-4 text-texto-principal">{formatarReais(item.saldoAposCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {carteira && carteira.extrato.totalPaginas > 1 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setPagina((atual) => Math.max(1, atual - 1))}
              disabled={pagina <= 1}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-texto hover:bg-brand-bg disabled:cursor-not-allowed disabled:text-texto-secundario disabled:hover:bg-transparent"
            >
              Anterior
            </button>
            <span className="text-sm text-texto-secundario">
              Página {carteira.extrato.pagina} de {carteira.extrato.totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina((atual) => Math.min(carteira.extrato.totalPaginas, atual + 1))}
              disabled={pagina >= carteira.extrato.totalPaginas}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-texto hover:bg-brand-bg disabled:cursor-not-allowed disabled:text-texto-secundario disabled:hover:bg-transparent"
            >
              Próxima
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

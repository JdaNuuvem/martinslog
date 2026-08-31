'use client'

import { FormEvent, useId, useState } from 'react'
import { classeBotaoPrimario, classeCampo, formatarReais } from './wizard-ui'

export type OpcaoCotacaoResposta = {
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

type Props = {
  quoteId: string | null
  servicoId: string | null
  onQuoteId: (quoteId: string) => void
  onServicoId: (servicoId: string) => void
  onContinuar: () => void
}

/**
 * Etapa 1: cotar a rota e escolher o serviço. `quoteId`/`servicoId` vivem no
 * componente pai (`NovoEnvioWizard`) porque as etapas seguintes precisam
 * deles; o formulário de cotação e a lista de opções em si são só desta
 * etapa.
 */
export function CotacaoStep({ quoteId, servicoId, onQuoteId, onServicoId, onContinuar }: Props) {
  const idBase = useId()
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
      onQuoteId(dados.quoteId)
      setOpcoes(dados.opcoes)
    } catch {
      setErroCotacao('Não foi possível conectar ao servidor.')
    } finally {
      setCotando(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6" aria-labelledby={`${idBase}-titulo`}>
      <h1 id={`${idBase}-titulo`} className="text-lg font-bold text-texto-principal">
        Escolha a cotação
      </h1>
      <form onSubmit={submeterCotacao} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-origem`} className="text-xs font-medium text-texto-secundario">
              CEP de origem
            </label>
            <input
              id={`${idBase}-origem`}
              className={classeCampo}
              value={formCotacao.cepOrigem}
              onChange={(e) => setFormCotacao((f) => ({ ...f, cepOrigem: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-destino`} className="text-xs font-medium text-texto-secundario">
              CEP de destino
            </label>
            <input
              id={`${idBase}-destino`}
              className={classeCampo}
              value={formCotacao.cepDestino}
              onChange={(e) => setFormCotacao((f) => ({ ...f, cepDestino: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-peso`} className="text-xs font-medium text-texto-secundario">
            Peso (g)
          </label>
          <input
            id={`${idBase}-peso`}
            type="number"
            min={1}
            className={classeCampo}
            value={formCotacao.pesoG}
            onChange={(e) => setFormCotacao((f) => ({ ...f, pesoG: e.target.value }))}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-formato`} className="text-xs font-medium text-texto-secundario">
            Formato
          </label>
          <select
            id={`${idBase}-formato`}
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
          <label htmlFor={`${idBase}-altura`} className="text-xs font-medium text-texto-secundario">
            Altura (cm)
          </label>
          <input
            id={`${idBase}-altura`}
            type="number"
            min={1}
            className={classeCampo}
            value={formCotacao.alturaCm}
            onChange={(e) => setFormCotacao((f) => ({ ...f, alturaCm: e.target.value }))}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-largura`} className="text-xs font-medium text-texto-secundario">
            Largura (cm)
          </label>
          <input
            id={`${idBase}-largura`}
            type="number"
            min={1}
            className={classeCampo}
            value={formCotacao.larguraCm}
            onChange={(e) => setFormCotacao((f) => ({ ...f, larguraCm: e.target.value }))}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-comprimento`} className="text-xs font-medium text-texto-secundario">
            Comprimento (cm)
          </label>
          <input
            id={`${idBase}-comprimento`}
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
                    onChange={() => onServicoId(opcao.servicoId)}
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
        <button type="button" disabled={!quoteId || !servicoId} onClick={onContinuar} className={classeBotaoPrimario}>
          Continuar
        </button>
      </div>
    </section>
  )
}

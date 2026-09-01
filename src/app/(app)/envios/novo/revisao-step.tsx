'use client'

import { FormEvent, useEffect, useState } from 'react'
import type { EnderecoResposta } from '@/lib/endereco-schema'
import { enderecoParaEnvio } from './endereco-seletor'
import type { ProdutoLinha } from './produtos-step'
import { produtosParaEnvio } from './produtos-step'
import { classeBotaoPrimario, classeBotaoSecundario, classeCampo, formatarReais } from './wizard-ui'

type PreviaResposta = {
  servicoNome: string
  carrierNome: string
  precoBalcaoCentavos: number
  precoFreteCentavos: number
  precoCobradoCentavos: number
  descontoCentavos: number
  prazoDias: number
}

type Props = {
  quoteId: string
  servicoId: string
  remetente: EnderecoResposta
  destinatario: EnderecoResposta
  produtos: ProdutoLinha[]
  onVoltar: () => void
  onConcluido: (shipmentId: string) => void
}

/**
 * Etapa 5: revisão do preço (vindo só do servidor, nunca calculado aqui) e
 * confirmação. Se o pagamento falhar por saldo insuficiente, oferece
 * recarga inline — sem navegar para `/carteira` e sem perder nada do que
 * já foi preenchido nas etapas anteriores, porque o estado do wizard
 * inteiro continua montado por trás.
 */
export function RevisaoStep({
  quoteId,
  servicoId,
  remetente,
  destinatario,
  produtos,
  onVoltar,
  onConcluido,
}: Props) {
  const [previa, setPrevia] = useState<PreviaResposta | null>(null)
  const [saldoCentavos, setSaldoCentavos] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [shipmentIdPendente, setShipmentIdPendente] = useState<string | null>(null)

  // Recarga inline
  const [mostrarRecarga, setMostrarRecarga] = useState(false)
  const [valorRecarga, setValorRecarga] = useState('')
  const [criandoRecarga, setCriandoRecarga] = useState(false)
  const [erroRecarga, setErroRecarga] = useState<string | null>(null)
  const [qrRecarga, setQrRecarga] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setCarregando(true)
      setErro(null)
      try {
        const [respostaPrevia, respostaCarteira] = await Promise.all([
          fetch(`/api/envios?quoteId=${encodeURIComponent(quoteId)}&servicoId=${encodeURIComponent(servicoId)}`),
          fetch('/api/carteira'),
        ])

        if (!respostaPrevia.ok) {
          const erroCorpo = (await respostaPrevia.json().catch(() => ({}))) as { mensagem?: string }
          if (!cancelado) setErro(erroCorpo.mensagem ?? 'Não foi possível calcular o preço do envio.')
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
        if (!cancelado) setErro('Não foi possível conectar ao servidor.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    void carregar()
    return () => {
      cancelado = true
    }
  }, [quoteId, servicoId])

  async function confirmarEnvio() {
    setConfirmando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          servicoId,
          remetente: enderecoParaEnvio(remetente),
          destinatario: enderecoParaEnvio(destinatario),
          produtos: produtosParaEnvio(produtos),
        }),
      })
      const corpo: unknown = await resposta.json()

      if (resposta.status === 201) {
        const dados = corpo as { id: string }
        onConcluido(dados.id)
        return
      }

      if (resposta.status === 402) {
        const dados = corpo as { shipmentId: string; mensagem?: string }
        setShipmentIdPendente(dados.shipmentId)
        setErro(dados.mensagem ?? 'Saldo insuficiente para pagar este envio.')
        return
      }

      const erroCorpo = corpo as { mensagem?: string }
      setErro(erroCorpo.mensagem ?? 'Não foi possível criar o envio agora.')
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setConfirmando(false)
    }
  }

  async function tentarPagarNovamente() {
    if (!shipmentIdPendente) return
    setConfirmando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/envios', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipmentId: shipmentIdPendente }),
      })
      if (resposta.status === 204) {
        onConcluido(shipmentIdPendente)
        return
      }
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
      setErro(corpo.mensagem ?? 'Ainda não foi possível pagar este envio.')
    } catch {
      setErro('Não foi possível conectar ao servidor.')
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
        const erroCorpo = corpo as { mensagem?: string }
        setErroRecarga(erroCorpo.mensagem ?? 'Não foi possível criar a recarga agora.')
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

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <h2 className="text-subtitulo font-semibold text-texto-principal">Revisão</h2>

      {carregando && <p className="text-sm text-texto-secundario">Calculando valores…</p>}

      {previa && (
        <div className="flex flex-col gap-2 rounded-lg bg-superficie-bloco p-4 text-sm">
          <p>
            <span className="font-semibold text-texto-principal">Serviço:</span> {previa.carrierNome} —{' '}
            {previa.servicoNome} ({previa.prazoDias} dias úteis)
          </p>
          <p>
            <span className="font-semibold text-texto-principal">Remetente:</span> {remetente.nome},{' '}
            {remetente.cidade}/{remetente.uf}
          </p>
          <p>
            <span className="font-semibold text-texto-principal">Destinatário:</span> {destinatario.nome},{' '}
            {destinatario.cidade}/{destinatario.uf}
          </p>
          <p>
            <span className="font-semibold text-texto-principal">Frete calculado:</span>{' '}
            {formatarReais(previa.precoFreteCentavos)}
          </p>
          {/*
            Duas linhas, e não uma: o frete é o valor do transporte, que vai
            impresso na etiqueta; o débito é o que a plataforma cobra para
            gerá-la. Mostrar só um dos dois deixaria o cliente esperando um
            desconto que não existe, ou uma cobrança que não vai acontecer.
          */}
          <p>
            <span className="font-semibold text-texto-principal">Valor a debitar:</span>{' '}
            {formatarReais(previa.precoCobradoCentavos)}{' '}
            <span className="text-texto-secundario">(preço por etiqueta gerada)</span>
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

      {erro && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {!shipmentIdPendente ? (
        <div className="flex justify-between">
          <button type="button" onClick={onVoltar} className={classeBotaoSecundario}>
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

          <button type="button" disabled={confirmando} onClick={tentarPagarNovamente} className={classeBotaoPrimario}>
            {confirmando ? 'Tentando pagar…' : 'Tentar pagar novamente'}
          </button>
        </div>
      )}
    </section>
  )
}

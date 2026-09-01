'use client'

import { useState, type FormEvent } from 'react'

/**
 * Presets da spec (seção 6). Existem porque o número cru não diz nada a
 * quem opera: "288" só significa algo traduzido para "um dia a cada cinco
 * minutos".
 */
const PRESETS = [
  { valor: 1, rotulo: 'Tempo real', detalhe: '1 dia leva 1 dia' },
  { valor: 24, rotulo: 'Rápido', detalhe: '1 dia leva 1 hora' },
  { valor: 288, rotulo: 'Demonstração', detalhe: '1 dia leva 5 minutos' },
  { valor: 1440, rotulo: 'Instantâneo', detalhe: '1 dia leva 1 minuto' },
]

export function FatorVelocidadeForm({ fatorAtual }: { fatorAtual: number }) {
  const [fator, setFator] = useState(fatorAtual)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState<number | null>(null)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSalvo(null)
    setSalvando(true)

    try {
      const resposta = await fetch('/api/admin/simulacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fatorVelocidade: fator }),
      })
      const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível alterar o fator de velocidade.')
        return
      }

      setSalvo(fator)
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Velocidade da simulação</h2>
        <p className="text-sm text-texto-secundario">
          Vale apenas para envios novos. O fator é copiado para o envio quando a etiqueta é
          emitida, então quem já está em trânsito continua no ritmo em que começou — mudar
          aqui nunca reescreve a linha do tempo de um cliente.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-rotulo uppercase text-texto-secundario">Presets</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.valor}
                type="button"
                onClick={() => setFator(preset.valor)}
                aria-pressed={fator === preset.valor}
                className={`rounded-lg border px-3 py-2 text-left text-dado focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  fator === preset.valor
                    ? 'border-brand bg-brand text-white'
                    : 'border-borda-campo text-texto-principal'
                }`}
              >
                <span className="block font-medium">{preset.rotulo}</span>
                <span className="block text-xs opacity-80">{preset.detalhe}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Fator (1 a 10.000)</span>
          <input
            type="number"
            min={1}
            max={10_000}
            step={1}
            value={fator}
            onChange={(evento) => setFator(Number(evento.target.value))}
            className="w-40 rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        {erro ? (
          <p role="alert" className="text-sm text-erro">
            {erro}
          </p>
        ) : null}

        {salvo !== null ? (
          <p role="status" className="text-sm text-texto-principal">
            Fator salvo: {salvo}. Envios emitidos a partir de agora usam esta velocidade.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={salvando}
          className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {salvando ? 'Salvando…' : 'Salvar velocidade'}
        </button>
      </form>
    </section>
  )
}

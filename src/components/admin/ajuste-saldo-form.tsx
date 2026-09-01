'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Converte "12,34" / "12.34" / "1.234,56" em centavos inteiros.
 *
 * Devolve `null` no que não for um valor válido em vez de arredondar
 * silenciosamente: aqui o dígito perdido é dinheiro de alguém.
 */
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) {
    return null
  }
  return Math.round(Number(limpo) * 100)
}

/**
 * Crédito e débito manual na carteira do cliente.
 *
 * O motivo é obrigatório na tela porque é obrigatório no servidor — e porque
 * o texto vai parar no extrato que o próprio cliente lê. O débito não pode
 * deixar a carteira negativa; a tela avisa antes de enviar, e o servidor
 * recusa de qualquer forma.
 */
export function AjusteSaldoForm({
  userId,
  saldoCentavos,
}: {
  userId: string
  saldoCentavos: number
}) {
  const router = useRouter()
  const [tipo, setTipo] = useState<'CREDITO' | 'DEBITO'>('CREDITO')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSucesso(null)

    const valorCentavos = paraCentavos(valor)
    if (valorCentavos === null || valorCentavos <= 0) {
      setErro('Informe um valor válido, como 150,00.')
      return
    }
    if (tipo === 'DEBITO' && valorCentavos > saldoCentavos) {
      setErro(`Débito maior que o saldo atual (${reais(saldoCentavos)}).`)
      return
    }

    setEnviando(true)
    try {
      const resposta = await fetch(`/api/admin/usuarios/${userId}/saldo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo, valorCentavos, motivo }),
      })
      const dados = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        saldoAtualCentavos?: number
      }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível ajustar o saldo.')
        return
      }

      setSucesso(
        `Saldo ajustado. Novo saldo: ${reais(dados.saldoAtualCentavos ?? saldoCentavos)}.`,
      )
      setValor('')
      setMotivo('')
      // Recarrega os dados do servidor para que saldo e extrato acima do
      // formulário reflitam o lançamento recém-criado.
      router.refresh()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Ajustar saldo</h2>
        <p className="text-sm text-texto-secundario">
          O ajuste vira um lançamento no extrato do cliente, com o motivo digitado. Não existe
          edição direta de saldo — para desfazer, lance o ajuste inverso.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-rotulo uppercase text-texto-secundario">Operação</legend>
          <div className="flex gap-2">
            {(
              [
                { valor: 'CREDITO', rotulo: 'Adicionar saldo' },
                { valor: 'DEBITO', rotulo: 'Retirar saldo' },
              ] as const
            ).map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                onClick={() => setTipo(opcao.valor)}
                aria-pressed={tipo === opcao.valor}
                className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  tipo === opcao.valor
                    ? 'border-brand bg-brand text-white'
                    : 'border-borda-campo text-texto-principal'
                }`}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Valor (R$)</span>
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(evento) => setValor(evento.target.value)}
              placeholder="150,00"
              className="w-40 rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
          </label>

          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Motivo (aparece no extrato do cliente)</span>
            <input
              type="text"
              value={motivo}
              maxLength={200}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Estorno do envio cancelado #123"
              className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
          </label>
        </div>

        {erro ? (
          <p role="alert" className="text-sm text-erro">
            {erro}
          </p>
        ) : null}
        {sucesso ? (
          <p role="status" className="text-sm text-texto-principal">
            {sucesso}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={enviando}
          className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {enviando ? 'Aplicando…' : tipo === 'CREDITO' ? 'Adicionar saldo' : 'Retirar saldo'}
        </button>
      </form>
    </section>
  )
}

'use client'

import { useRef, useState, type FormEvent } from 'react'

type Resultado = { importadas: number; servicos: string[] }

/**
 * Envio do CSV de tabela de preço. A validação real acontece no servidor —
 * aqui só se evita o envio vazio; a mensagem de erro devolvida traz a linha
 * e a coluna do defeito, que é o que permite corrigir a planilha.
 */
export function ImportarTabelaForm() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setResultado(null)

    const arquivo = inputRef.current?.files?.[0]
    if (!arquivo) {
      setErro('Escolha um arquivo CSV para importar.')
      return
    }

    const corpo = new FormData()
    corpo.set('arquivo', arquivo)

    setEnviando(true)
    try {
      const resposta = await fetch('/api/admin/tabelas', { method: 'POST', body: corpo })
      const dados = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        resultado?: Resultado
      }

      if (!resposta.ok || !dados.resultado) {
        setErro(dados.mensagem ?? 'Não foi possível importar a tabela.')
        return
      }

      setResultado(dados.resultado)
      if (inputRef.current) inputRef.current.value = ''
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Importar tabela de preço</h2>
        <p className="text-sm text-texto-secundario">
          O arquivo substitui as regras dos serviços que aparecerem nele. Uma linha com defeito
          cancela a importação inteira — nada é gravado pela metade.
        </p>
      </div>

      <details className="rounded-lg bg-superficie-bloco p-4 text-sm text-texto-secundario">
        <summary className="cursor-pointer font-medium text-texto-principal">
          Formato esperado
        </summary>
        <p className="mt-2">
          Colunas, separadas por <code>;</code> ou <code>,</code>:
        </p>
        <pre className="mt-2 overflow-x-auto text-xs">
          servico;cep_origem_ini;cep_origem_fim;cep_destino_ini;cep_destino_fim;peso_min_g;peso_max_g;preco_balcao;preco_venda;prazo_dias
        </pre>
        <p className="mt-2">
          Preços em reais, com vírgula ou ponto (<code>14,16</code>). CEPs e pesos em números
          inteiros. Planilha exportada do Excel costuma usar <code>;</code>.
        </p>
      </details>

      <form onSubmit={enviar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="arquivo-tabela" className="text-sm font-medium text-texto-principal">
            Arquivo CSV
          </label>
          <input
            ref={inputRef}
            id="arquivo-tabela"
            name="arquivo"
            type="file"
            accept=".csv,text/csv"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'erro-importacao' : undefined}
            className="rounded-lg border border-borda-campo bg-superficie-bloco px-4 py-2 text-sm text-texto-principal file:mr-4 file:rounded-pilula file:border-0 file:bg-brand file:px-4 file:py-1 file:text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </div>
        <button
          type="submit"
          disabled={enviando}
          className="rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? 'Importando…' : 'Importar'}
        </button>
      </form>

      {erro ? (
        <p id="erro-importacao" role="alert" className="rounded-lg bg-erro-fundo p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {resultado ? (
        <p role="status" className="rounded-lg bg-brand-bg p-4 text-sm text-brand-texto">
          {resultado.importadas}{' '}
          {resultado.importadas === 1 ? 'regra importada' : 'regras importadas'} para{' '}
          {resultado.servicos.join(', ')}.
        </p>
      ) : null}
    </section>
  )
}

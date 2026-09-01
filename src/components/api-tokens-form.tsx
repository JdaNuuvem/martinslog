'use client'

import { useEffect, useState, type FormEvent } from 'react'

type Ambiente = 'SANDBOX' | 'PRODUCAO'

type ApiTokenListado = {
  id: string
  nome: string
  ambiente: Ambiente
  ultimoUsoEm: string | null
  revogadoEm: string | null
  criadoEm: string
}

const BASE_URL = 'https://frete.exemplo.com.br/api/v0'

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

/**
 * Gestão de tokens de API pública (Task 4.1). O valor em claro do token só
 * existe no instante da criação — depois disso o servidor só guarda o hash
 * e não há como reexibi-lo, então avisamos isso na hora e escondemos o
 * bloco assim que a pessoa reconhece ter copiado.
 */
export function ApiTokensForm() {
  const [tokens, setTokens] = useState<ApiTokenListado[]>([])
  const [nome, setNome] = useState('')
  const [ambiente, setAmbiente] = useState<Ambiente>('SANDBOX')
  const [tokenNovo, setTokenNovo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function carregar() {
    try {
      const resposta = await fetch('/api/integracoes/tokens')
      if (!resposta.ok) return
      setTokens((await resposta.json()).tokens as ApiTokenListado[])
    } catch {
      // Listagem é secundária: falhar aqui não impede criar um token novo.
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setTokenNovo(null)
    setCopiado(false)

    setEnviando(true)
    try {
      const resposta = await fetch('/api/integracoes/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, ambiente }),
      })
      const corpo = await resposta.json().catch(() => ({}))

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível criar o token.')
        return
      }

      setTokenNovo(corpo.token.tokenClaro)
      setNome('')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function revogar(id: string) {
    try {
      const resposta = await fetch(`/api/integracoes/tokens/${id}`, { method: 'DELETE' })
      if (resposta.ok || resposta.status === 404) {
        await carregar()
      }
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    }
  }

  async function copiar() {
    if (!tokenNovo) return
    try {
      await navigator.clipboard.writeText(tokenNovo)
      setCopiado(true)
    } catch {
      // Área de transferência indisponível (ex.: contexto não seguro) — a
      // pessoa ainda pode selecionar e copiar o texto manualmente.
    }
  }

  return (
    <div className="flex flex-col gap-bloco">
      <section className="flex flex-col gap-bloco rounded-cartao bg-superficie-card p-6 shadow-elevado">
        <div>
          <h2 className="text-subtitulo font-semibold text-texto-principal">Tokens de API</h2>
          <p className="text-corpo text-texto-secundario">
            Autentique chamadas à API pública com um token por conta. Sandbox e produção têm
            tokens e dados separados — nada feito em sandbox debita a sua carteira real.
          </p>
        </div>

        <form onSubmit={criar} className="flex flex-col gap-bloco sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="nome-token" className="text-dado font-medium text-texto-principal">
              Nome
            </label>
            <input
              id="nome-token"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Integração loja principal"
              required
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'erro-token' : undefined}
              className="rounded-campo border border-borda-campo bg-superficie-bloco px-4 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="ambiente-token" className="text-dado font-medium text-texto-principal">
              Ambiente
            </label>
            <select
              id="ambiente-token"
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value as Ambiente)}
              className="rounded-campo border border-borda-campo bg-superficie-bloco px-4 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <option value="SANDBOX">Sandbox (teste)</option>
              <option value="PRODUCAO">Produção</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={enviando || nome.trim().length === 0}
            className="rounded-pilula bg-brand px-6 py-2 text-dado font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Criando…' : 'Criar token'}
          </button>
        </form>

        {erro ? (
          <p id="erro-token" role="alert" className="rounded-campo bg-erro-fundo p-4 text-dado text-erro">
            {erro}
          </p>
        ) : null}

        {tokenNovo ? (
          <div role="status" className="flex flex-col gap-2 rounded-campo bg-brand-bg p-4">
            <p className="text-dado font-bold text-brand-texto">
              Copie este token agora — ele não será mostrado de novo.
            </p>
            <code className="block overflow-x-auto rounded bg-superficie-card p-3 font-mono text-dado text-texto-principal">
              {tokenNovo}
            </code>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={copiar}
                className="self-start rounded-pilula bg-superficie-card px-4 py-1.5 text-dado font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Copiar token
              </button>
              {copiado ? <span className="text-dado text-brand-texto">Copiado.</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-bloco rounded-cartao bg-superficie-card p-6 shadow-elevado">
        <h2 className="text-subtitulo font-semibold text-texto-principal">Tokens criados</h2>

        {tokens.length === 0 ? (
          <p className="text-corpo text-texto-secundario">Nenhum token criado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex flex-col gap-2 rounded-campo bg-superficie-bloco p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-corpo font-medium text-texto-principal">{token.nome}</p>
                  <p className="text-dado text-texto-secundario">
                    <span className="uppercase text-rotulo">{token.ambiente}</span>
                    {' · '}
                    Criado em {formatarData(token.criadoEm)}
                    {' · '}
                    Último uso: {formatarData(token.ultimoUsoEm)}
                  </p>
                </div>

                {token.revogadoEm ? (
                  <span className="inline-block self-start rounded-pilula bg-superficie-card px-2 py-0.5 text-rotulo uppercase text-texto-secundario">
                    Revogado
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void revogar(token.id)}
                    className="self-start rounded-pilula bg-superficie-card px-4 py-1.5 text-dado font-medium text-erro focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-erro"
                  >
                    Revogar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-cartao bg-superficie-card p-6 shadow-elevado">
        <h2 className="text-subtitulo font-semibold text-texto-principal">Como usar a API</h2>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Endereço base: <code className="text-dado">{BASE_URL}</code>. Envie o token no
          cabeçalho <code className="text-dado">Authorization</code>, como <code className="text-dado">Bearer</code>.
          Um token de sandbox nunca move a sua carteira real — use-o para testar a integração
          antes de trocar para um token de produção.
        </p>
        <pre className="overflow-x-auto rounded-campo bg-superficie-bloco p-4 text-dado text-texto-principal">
{`curl -X POST ${BASE_URL}/calculator \\
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cepOrigem": "01310-100",
    "cepDestino": "20040-020",
    "formato": "CAIXA",
    "pesoRealG": 1000,
    "alturaCm": 10,
    "larguraCm": 10,
    "comprimentoCm": 10
  }'`}
        </pre>
      </section>
    </div>
  )
}

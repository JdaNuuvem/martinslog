'use client'

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'

type Config = {
  phoneNumberId: string
  wabaId: string | null
  dicaToken: string
  numeroExibicao: string | null
  ativo: boolean
  verificadaEm: string | null
  ultimoErro: string | null
}

type Recusa = { regra: string; motivo: string }

type Texto = {
  evento: string
  rotulo: string
  descricao: string
  nome: string
  idioma: string
  categoria: 'UTILITY' | 'MARKETING'
  corpo: string
  variaveis: string[]
  exemplos: string[]
  previa: string
  recusas: Recusa[]
}

type Resposta = {
  perfil: { id: string; nome: string }
  config: Config | null
  textos: Texto[]
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const BOTAO =
  'rounded-lg bg-brand px-4 py-2 font-medium text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/**
 * Conexão do WhatsApp da loja com a Cloud API da Meta.
 *
 * A tela tem duas metades porque o processo tem duas metades, e elas acontecem
 * em lugares diferentes: os textos são cadastrados e aprovados NA META, e só
 * depois a credencial vale aqui. Quem chega achando que basta colar um token
 * descobre isso quando a primeira mensagem falha — por isso os textos prontos
 * ficam visíveis antes da conexão, não depois.
 *
 * O token nunca volta do servidor. A tela confirma qual está conectado pela
 * dica, que basta para o dono reconhecer o dele.
 */
export function ConexaoWhatsapp() {
  const idBase = useId()
  const [dados, setDados] = useState<Resposta | null>(null)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [token, setToken] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/whatsapp')
      const corpo = (await resposta.json()) as Resposta & { mensagem?: string }
      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível carregar o WhatsApp.')
        return
      }
      setDados(corpo)
      if (corpo.config) {
        setPhoneNumberId(corpo.config.phoneNumberId)
        setWabaId(corpo.config.wabaId ?? '')
      }
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function conectar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setAviso(null)
    setSalvando(true)

    try {
      const resposta = await fetch('/api/whatsapp', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          perfilId: dados?.perfil.id,
          phoneNumberId,
          wabaId,
          token: token || undefined,
        }),
      })
      const corpo = (await resposta.json()) as { config?: Config; mensagem?: string }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível conectar.')
        return
      }

      setToken('')
      setAviso('WhatsApp conectado. A Meta confirmou as credenciais.')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setSalvando(false)
    }
  }

  async function desconectar() {
    setErro(null)
    setAviso(null)
    try {
      await fetch('/api/whatsapp', { method: 'DELETE' })
      setPhoneNumberId('')
      setWabaId('')
      setAviso('WhatsApp desconectado. Nenhuma mensagem sai por ele.')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    }
  }

  async function copiar(chave: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(chave)
      setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 2000)
    } catch {
      setErro('O navegador não permitiu copiar. Selecione o texto e copie à mão.')
    }
  }

  if (carregando) {
    return <p className="text-corpo text-texto-secundario">Carregando…</p>
  }

  const config = dados?.config ?? null
  const conectado = Boolean(config?.ativo && config?.verificadaEm)

  return (
    <div className="flex flex-col gap-secao">
      {erro && (
        <p className="rounded-lg border border-erro/40 bg-erro/10 px-4 py-3 text-corpo text-erro">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="rounded-lg border border-sucesso/40 bg-sucesso/10 px-4 py-3 text-corpo text-sucesso">
          {aviso}
        </p>
      )}

      {/* ----- Passo 1: os textos, que vivem na Meta ----- */}
      <section className="rounded-xl border border-borda bg-superficie p-6">
        <h2 className="text-subtitulo font-bold text-texto-principal">
          Passo 1 — Cadastre os textos na Meta
        </h2>
        <p className="mt-2 max-w-leitura text-corpo text-texto-secundario">
          No WhatsApp oficial o texto não fica aqui: ele é cadastrado e aprovado na Meta antes de
          poder ser usado. O que enviamos em cada mensagem são só os valores das variáveis.
        </p>
        <p className="mt-2 max-w-leitura text-corpo text-texto-secundario">
          A Meta não conhece nome de variável — ela numera. Os textos abaixo já estão numerados na
          ordem certa, a mesma que usamos ao enviar. Copie e cole no formulário deles.
        </p>

        <div className="mt-5 flex flex-col gap-4">
          {dados?.textos.map((t) => (
            <details
              key={t.evento}
              className="group rounded-lg border border-borda bg-superficie-bloco p-4"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span className="font-medium text-texto-principal">{t.rotulo}</span>
                <span
                  className={`rounded px-2 py-0.5 text-dado ${
                    t.categoria === 'MARKETING'
                      ? 'bg-atencao/15 text-atencao'
                      : 'bg-brand/10 text-brand-texto'
                  }`}
                >
                  {t.categoria}
                </span>
                <code className="text-dado text-texto-secundario">{t.nome}</code>
                <span className="ml-auto text-dado text-texto-secundario group-open:hidden">
                  ver
                </span>
              </summary>

              <p className="mt-3 text-corpo text-texto-secundario">{t.descricao}</p>

              <p className="mt-3 text-dado font-medium text-texto-secundario">
                Corpo para colar na Meta
              </p>
              <pre className="mt-1 overflow-x-auto rounded border border-borda bg-superficie p-3 text-dado text-texto-principal">
                {t.corpo}
              </pre>

              <p className="mt-3 text-dado font-medium text-texto-secundario">
                Exemplos (a Meta pede um por variável)
              </p>
              <ol className="mt-1 list-decimal pl-6 text-dado text-texto-secundario">
                {t.exemplos.map((exemplo, i) => (
                  <li key={t.variaveis[i]}>
                    <code>{t.variaveis[i]}</code> — {exemplo}
                  </li>
                ))}
              </ol>

              <p className="mt-3 text-dado font-medium text-texto-secundario">
                Como o comprador vê
              </p>
              <p className="mt-1 rounded border border-borda bg-superficie p-3 text-corpo text-texto-principal">
                {t.previa}
              </p>

              {t.recusas.length > 0 && (
                <ul className="mt-3 text-dado text-erro">
                  {t.recusas.map((r) => (
                    <li key={r.regra}>A Meta recusaria: {r.motivo}</li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copiar(`nome-${t.evento}`, t.nome)}
                  className="rounded-lg border border-borda px-3 py-1.5 text-dado text-texto-principal transition hover:bg-superficie focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {copiado === `nome-${t.evento}` ? 'Copiado' : 'Copiar nome'}
                </button>
                <button
                  type="button"
                  onClick={() => void copiar(`corpo-${t.evento}`, t.corpo)}
                  className="rounded-lg border border-borda px-3 py-1.5 text-dado text-texto-principal transition hover:bg-superficie focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {copiado === `corpo-${t.evento}` ? 'Copiado' : 'Copiar corpo'}
                </button>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ----- Passo 2: a credencial, que vive aqui ----- */}
      <section className="rounded-xl border border-borda bg-superficie p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-subtitulo font-bold text-texto-principal">
            Passo 2 — Conecte o número
          </h2>
          <span
            className={`rounded px-2 py-0.5 text-dado ${
              conectado ? 'bg-sucesso/15 text-sucesso' : 'bg-superficie-bloco text-texto-secundario'
            }`}
          >
            {conectado ? 'Conectado' : 'Não conectado'}
          </span>
        </div>

        {config?.ultimoErro && (
          <p className="mt-3 rounded-lg border border-erro/40 bg-erro/10 px-4 py-3 text-corpo text-erro">
            A Meta recusou o último envio: {config.ultimoErro}
          </p>
        )}

        {conectado && config && (
          <dl className="mt-4 grid gap-2 text-corpo sm:grid-cols-2">
            <div>
              <dt className="text-dado text-texto-secundario">Número</dt>
              <dd className="text-texto-principal">{config.numeroExibicao ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-dado text-texto-secundario">Token</dt>
              <dd className="text-texto-principal">{config.dicaToken}</dd>
            </div>
          </dl>
        )}

        {/*
        O navegador preenchia o ID do número com o e-mail salvo e o token com a
        senha da conta — os rótulos "ID" e "campo de senha" enganam a heurística
        dele. Conectar com isso falharia de um jeito que não explica nada.

        `autoComplete="off"` sozinho não basta em campo de senha: os navegadores
        o ignoram de propósito. `new-password` é o valor que eles respeitam.
      */}
      <form
        onSubmit={conectar}
        autoComplete="off"
        className="mt-5 flex flex-col gap-4"
      >
          <div>
            <label
              htmlFor={`${idBase}-phone`}
              className="mb-1 block text-dado font-medium text-texto-secundario"
            >
              ID do número (phone_number_id)
            </label>
            <input
              id={`${idBase}-phone`}
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="105954253907000"
              className={CAMPO}
              name="ml-phone-number-id"
              autoComplete="off"
              inputMode="numeric"
              required
            />
            <p className="mt-1 text-dado text-texto-secundario">
              A sequência de dígitos que aparece no painel da Meta, ao lado do número.
            </p>
          </div>

          <div>
            <label
              htmlFor={`${idBase}-waba`}
              className="mb-1 block text-dado font-medium text-texto-secundario"
            >
              ID da conta do WhatsApp (WABA) — opcional
            </label>
            <input
              id={`${idBase}-waba`}
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className={CAMPO}
              name="ml-waba-id"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor={`${idBase}-token`}
              className="mb-1 block text-dado font-medium text-texto-secundario"
            >
              Token permanente {conectado && '(deixe vazio para manter o atual)'}
            </label>
            <input
              id={`${idBase}-token`}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={CAMPO}
              name="ml-meta-token"
              autoComplete="new-password"
            />
            <p className="mt-1 text-dado text-texto-secundario">
              Precisa ser o token permanente, não o temporário de 24 horas — este último para de
              funcionar no dia seguinte, no meio das vendas.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={salvando} className={BOTAO}>
              {salvando ? 'Verificando com a Meta…' : conectado ? 'Salvar' : 'Conectar'}
            </button>
            {conectado && (
              <button
                type="button"
                onClick={() => void desconectar()}
                className="rounded-lg border border-borda px-4 py-2 font-medium text-texto-principal transition hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Desconectar
              </button>
            )}
          </div>
          <p className="text-dado text-texto-secundario">
            Antes de gravar, conferimos as credenciais com a Meta. Se elas não servirem, nada é
            salvo — a tela não diz &ldquo;conectado&rdquo; para um token que não funciona.
          </p>
        </form>
      </section>
    </div>
  )
}

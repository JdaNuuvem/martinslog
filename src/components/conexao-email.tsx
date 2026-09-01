'use client'

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'

type Config = { provedor: string; dicaChave: string; remetente: string; ativo: boolean }

type Envio = {
  id: string
  para: string
  assunto: string
  status: string
  erro: string | null
  criadoEm: string
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Conexão da conta Resend do cliente.
 *
 * A chave entra uma vez e nunca volta — nem para quem a digitou. A tela
 * confirma qual chave está conectada pela dica (prefixo e quatro últimos
 * caracteres), que é o suficiente para o dono reconhecer a dele sem que a
 * chave trafegue de novo.
 */
export function ConexaoEmail() {
  const idBase = useId()
  const [config, setConfig] = useState<Config | null>(null)
  const [envios, setEnvios] = useState<Envio[]>([])
  const [apiKey, setApiKey] = useState('')
  const [remetente, setRemetente] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/email-config')
      if (!resposta.ok) {
        setErro('Não foi possível carregar a conexão de e-mail.')
        return
      }
      const corpo = (await resposta.json()) as { config: Config | null; envios: Envio[] }
      setConfig(corpo.config)
      setEnvios(corpo.envios)
      if (corpo.config) setRemetente(corpo.config.remetente)
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
      const resposta = await fetch('/api/email-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey, remetente }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível conectar.')
        return
      }

      // Limpa o campo assim que a chave é aceita: ela não precisa continuar
      // na tela, e deixá-la lá convida a print e a compartilhamento.
      setApiKey('')
      setAviso('Resend conectado. As atualizações de status passam a ser enviadas por e-mail.')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function desconectar() {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/email-config', { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 204) {
      setErro('Não foi possível desconectar.')
      return
    }
    setConfig(null)
    setRemetente('')
    setAviso('Resend desconectado e chave apagada.')
    await carregar()
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">E-mail de atualizações (Resend)</h2>
        <p className="text-sm text-texto-secundario">
          Conecte a sua conta do Resend para avisar o destinatário a cada mudança de status. Os
          e-mails saem do seu domínio, com a sua chave.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-3 text-sm text-erro">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="rounded-lg bg-brand-bg p-3 text-sm text-brand-texto">
          {aviso}
        </p>
      ) : null}

      {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}

      {!carregando && config ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borda-campo bg-superficie-bloco p-4">
          <div>
            <p className="text-sm font-medium text-texto-principal">
              Conectado · <span className="font-mono">{config.dicaChave}</span>
            </p>
            <p className="text-sm text-texto-secundario">Remetente: {config.remetente}</p>
          </div>
          <button
            type="button"
            onClick={desconectar}
            className="text-sm font-medium text-erro hover:underline"
          >
            Desconectar
          </button>
        </div>
      ) : null}

      {!carregando ? (
        <form onSubmit={conectar} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-chave`} className="text-sm font-medium text-texto-secundario">
              {config ? 'Trocar a chave de API' : 'Chave de API do Resend'}
            </label>
            <input
              id={`${idBase}-chave`}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="re_..."
              className={CAMPO}
            />
            <p className="text-xs text-texto-secundario">
              Crie em resend.com/api-keys. A chave é guardada cifrada e nunca é exibida de volta.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${idBase}-remetente`}
              className="text-sm font-medium text-texto-secundario"
            >
              Remetente
            </label>
            <input
              id={`${idBase}-remetente`}
              value={remetente}
              onChange={(e) => setRemetente(e.target.value)}
              placeholder="Minha Loja &lt;pedidos@minhaloja.com.br&gt;"
              className={CAMPO}
            />
            <p className="text-xs text-texto-secundario">
              Precisa ser de um domínio verificado no Resend, senão o envio é recusado por lá.
            </p>
          </div>

          <button
            type="submit"
            disabled={salvando || !apiKey.trim() || !remetente.trim()}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Conectando…' : config ? 'Salvar' : 'Conectar'}
          </button>
        </form>
      ) : null}

      {envios.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-borda-campo pt-4">
          <h3 className="text-sm font-bold text-texto-principal">Últimos envios</h3>
          <ul className="flex flex-col gap-2">
            {envios.map((envio) => (
              <li
                key={envio.id}
                className="flex flex-col gap-0.5 rounded-lg border border-borda-campo p-3"
              >
                <p className="text-sm text-texto-principal">
                  {envio.assunto}
                  <span
                    className={`ml-2 rounded-pilula px-2 py-0.5 text-xs font-medium ${
                      envio.status === 'ENVIADO'
                        ? 'bg-brand-bg text-brand-texto'
                        : 'bg-superficie-bloco text-erro'
                    }`}
                  >
                    {envio.status}
                  </span>
                </p>
                <p className="text-xs text-texto-secundario">{envio.para}</p>
                {envio.erro ? <p className="text-xs text-erro">{envio.erro}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

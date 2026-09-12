'use client'

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'

type Config = {
  provedor: string
  identificador: string | null
  dicaChave: string
  remetente: string | null
  ativo: boolean
  verificadaEm: string | null
  ultimoErro: string | null
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Conexão da conta de SMS da loja.
 *
 * Mesmo contrato do Resend: a chave entra uma vez e nunca volta — a tela
 * confirma qual está conectada pela dica. Aqui o cuidado é maior, porque SMS
 * é cobrado por mensagem: uma chave vazada é conta alheia gastando o dinheiro
 * do lojista, e não só mandando e-mail em nome dele.
 */
export function ConexaoSms() {
  const idBase = useId()
  const [config, setConfig] = useState<Config | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(null)
  const [provedorAtivo, setProvedorAtivo] = useState<string | null>(null)
  const [chave, setChave] = useState('')
  const [identificador, setIdentificador] = useState('')
  const [remetente, setRemetente] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/sms')
      const corpo = (await resposta.json().catch(() => ({}))) as {
        perfil?: { id: string }
        config?: Config | null
        provedorAtivo?: string
        mensagem?: string
      }

      if (!resposta.ok) {
        // 409 é a conta sem loja: não é falha, é passo anterior que falta.
        setErro(corpo.mensagem ?? 'Não foi possível carregar a conexão de SMS.')
        return
      }

      setPerfilId(corpo.perfil?.id ?? null)
      setConfig(corpo.config ?? null)
      setProvedorAtivo(corpo.provedorAtivo ?? null)
      if (corpo.config) {
        setIdentificador(corpo.config.identificador ?? '')
        setRemetente(corpo.config.remetente ?? '')
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
    if (!perfilId) return
    setErro(null)
    setAviso(null)
    setSalvando(true)

    try {
      const resposta = await fetch('/api/sms', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ perfilId, chave, identificador, remetente }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível conectar.')
        return
      }

      // Limpa a chave assim que ela é aceita: não precisa continuar na tela,
      // e deixá-la ali convida a print e a compartilhamento.
      setChave('')
      setAviso('SMS conectado. Pedidos novos passam a avisar o comprador por mensagem.')
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
    const resposta = await fetch('/api/sms', { method: 'DELETE' })
    if (!resposta.ok) {
      setErro('Não foi possível desconectar.')
      return
    }
    setConfig(null)
    setChave('')
    setAviso('SMS desconectado e chave apagada.')
    await carregar()
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">SMS de atualizações</h2>
        <p className="text-sm text-texto-secundario">
          Conecte a sua conta do{' '}
          {provedorAtivo && provedorAtivo !== 'registrado' ? provedorAtivo : 'provedor de SMS'} para
          avisar o comprador a cada mudança de status. As mensagens saem com a sua chave e são
          cobradas na sua conta do provedor.
        </p>
      </div>

      {/*
        Sem provedor ativo no servidor, a fila roda inteira e a mensagem morre
        na última milha — marcada como enviada, sem ter saído. Dizer isso aqui
        é o que evita o lojista descobrir na primeira venda que não avisou
        ninguém.
      */}
      {!carregando && provedorAtivo === 'registrado' ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-3 text-sm text-erro">
          Nenhum provedor de SMS está ativo neste servidor. A chave pode ser guardada, mas as
          mensagens não sairão até que <span className="font-mono">SMS_PROVEDOR</span> seja
          configurada.
        </p>
      ) : null}

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
              Conectado a {config.provedor} · <span className="font-mono">{config.dicaChave}</span>
            </p>
            {config.remetente ? (
              <p className="text-sm text-texto-secundario">Remetente: {config.remetente}</p>
            ) : null}
            {config.ultimoErro ? (
              <p className="text-sm text-erro">Último erro: {config.ultimoErro}</p>
            ) : null}
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

      {!carregando && perfilId ? (
        // `method="post"`: sem ele um submit nativo levaria a chave do provedor
        // para a URL. Ver o comentário em `(auth)/login/page.tsx`.
        <form method="post" onSubmit={conectar} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-chave`} className="text-sm font-medium text-texto-secundario">
              {config ? 'Trocar a chave de API' : 'Chave de API'}
            </label>
            <input
              id={`${idBase}-chave`}
              type="password"
              autoComplete="off"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              className={CAMPO}
            />
            <p className="text-xs text-texto-secundario">
              Guardada cifrada e nunca exibida de volta. Ao editar, deixe em branco para manter a
              chave atual.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${idBase}-identificador`}
              className="text-sm font-medium text-texto-secundario"
            >
              Conta no provedor <span className="font-normal">(opcional)</span>
            </label>
            <input
              id={`${idBase}-identificador`}
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              className={CAMPO}
            />
            <p className="text-xs text-texto-secundario">
              Só para provedores que pedem uma conta além da chave.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${idBase}-remetente`}
              className="text-sm font-medium text-texto-secundario"
            >
              Remetente <span className="font-normal">(opcional)</span>
            </label>
            <input
              id={`${idBase}-remetente`}
              value={remetente}
              onChange={(e) => setRemetente(e.target.value)}
              placeholder="MinhaLoja"
              className={CAMPO}
            />
            <p className="text-xs text-texto-secundario">
              Nome ou número que aparece para quem recebe, quando o provedor permitir.
            </p>
          </div>

          <button
            type="submit"
            disabled={salvando || (!config && !chave.trim())}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Conectando…' : config ? 'Salvar' : 'Conectar'}
          </button>
        </form>
      ) : null}
    </section>
  )
}

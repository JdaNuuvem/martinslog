'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

type Resumo = {
  id: string
  contato: string
  nomeContato: string | null
  ultimaMensagemEm: string
  naoLidas: number
  roboPausado: boolean
  previa: string | null
}

type Mensagem = {
  id: string
  autor: 'CLIENTE' | 'ROBO' | 'ATENDENTE'
  texto: string
  erro: string | null
  ocorridoEm: string
}

type Aberta = {
  id: string
  contato: string
  nomeContato: string | null
  roboPausadoAte: string | null
  mensagens: Mensagem[]
}

/**
 * De quanto em quanto a tela busca mensagem nova.
 *
 * Consulta periódica, e não tempo real: o volume é de dezenas de conversas
 * por dia, não de milhares por minuto. Um WebSocket aqui custaria uma conexão
 * aberta por atendente para ganhar poucos segundos.
 */
const INTERVALO_ATUALIZACAO_MS = 10_000

function telefoneLegivel(digitos: string): string {
  const semPais = digitos.startsWith('55') ? digitos.slice(2) : digitos
  if (semPais.length < 10) return digitos
  const ddd = semPais.slice(0, 2)
  const resto = semPais.slice(2)
  const meio = resto.length > 8 ? resto.slice(0, 5) : resto.slice(0, 4)
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`
}

function horario(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ROTULO_AUTOR: Record<Mensagem['autor'], string> = {
  CLIENTE: 'Cliente',
  ROBO: 'Robô',
  ATENDENTE: 'Você',
}

export function ConversasWhatsapp() {
  const [conversas, setConversas] = useState<Resumo[]>([])
  const [aberta, setAberta] = useState<Aberta | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const fimDaListaRef = useRef<HTMLDivElement | null>(null)

  const carregarLista = useCallback(async () => {
    const resposta = await fetch('/api/evolution/conversas')
    if (!resposta.ok) {
      setErro('Não foi possível carregar as conversas.')
      setCarregando(false)
      return
    }
    const corpo = (await resposta.json()) as { conversas: Resumo[] }
    setConversas(corpo.conversas)
    setCarregando(false)
  }, [])

  const abrir = useCallback(async (id: string) => {
    const resposta = await fetch(`/api/evolution/conversas/${id}`)
    if (!resposta.ok) {
      setErro('Não foi possível abrir a conversa.')
      return
    }
    const corpo = (await resposta.json()) as { conversa: Aberta }
    setAberta(corpo.conversa)
  }, [])

  useEffect(() => {
    void carregarLista()
  }, [carregarLista])

  /*
    Atualiza lista e conversa aberta enquanto a tela está em pé. Sem isto, a
    resposta do comprador só apareceria se o atendente recarregasse a página —
    e ele não tem motivo para desconfiar que chegou algo.
  */
  useEffect(() => {
    const timer = setInterval(() => {
      void carregarLista()
      if (aberta) void abrir(aberta.id)
    }, INTERVALO_ATUALIZACAO_MS)
    return () => clearInterval(timer)
  }, [carregarLista, abrir, aberta])

  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ block: 'end' })
  }, [aberta?.mensagens.length])

  async function responder(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!aberta || !texto.trim()) return
    setErro(null)
    setEnviando(true)

    try {
      const resposta = await fetch(`/api/evolution/conversas/${aberta.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível enviar.')
        // A mensagem fica gravada com o erro do lado do servidor, então
        // recarregar mostra ao atendente o que não saiu.
        await abrir(aberta.id)
        return
      }
      setTexto('')
      await abrir(aberta.id)
      await carregarLista()
    } finally {
      setEnviando(false)
    }
  }

  async function alternarRobo(acao: 'assumir' | 'devolver-ao-robo') {
    if (!aberta) return
    await fetch(`/api/evolution/conversas/${aberta.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao }),
    })
    await abrir(aberta.id)
    await carregarLista()
  }

  const roboPausado = Boolean(
    aberta?.roboPausadoAte && new Date(aberta.roboPausadoAte).getTime() > Date.now(),
  )

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="flex max-h-[70vh] w-full flex-col gap-2 overflow-y-auto rounded-xl bg-superficie-card p-4 lg:w-80">
        <h2 className="text-sm font-bold text-texto-principal">Conversas</h2>

        {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}

        {!carregando && conversas.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Nenhuma conversa ainda. Elas aparecem quando um comprador escreve para o número da loja.
          </p>
        ) : null}

        {conversas.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void abrir(c.id)}
            className={`flex flex-col gap-1 rounded-lg p-3 text-left ${
              aberta?.id === c.id ? 'bg-brand-bg' : 'bg-superficie-bloco'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-texto-principal">
                {c.nomeContato ?? telefoneLegivel(c.contato)}
              </span>
              {c.naoLidas > 0 ? (
                <span className="rounded-pilula bg-brand px-2 text-xs font-medium text-white">
                  {c.naoLidas}
                </span>
              ) : null}
            </span>
            <span className="line-clamp-1 text-xs text-texto-secundario">{c.previa ?? '—'}</span>
            <span className="text-xs text-texto-secundario">
              {horario(c.ultimaMensagemEm)}
              {c.roboPausado ? ' · robô pausado' : ''}
            </span>
          </button>
        ))}
      </aside>

      <section className="flex min-h-[70vh] flex-1 flex-col rounded-xl bg-superficie-card p-4">
        {!aberta ? (
          <p className="m-auto text-sm text-texto-secundario">
            Escolha uma conversa para ver o histórico.
          </p>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-campo pb-3">
              <div>
                <p className="font-medium text-texto-principal">
                  {aberta.nomeContato ?? telefoneLegivel(aberta.contato)}
                </p>
                <p className="text-xs text-texto-secundario">{telefoneLegivel(aberta.contato)}</p>
              </div>
              {/*
                Assumir pausa o robô; devolver o solta antes do prazo. Os dois
                importam: sem o primeiro, robô e humano respondem juntos; sem
                o segundo, uma conversa atendida uma vez ficaria manual para
                sempre.
              */}
              <button
                type="button"
                onClick={() => void alternarRobo(roboPausado ? 'devolver-ao-robo' : 'assumir')}
                className="rounded-pilula border border-borda-campo px-4 py-1.5 text-sm font-medium text-texto-secundario"
              >
                {roboPausado ? 'Devolver ao robô' : 'Assumir do robô'}
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-4">
              {aberta.mensagens.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-lg p-3 ${
                    m.autor === 'CLIENTE'
                      ? 'self-start bg-superficie-bloco'
                      : 'self-end bg-brand-bg'
                  }`}
                >
                  <p className="text-xs font-medium text-texto-secundario">
                    {ROTULO_AUTOR[m.autor]} · {horario(m.ocorridoEm)}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-texto-principal">{m.texto}</p>
                  {m.erro ? <p className="text-xs text-erro">Não entregue: {m.erro}</p> : null}
                </div>
              ))}
              <div ref={fimDaListaRef} />
            </div>

            {erro ? (
              <p role="alert" className="rounded-lg bg-superficie-bloco p-2 text-sm text-erro">
                {erro}
              </p>
            ) : null}

            <form method="post" onSubmit={responder} className="flex gap-2 pt-3">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Escreva uma resposta…"
                aria-label="Resposta"
                className="flex-1 rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
              <button
                type="submit"
                disabled={enviando || !texto.trim()}
                className="rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

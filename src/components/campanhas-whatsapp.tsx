'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Campanha = {
  id: string
  nome: string
  texto: string
  status: string
  agendadaPara: string | null
  total: number
  enviadas: number
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  AGENDADA: 'Agendada',
  ENVIANDO: 'Enviando',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
}

/**
 * Campanhas: a mesma mensagem para muitos compradores.
 *
 * A tela avisa do risco antes do formulário, e não depois, porque é o único
 * recurso desta área capaz de custar o número da loja. As travas de volume
 * ficam no servidor — aqui só se explica por que a campanha demora.
 */
export function CampanhasWhatsapp() {
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [nome, setNome] = useState('')
  const [texto, setTexto] = useState('')
  const [numeros, setNumeros] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const resposta = await fetch('/api/mensagens/campanhas')
    if (!resposta.ok) return
    const corpo = (await resposta.json()) as { campanhas: Campanha[] }
    setCampanhas(corpo.campanhas)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const quantidadeColada = numeros.split('\n').filter((l) => l.trim()).length

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setAviso(null)
    setEnviando(true)

    try {
      const destinatarios = numeros
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((linha) => {
          // "5511999999999, Maria" ou só o número.
          const [contato = '', ...resto] = linha.split(',')
          return { contato: contato.trim(), nome: resto.join(',').trim() || null }
        })

      const resposta = await fetch('/api/mensagens/campanhas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, texto, destinatarios, agendadaPara: new Date().toISOString() }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível criar a campanha.')
        return
      }

      const corpo = (await resposta.json()) as { validos: number; descartados: number }
      setAviso(
        `Campanha criada para ${corpo.validos} número${corpo.validos === 1 ? '' : 's'}` +
          (corpo.descartados > 0
            ? `. ${corpo.descartados} descartado${corpo.descartados === 1 ? '' : 's'} por estar repetido ou inválido.`
            : '.'),
      )
      setNome('')
      setTexto('')
      setNumeros('')
      await carregar()
    } finally {
      setEnviando(false)
    }
  }

  async function cancelar(id: string) {
    await fetch(`/api/mensagens/campanhas?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setAviso('Campanha cancelada. O que já saiu não volta.')
    await carregar()
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Campanhas</h2>
        <p className="text-sm text-texto-secundario">
          A mesma mensagem para vários compradores, pelo número da loja.
        </p>
      </div>

      {/*
        O aviso vem antes do formulário de propósito. É o recurso que mais
        pode custar caro, e a razão da lentidão precisa estar clara: quem não
        entende por que demora tenta burlar.
      */}
      <p className="rounded-lg border border-borda-campo bg-superficie-bloco p-3 text-sm text-texto-secundario">
        <span className="font-medium text-texto-principal">Isto pode custar o número.</span> Disparo
        em massa por WhatsApp não oficial é o padrão que a Meta usa para bloquear, e bloqueio não
        tem recurso. Por isso o envio é lento de propósito: sai aos poucos, com intervalo, e no
        máximo 60 por hora. Uma lista de 500 leva o dia. Mande só para quem comprou e espera notícia
        sua.
      </p>

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

      {campanhas.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {campanhas.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-superficie-bloco p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-texto-principal">
                  {c.nome}{' '}
                  <span className="font-normal text-texto-secundario">
                    · {ROTULO_STATUS[c.status] ?? c.status}
                  </span>
                </p>
                <p className="text-xs text-texto-secundario">
                  {c.enviadas} de {c.total} enviada{c.total === 1 ? '' : 's'}
                </p>
              </div>
              {c.status === 'AGENDADA' || c.status === 'ENVIANDO' ? (
                <button
                  type="button"
                  onClick={() => void cancelar(c.id)}
                  className="text-sm font-medium text-erro hover:underline"
                >
                  Cancelar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form method="post" onSubmit={criar} className="flex flex-col gap-3 border-t border-borda-campo pt-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="camp-nome" className="text-sm text-texto-secundario">
            Nome da campanha
          </label>
          <input
            id="camp-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Aviso de feriado"
            className={CAMPO}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="camp-texto" className="text-sm text-texto-secundario">
            Mensagem
          </label>
          <textarea
            id="camp-texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="{{loja}}: olá {{cliente}}, ..."
            className={CAMPO}
          />
          <p className="text-xs text-texto-secundario">
            <span className="font-mono">{'{{loja}}'}</span> e{' '}
            <span className="font-mono">{'{{cliente}}'}</span> são preenchidos no envio.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="camp-numeros" className="text-sm text-texto-secundario">
            Destinatários — um por linha
          </label>
          <textarea
            id="camp-numeros"
            value={numeros}
            onChange={(e) => setNumeros(e.target.value)}
            rows={5}
            placeholder={'5511999999999, Maria\n5521988887777'}
            className={CAMPO}
          />
          <p className="text-xs text-texto-secundario">
            {quantidadeColada > 0
              ? `${quantidadeColada} linha${quantidadeColada === 1 ? '' : 's'} — números repetidos ou inválidos são descartados ao criar.`
              : 'Número e, opcionalmente, o nome depois de uma vírgula.'}
          </p>
        </div>

        <button
          type="submit"
          disabled={enviando || !nome.trim() || !texto.trim() || quantidadeColada === 0}
          className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? 'Criando…' : 'Criar e começar a enviar'}
        </button>
      </form>
    </section>
  )
}

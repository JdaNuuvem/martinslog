'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { dentroDoSilencio } from '@/domain/mensagem/silencio'

type Silencio = {
  silencioAtivo: boolean
  silencioInicioHora: number
  silencioFimHora: number
}

type Bloqueado = {
  id: string
  contato: string
  origem: string
  motivo: string | null
  criadoEm: string
}

function telefoneLegivel(digitos: string): string {
  const semPais = digitos.startsWith('55') ? digitos.slice(2) : digitos
  if (semPais.length < 10) return digitos
  const ddd = semPais.slice(0, 2)
  const resto = semPais.slice(2)
  const meio = resto.length > 8 ? resto.slice(0, 5) : resto.slice(0, 4)
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`
}

/**
 * As duas travas que protegem o canal: a hora e o consentimento.
 *
 * Ficam juntas porque respondem à mesma pergunta — "isto vai incomodar?" — e
 * é o incômodo que vira denúncia. No WhatsApp não oficial, denúncia derruba o
 * número e leva junto o canal de todas as lojas daquele celular.
 */
export function ProtecaoMensagens() {
  const [silencio, setSilencio] = useState<Silencio | null>(null)
  const [bloqueados, setBloqueados] = useState<Bloqueado[]>([])
  const [horaAgora, setHoraAgora] = useState<number | null>(null)
  const [novoNumero, setNovoNumero] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const resposta = await fetch('/api/mensagens/protecao')
    if (!resposta.ok) return
    const corpo = (await resposta.json()) as {
      silencio: Silencio | null
      bloqueados: Bloqueado[]
      horaAgora: number
    }
    setSilencio(corpo.silencio)
    setBloqueados(corpo.bloqueados)
    setHoraAgora(corpo.horaAgora)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvarSilencio(novo: Silencio) {
    setSalvando(true)
    setErro(null)
    setAviso(null)
    try {
      const resposta = await fetch('/api/mensagens/protecao', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(novo),
      })
      if (!resposta.ok) {
        setErro('Não foi possível salvar o horário.')
        return
      }
      setSilencio(novo)
      setAviso('Horário salvo.')
    } finally {
      setSalvando(false)
    }
  }

  async function bloquear(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/mensagens/protecao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contato: novoNumero }),
    })
    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
      setErro(corpo.mensagem ?? 'Não foi possível registrar.')
      return
    }
    setNovoNumero('')
    setAviso('Número registrado. Ele não recebe mais mensagens desta loja.')
    await carregar()
  }

  async function reativar(b: Bloqueado) {
    /*
      Confirma antes porque o caso normal NÃO é desfazer: quem pediu para sair
      só volta escrevendo de novo. O botão existe para o engano — alguém
      digitou o número errado ao registrar.
    */
    const certeza = window.confirm(
      b.origem === 'CLIENTE'
        ? `${telefoneLegivel(b.contato)} pediu para não receber mais. Reativar contra a vontade dele pode gerar denúncia. Tem certeza?`
        : `Reativar ${telefoneLegivel(b.contato)}?`,
    )
    if (!certeza) return

    await fetch(`/api/mensagens/protecao?id=${encodeURIComponent(b.id)}`, { method: 'DELETE' })
    await carregar()
  }

  const emSilencioAgora =
    silencio?.silencioAtivo &&
    horaAgora !== null &&
    dentroDoSilencio(horaAgora, silencio.silencioInicioHora, silencio.silencioFimHora)

  return (
    <section className="flex flex-col gap-5 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Quando falar, e com quem</h2>
        <p className="text-sm text-texto-secundario">
          Mensagem de madrugada e mensagem para quem pediu para parar são as duas que viram
          denúncia — e denúncia tira o número do ar.
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

      {silencio ? (
        <div className="flex flex-col gap-3 rounded-lg border border-borda-campo bg-superficie-bloco p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-texto-principal">
            <input
              type="checkbox"
              checked={silencio.silencioAtivo}
              onChange={(e) => void salvarSilencio({ ...silencio, silencioAtivo: e.target.checked })}
              disabled={salvando}
            />
            Não mandar mensagem de madrugada
          </label>

          {silencio.silencioAtivo ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="silencio-inicio" className="text-xs text-texto-secundario">
                  Das
                </label>
                <select
                  id="silencio-inicio"
                  value={silencio.silencioInicioHora}
                  onChange={(e) =>
                    void salvarSilencio({ ...silencio, silencioInicioHora: Number(e.target.value) })
                  }
                  className="rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-texto-principal"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="silencio-fim" className="text-xs text-texto-secundario">
                  Até
                </label>
                <select
                  id="silencio-fim"
                  value={silencio.silencioFimHora}
                  onChange={(e) =>
                    void salvarSilencio({ ...silencio, silencioFimHora: Number(e.target.value) })
                  }
                  className="rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-texto-principal"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              {horaAgora !== null ? (
                <p className="flex-1 text-xs text-texto-secundario">
                  Agora são {String(horaAgora).padStart(2, '0')}h —{' '}
                  {emSilencioAgora
                    ? 'as mensagens estão esperando a janela abrir.'
                    : 'as mensagens estão saindo normalmente.'}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-texto-secundario">
            Mensagem que cai no silêncio não é perdida: ela espera e sai quando a janela abre.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-borda-campo pt-4">
        <h3 className="text-sm font-bold text-texto-principal">
          Não perturbe
          {bloqueados.length > 0 ? ` · ${bloqueados.length}` : ''}
        </h3>
        <p className="text-xs text-texto-secundario">
          Quem responder “PARE” no WhatsApp entra aqui sozinho. Use o campo abaixo para quem pediu
          por telefone ou e-mail.
        </p>

        <form method="post" onSubmit={bloquear} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="bloquear-numero" className="text-xs text-texto-secundario">
              Número
            </label>
            <input
              id="bloquear-numero"
              value={novoNumero}
              onChange={(e) => setNovoNumero(e.target.value)}
              placeholder="11999998888"
              className="w-52 rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal"
            />
          </div>
          <button
            type="submit"
            disabled={!novoNumero.trim()}
            className="rounded-pilula bg-brand px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Registrar
          </button>
        </form>

        {bloqueados.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {bloqueados.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-superficie-bloco p-2"
              >
                <span className="text-sm text-texto-principal">
                  {telefoneLegivel(b.contato)}{' '}
                  <span className="text-xs text-texto-secundario">
                    · {b.origem === 'CLIENTE' ? 'pediu no WhatsApp' : 'registrado pela loja'} ·{' '}
                    {new Date(b.criadoEm).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void reativar(b)}
                  className="text-xs font-medium text-texto-secundario hover:underline"
                >
                  Reativar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-texto-secundario">Ninguém pediu para sair até agora.</p>
        )}
      </div>
    </section>
  )
}

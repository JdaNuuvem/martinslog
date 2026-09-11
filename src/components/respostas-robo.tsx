'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Resposta = {
  id: string
  nome: string
  gatilhos: string[]
  resposta: string
  ordem: number
  ativo: boolean
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const VAZIO = { id: '', nome: '', gatilhos: '', resposta: '', ordem: 0 }

/**
 * Respostas prontas do robô, por palavra-chave.
 *
 * O robô já sabe responder sobre rastreio — isso é o que a plataforma conhece.
 * O que ele não sabe é o que é da LOJA: se entrega no sábado, qual o prazo
 * para certa região, se troca produto. Sem estas regras, toda pergunta dessas
 * virava "vou chamar alguém", e o atendimento humano recebia as mesmas cinco
 * perguntas todo dia.
 */
export function RespostasRobo() {
  const [respostas, setRespostas] = useState<Resposta[]>([])
  const [form, setForm] = useState(VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const resposta = await fetch('/api/mensagens/respostas')
    if (!resposta.ok) return
    const corpo = (await resposta.json()) as { respostas: Resposta[] }
    setRespostas(corpo.respostas)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSalvando(true)

    try {
      const gatilhos = form.gatilhos
        .split('\n')
        .map((g) => g.trim())
        .filter(Boolean)

      const resposta = await fetch('/api/mensagens/respostas', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome,
          gatilhos,
          resposta: form.resposta,
          ordem: Number(form.ordem) || 0,
        }),
      })

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar.')
        return
      }

      setForm(VAZIO)
      await carregar()
    } finally {
      setSalvando(false)
    }
  }

  async function apagar(id: string) {
    await fetch(`/api/mensagens/respostas?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await carregar()
  }

  function editar(r: Resposta) {
    setForm({
      id: r.id,
      nome: r.nome,
      gatilhos: r.gatilhos.join('\n'),
      resposta: r.resposta,
      ordem: r.ordem,
    })
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Respostas do robô</h2>
        <p className="text-sm text-texto-secundario">
          Quando o comprador escrever uma das palavras, o robô responde sozinho. Rastreio ele já
          sabe responder — aqui ficam as perguntas da sua loja. Use{' '}
          <span className="font-mono text-xs">{'{{loja}}'}</span> para o nome da marca.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-3 text-sm text-erro">
          {erro}
        </p>
      ) : null}

      {respostas.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {respostas.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-superficie-bloco p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-texto-principal">
                  {r.nome}
                  {!r.ativo ? (
                    <span className="ml-2 text-xs font-normal text-texto-secundario">(inativa)</span>
                  ) : null}
                </p>
                <p className="text-xs text-texto-secundario">
                  Gatilhos: {r.gatilhos.join(', ')}
                </p>
                <p className="whitespace-pre-wrap text-sm text-texto-secundario">{r.resposta}</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => editar(r)}
                  className="text-sm font-medium text-brand-texto hover:underline"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void apagar(r.id)}
                  className="text-sm font-medium text-erro hover:underline"
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-texto-secundario">
          Nenhuma resposta ainda. Comece pelas perguntas que mais se repetem no seu atendimento.
        </p>
      )}

      <form method="post" onSubmit={salvar} className="flex flex-col gap-3 border-t border-borda-campo pt-4">
        <p className="text-sm font-medium text-texto-principal">
          {form.id ? 'Editando resposta' : 'Nova resposta'}
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="resp-nome" className="text-sm text-texto-secundario">
            Nome (só para você se achar)
          </label>
          <input
            id="resp-nome"
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Entrega aos sábados"
            className={CAMPO}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="resp-gatilhos" className="text-sm text-texto-secundario">
            Palavras que disparam — uma por linha
          </label>
          <textarea
            id="resp-gatilhos"
            value={form.gatilhos}
            onChange={(e) => setForm((f) => ({ ...f, gatilhos: e.target.value }))}
            rows={3}
            placeholder={'sabado\nfim de semana\nentrega sabado'}
            className={CAMPO}
          />
          <p className="text-xs text-texto-secundario">
            Não precisa se preocupar com acento nem maiúscula: “sábado” e “SABADO” valem igual.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="resp-texto" className="text-sm text-texto-secundario">
            Resposta
          </label>
          <textarea
            id="resp-texto"
            value={form.resposta}
            onChange={(e) => setForm((f) => ({ ...f, resposta: e.target.value }))}
            rows={3}
            className={CAMPO}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="resp-ordem" className="text-sm text-texto-secundario">
            Ordem
          </label>
          <input
            id="resp-ordem"
            type="number"
            min={0}
            value={form.ordem}
            onChange={(e) => setForm((f) => ({ ...f, ordem: Number(e.target.value) }))}
            className="w-28 rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal"
          />
          <p className="text-xs text-texto-secundario">
            A primeira que casar responde. Quando duas regras pegam a mesma frase, a de menor ordem
            ganha.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={salvando || !form.nome.trim() || !form.resposta.trim()}
            className="rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Adicionar'}
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={() => setForm(VAZIO)}
              className="rounded-pilula border border-borda-campo px-6 py-2 text-sm font-medium text-texto-secundario"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}

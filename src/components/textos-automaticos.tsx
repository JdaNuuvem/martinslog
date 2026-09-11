'use client'

import { useCallback, useEffect, useState } from 'react'
import { custoDoTexto } from '@/domain/mensagem/texto'

type Variavel = { nome: string; descricao: string }

type Template = {
  evento: string
  rotulo: string
  texto: string
  ativo: boolean
  personalizado: boolean
}

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Valores de exemplo da prévia.
 *
 * Plausíveis de propósito — "Maria" e "EC000123456BR", não "xxx" nem
 * "exemplo". O que se quer enxergar é o tamanho e o ritmo da frase real, e
 * texto de mentira esconde as duas coisas.
 */
const EXEMPLOS: Record<string, string> = {
  loja: 'Sua Loja',
  cliente: 'Maria',
  pedido: 'PED-10482',
  produtos: 'Tênis branco, Meia kit 3',
  status: 'a caminho',
  codigo_rastreio: 'EC000123456BR',
  link_rastreio: 'app.martinslog.net/r/EC000123456BR',
  valor: 'R$ 189,90',
  prazo: '5',
  servico: 'Econômico',
  cidade: 'Campinas',
  uf: 'SP',
  link_checkout: 'sualoja.com/checkout/abc',
}

function previa(modelo: string): string {
  if (!modelo.trim()) return '—'
  return modelo.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (todo, chave: string) => {
    // Variável que não existe fica visível como está: é assim que a loja
    // descobre o erro de digitação aqui, e não na mensagem do comprador.
    return EXEMPLOS[chave.toLowerCase()] ?? todo
  })
}

/**
 * Os textos que saem sozinhos a cada passo do pedido.
 *
 * Antes disto eles nasciam do código e ficavam iguais para todas as lojas —
 * não havia tela nenhuma. Editar aqui é o que faz cada marca falar como ela
 * fala, que é o motivo de `nomeExibicao` existir.
 */
export function TextosAutomaticos() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [variaveis, setVariaveis] = useState<Variavel[]>([])
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  /** Qual campo recebe a variável clicada. Nulo antes do primeiro foco. */
  const [editando, setEditando] = useState<string | null>(null)
  const [numeroTeste, setNumeroTeste] = useState('')
  const [testando, setTestando] = useState<string | null>(null)

  /**
   * Manda o texto para um número escolhido, com valores de exemplo.
   *
   * Usa o rascunho, e não o que está salvo: o ponto é conferir o que se
   * acabou de escrever antes de gravar.
   */
  async function testar(evento: string) {
    setTestando(evento)
    setErro(null)
    setAviso(null)
    try {
      const resposta = await fetch('/api/mensagens/teste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ para: numeroTeste, texto: rascunhos[evento] ?? '' }),
      })
      const corpo = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        custo?: { partes: number }
      }
      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível enviar o teste.')
        return
      }
      setAviso(
        `Teste enviado para ${numeroTeste}` +
          (corpo.custo && corpo.custo.partes > 1 ? ` (${corpo.custo.partes} SMS).` : '.'),
      )
    } finally {
      setTestando(null)
    }
  }

  /**
   * Insere a variável onde o cursor está, e não no fim do texto.
   *
   * No fim seria mais simples e quase sempre errado: quem está escrevendo
   * "seu pedido chegou em" quer a cidade ali, não depois do ponto final.
   */
  function inserirVariavel(nome: string) {
    if (!editando) return
    const campo = document.getElementById(`texto-${editando}`) as HTMLTextAreaElement | null
    const atual = rascunhos[editando] ?? ''
    const marca = `{{${nome}}}`

    const inicio = campo?.selectionStart ?? atual.length
    const fim = campo?.selectionEnd ?? atual.length
    const novo = atual.slice(0, inicio) + marca + atual.slice(fim)

    setRascunhos((r) => ({ ...r, [editando]: novo }))

    // Devolve o cursor para depois do que foi inserido, para dar para
    // continuar escrevendo sem procurar o lugar de novo.
    requestAnimationFrame(() => {
      campo?.focus()
      campo?.setSelectionRange(inicio + marca.length, inicio + marca.length)
    })
  }

  const carregar = useCallback(async () => {
    const resposta = await fetch('/api/mensagens/templates')
    if (!resposta.ok) {
      setErro('Não foi possível carregar os textos.')
      setCarregando(false)
      return
    }
    const corpo = (await resposta.json()) as { templates: Template[]; variaveis: Variavel[] }
    setTemplates(corpo.templates)
    setVariaveis(corpo.variaveis)
    setRascunhos(Object.fromEntries(corpo.templates.map((t) => [t.evento, t.texto])))
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar(evento: string) {
    setSalvando(evento)
    setErro(null)
    setAviso(null)
    try {
      const resposta = await fetch('/api/mensagens/templates', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evento, texto: rascunhos[evento] ?? '' }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar.')
        return
      }
      setAviso('Texto salvo. Vale a partir da próxima mensagem.')
      await carregar()
    } finally {
      setSalvando(null)
    }
  }

  async function restaurar(evento: string) {
    await fetch(`/api/mensagens/templates?evento=${encodeURIComponent(evento)}`, {
      method: 'DELETE',
    })
    setAviso('Texto voltou ao padrão.')
    await carregar()
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Mensagens de cada etapa</h2>
        <p className="text-sm text-texto-secundario">
          O que o comprador recebe sozinho quando o pedido anda. Clique numa etiqueta abaixo para
          encaixá-la no texto que estiver editando.
        </p>
      </div>

      {/*
        As variáveis ficam visíveis e clicáveis, e não escondidas num texto de
        ajuda. Digitar `{{codigo_rastreio}}` de cabeça erra: basta um
        sublinhado a menos para a mensagem sair com a chave crua no lugar do
        código, e ninguém percebe até o comprador receber.
      */}
      <div className="flex flex-wrap gap-1.5 rounded-lg bg-superficie-bloco p-3">
        {variaveis.map((v) => (
          <button
            key={v.nome}
            type="button"
            title={v.descricao}
            onClick={() => inserirVariavel(v.nome)}
            disabled={!editando}
            className="rounded-pilula border border-borda-campo px-2.5 py-1 font-mono text-xs text-texto-secundario hover:border-brand hover:text-brand-texto disabled:cursor-not-allowed disabled:opacity-50"
          >
            {`{{${v.nome}}}`}
          </button>
        ))}
      </div>
      {!editando ? (
        <p className="text-xs text-texto-secundario">
          Clique num campo de texto abaixo para poder inserir as etiquetas.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-borda-campo p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="numero-teste" className="text-sm font-medium text-texto-principal">
            Testar no meu número
          </label>
          <input
            id="numero-teste"
            value={numeroTeste}
            onChange={(e) => setNumeroTeste(e.target.value)}
            placeholder="11999998888"
            className="w-52 rounded-lg border border-borda-campo bg-superficie-bloco px-3 py-2 text-texto-principal"
          />
        </div>
        <p className="flex-1 text-xs text-texto-secundario">
          O teste sai na hora, com valores de exemplo, e não entra no histórico do cliente. Cobra
          normalmente do seu provedor de SMS.
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

      <div className="flex flex-col gap-4">
        {templates.map((t) => (
          <div key={t.evento} className="flex flex-col gap-2 border-t border-borda-campo pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={`texto-${t.evento}`} className="text-sm font-medium text-texto-principal">
                {t.rotulo}
                {t.personalizado ? (
                  <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-normal text-brand-texto">
                    personalizado
                  </span>
                ) : null}
              </label>
              {t.personalizado ? (
                <button
                  type="button"
                  onClick={() => void restaurar(t.evento)}
                  className="text-xs font-medium text-texto-secundario hover:underline"
                >
                  Voltar ao padrão
                </button>
              ) : null}
            </div>

            <textarea
              id={`texto-${t.evento}`}
              value={rascunhos[t.evento] ?? ''}
              onChange={(e) => setRascunhos((r) => ({ ...r, [t.evento]: e.target.value }))}
              onFocus={() => setEditando(t.evento)}
              rows={3}
              className={CAMPO}
            />

            {/*
              A prévia mostra o texto com as variáveis trocadas por exemplos.
              Sem ela, só dá para saber como a mensagem ficou depois que um
              comprador de verdade a recebeu.
            */}
            <p className="rounded-lg bg-superficie-bloco p-2 text-xs text-texto-secundario">
              <span className="font-medium">Fica assim: </span>
              {previa(rascunhos[t.evento] ?? '')}
            </p>

            {/*
              O custo em SMS aparece ANTES de salvar. `custoDoTexto` existia
              desde sempre com um comentário dizendo que servia para isto, e
              nenhuma tela o chamava: a conta dobrava em silêncio, porque
              ninguém escreve um texto contando caracteres nem desconfia que
              um "ã" derruba o limite pela metade.
            */}
            {(() => {
              const custo = custoDoTexto(previa(rascunhos[t.evento] ?? ''))
              return (
                <p
                  className={`text-xs ${custo.partes > 1 ? 'text-erro' : 'text-texto-secundario'}`}
                >
                  {custo.caracteres} caracteres ·{' '}
                  {custo.partes === 1 ? '1 SMS' : `${custo.partes} SMS (cobra ${custo.partes}x)`}
                  {custo.temAcento ? ' · tem acento, o que reduz o limite pela metade' : ''}
                </p>
              )
            })()}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void salvar(t.evento)}
                disabled={salvando === t.evento || rascunhos[t.evento] === t.texto}
                className="rounded-pilula bg-brand px-5 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando === t.evento ? 'Salvando…' : 'Salvar'}
              </button>

              {/*
                Testar antes de valer. Sem isto, o primeiro a ver um texto novo
                é um comprador de verdade — e um `{{codigo_rastreio}}` com um
                sublinhado a menos só aparece lá, quando não há como voltar.
              */}
              <button
                type="button"
                onClick={() => void testar(t.evento)}
                disabled={testando === t.evento || !numeroTeste.trim()}
                className="rounded-pilula border border-borda-campo px-5 py-1.5 text-sm font-medium text-texto-secundario disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testando === t.evento ? 'Enviando…' : 'Enviar teste'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

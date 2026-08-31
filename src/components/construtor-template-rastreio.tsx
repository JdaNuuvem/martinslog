'use client'

import { useCallback, useEffect, useState } from 'react'
import { CanvasFluxoRastreio } from './canvas-fluxo-rastreio'

type ItemPaleta = {
  codigo: string
  tipo: 'ETAPA' | 'COBRANCA'
  rotulo: string
  descricaoPadrao: string
  statusResultante: string
  diasSugeridos: number
  terminal: boolean
}

type Passo = {
  id?: string
  codigo: string
  titulo: string
  descricao: string
  diasAposEmissao: number
  tipo?: 'ETAPA' | 'COBRANCA'
  x?: number
  y?: number
  valorCentavos?: number
}

type StatusPadrao = { codigo: string; titulo: string; descricao: string }

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'


/**
 * Configuração do percurso do rastreio, como um fluxo.
 *
 * Esta tela é a única superfície de configuração: o texto de cada etapa, a
 * posição no tempo e a existência da etapa se editam no próprio nó do fluxo.
 * Antes havia três mecanismos concorrentes na mesma página — um formulário
 * de status avulso, uma lista de padrões e o construtor —, e era preciso
 * saber qual deles mexia em quê. Um fluxo com nós editáveis diz sozinho o
 * que cada coisa faz.
 *
 * Dois modos:
 * - **Caminho padrão**: os nós vêm da simulação e são só de leitura, exceto
 *   o texto, que a conta pode reescrever.
 * - **Template personalizado**: a conta declara a sequência inteira.
 */
export function ConstrutorTemplateRastreio() {
  const [paleta, setPaleta] = useState<ItemPaleta[]>([])
  const [padraoDoFluxo, setPadraoDoFluxo] = useState<Passo[]>([])
  const [passos, setPassos] = useState<Passo[]>([])
  const [usaTemplate, setUsaTemplate] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [textosPendentes, setTextosPendentes] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const [respTemplate, respCatalogo] = await Promise.all([
        fetch('/api/rastreio-template'),
        fetch('/api/status-rastreio'),
      ])

      if (!respTemplate.ok) {
        setErro('Não foi possível carregar o percurso.')
        return
      }

      const corpo = (await respTemplate.json()) as {
        template: { passos: Passo[]; ativo: boolean } | null
        paleta: ItemPaleta[]
        padrao: Passo[]
      }
      setPaleta(corpo.paleta)
      setPadraoDoFluxo(corpo.padrao)
      setUsaTemplate(Boolean(corpo.template))
      // Templates montados antes da repetição não têm id; atribui na leitura
      // para que dois nós do mesmo tipo não se confundam ao editar.
      const comId = (corpo.template?.passos ?? corpo.padrao).map((passo, indice) => ({
        ...passo,
        id: passo.id ?? `no-legado-${indice}`,
      }))
      setPassos(comId)

      if (respCatalogo.ok) {
        const cat = (await respCatalogo.json()) as {
          padrao: StatusPadrao[]
          personalizados: StatusPadrao[]
        }
        // A personalização da conta cobre o texto padrão, então ela vence na
        // exibição — é o que o destinatário vai ler.
        const porCodigo = new Map(cat.padrao.map((item) => [item.codigo, item]))
        for (const item of cat.personalizados) porCodigo.set(item.codigo, item)

        // Aplica o texto vigente aos nós do caminho padrão: é o que o
        // destinatário lê hoje, e é ele que deve aparecer no canvas.
        setPadraoDoFluxo((atuais) =>
          atuais.map((passo) => {
            const texto = porCodigo.get(passo.codigo)
            return texto ? { ...passo, titulo: texto.titulo, descricao: texto.descricao } : passo
          }),
        )
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

  /** Identidade da instância. O código pode repetir; o id, não. */
  function novoId(): string {
    return `no-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function acrescentar(item: ItemPaleta) {
    setErro(null)
    setPassos((atuais) => [
      ...atuais,
      {
        id: novoId(),
        codigo: item.codigo,
        titulo: item.rotulo,
        descricao: item.descricaoPadrao,
        diasAposEmissao: item.diasSugeridos,
        tipo: item.tipo,
      },
    ])
  }

  function remover(indice: number) {
    setPassos((atuais) => atuais.filter((_, i) => i !== indice))
  }

  function mover(indice: number, direcao: -1 | 1) {
    setPassos((atuais) => {
      const destino = indice + direcao
      if (destino < 0 || destino >= atuais.length) return atuais
      const copia = [...atuais]
      const [movido] = copia.splice(indice, 1)
      copia.splice(destino, 0, movido!)
      return copia
    })
  }

  function moverNoCanvas(indice: number, x: number, y: number) {
    setPassos((atuais) => atuais.map((passo, i) => (i === indice ? { ...passo, x, y } : passo)))
  }

  function editar(indice: number, campo: keyof Passo, valor: string | number) {
    setPassos((atuais) =>
      atuais.map((passo, i) => (i === indice ? { ...passo, [campo]: valor } : passo)),
    )
  }

  async function salvar() {
    setErro(null)
    setAviso(null)
    setSalvando(true)
    try {
      const resposta = await fetch('/api/rastreio-template', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passos }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar o fluxo.')
        return
      }
      setUsaTemplate(true)
      setAviso('Fluxo salvo. Envios novos passam a seguir este percurso.')
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  /** Reescreve o texto de uma etapa do caminho padrão, via catálogo. */
  /**
   * No caminho padrão os nós não são editáveis em estrutura, só em texto — e
   * o texto vai para o catálogo, não para o template. A gravação acontece ao
   * clicar em "Salvar textos", para não disparar uma requisição por tecla.
   */
  function editarTextoPadraoLocal(indice: number, campo: keyof Passo, valor: string | number) {
    setPadraoDoFluxo((atuais) =>
      atuais.map((passo, i) => (i === indice ? { ...passo, [campo]: valor } : passo)),
    )
    setTextosPendentes(true)
  }

  async function salvarTextosPadrao() {
    setErro(null)
    setAviso(null)
    for (const passo of padraoDoFluxo) {
      const resposta = await fetch('/api/status-rastreio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome: passo.codigo,
          titulo: passo.titulo,
          descricao: passo.descricao,
        }),
      })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível salvar os textos.')
        return
      }
    }
    setTextosPendentes(false)
    setAviso('Textos salvos. Envios novos usam estes textos na timeline.')
  }

  async function usarCaminhoPadrao() {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/rastreio-template', { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 204) {
      setErro('Não foi possível voltar ao caminho padrão.')
      return
    }
    setUsaTemplate(false)
    setPassos(padraoDoFluxo)
    setAviso('Voltou ao caminho padrão. Envios novos seguem a simulação por cenário.')
  }

  const nosVisiveis = usaTemplate ? passos : padraoDoFluxo

  return (
    <section
      aria-label="Fluxo do rastreio"
      className="flex flex-col gap-5 rounded-xl bg-superficie-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Fluxo do rastreio</h2>
        <p className="text-sm text-texto-secundario">
          Cada nó é uma etapa que o seu cliente vê na timeline. Clique em um nó para editar o
          texto e quando ele acontece.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Modo do fluxo"
        className="flex flex-wrap gap-2 rounded-lg bg-superficie-bloco p-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!usaTemplate}
          onClick={usarCaminhoPadrao}
          className={`rounded-pilula px-4 py-2 text-sm font-medium ${
            !usaTemplate ? 'bg-brand text-white' : 'text-texto-secundario'
          }`}
        >
          Caminho padrão
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={usaTemplate}
          onClick={() => setUsaTemplate(true)}
          className={`rounded-pilula px-4 py-2 text-sm font-medium ${
            usaTemplate ? 'bg-brand text-white' : 'text-texto-secundario'
          }`}
        >
          Fluxo personalizado
        </button>
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

      {!carregando && !usaTemplate ? (
        <p className="text-sm text-texto-secundario">
          Estes são os nós da simulação padrão. Você pode reescrever o texto de cada um; para
          mudar quais etapas existem e quando acontecem, use o fluxo personalizado.
        </p>
      ) : null}

      {!carregando ? (
        <CanvasFluxoRastreio
          nos={nosVisiveis}
          paleta={paleta}
          editavel={usaTemplate}
          onMover={moverNoCanvas}
          onEditar={usaTemplate ? editar : editarTextoPadraoLocal}
          onRemover={remover}
          onReordenar={mover}
        />
      ) : null}

      {!carregando && !usaTemplate && textosPendentes ? (
        <button
          type="button"
          onClick={salvarTextosPadrao}
          className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white"
        >
          Salvar textos
        </button>
      ) : null}

      {!carregando && usaTemplate ? (
        <>
          <div className="flex flex-col gap-2 border-t border-borda-campo pt-4">
            <h3 className="text-sm font-bold text-texto-principal">Acrescentar nó ao fluxo</h3>
            <div className="flex flex-wrap gap-2">
              {paleta.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  onClick={() => acrescentar(item)}
                  title={item.terminal ? 'Encerra o envio: precisa ser o último nó' : undefined}
                  className="rounded-pilula border border-borda-campo px-3 py-1.5 text-sm text-texto-principal hover:bg-superficie-bloco disabled:opacity-40"
                >
                  {item.rotulo}
                  {item.terminal ? ' ·' : ''}
                </button>
              ))}
            </div>
            <p className="text-xs text-texto-secundario">
              As etapas marcadas com · encerram o envio e só podem ser o último nó.
            </p>
          </div>

          <button
            type="button"
            onClick={salvar}
            disabled={salvando || passos.length === 0}
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar fluxo'}
          </button>
        </>
      ) : null}
    </section>
  )
}

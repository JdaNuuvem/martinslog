'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export type TipoNo = 'ETAPA' | 'COBRANCA'

export type ItemPaleta = {
  codigo: string
  tipo: TipoNo
  rotulo: string
  descricaoPadrao: string
  statusResultante: string
  diasSugeridos: number
  terminal: boolean
}

export type Conexao = { de: string; para: string }

export type No = {
  id?: string
  codigo: string
  titulo: string
  descricao: string
  diasAposEmissao: number
  tipo?: TipoNo
  x?: number
  y?: number
  valorCentavos?: number
}

/** Passo da grade de encaixe. Vale também para o desenho do fundo. */
const GRADE = 20
const ZOOM_MIN = 0.4
const ZOOM_MAX = 1.6

/** Arredonda para o ponto de grade mais próximo. */
function encaixar(valor: number, ligado: boolean): number {
  return ligado ? Math.round(valor / GRADE) * GRADE : Math.round(valor)
}

const LARGURA_NO = 220
const ALTURA_NO = 84
const COLUNA = 300
const LINHA = 150

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/** Arranjo inicial de um nó que nunca foi arrastado. Exportado para que a
 * duplicação saiba onde o original está desenhado: sem isso, duplicar vários
 * nós sem posição própria empilharia todas as cópias no mesmo canto. */
export function posicaoPadrao(indice: number): { x: number; y: number } {
  return { x: 60 + (indice % 4) * COLUNA, y: 60 + Math.floor(indice / 4) * LINHA }
}

function posicaoDoNo(no: No, indice: number): { x: number; y: number } {
  const padrao = posicaoPadrao(indice)
  return { x: no.x ?? padrao.x, y: no.y ?? padrao.y }
}

function chaveDoNo(no: No, indice: number): string {
  return no.id ?? `${no.codigo}-${indice}`
}

type Retangulo = { x1: number; y1: number; x2: number; y2: number }

function seInterceptam(retangulo: Retangulo, x: number, y: number): boolean {
  const esquerda = Math.min(retangulo.x1, retangulo.x2)
  const direita = Math.max(retangulo.x1, retangulo.x2)
  const topo = Math.min(retangulo.y1, retangulo.y2)
  const base = Math.max(retangulo.y1, retangulo.y2)
  return x + LARGURA_NO >= esquerda && x <= direita && y + ALTURA_NO >= topo && y <= base
}

/**
 * Canvas do fluxo de rastreio.
 *
 * Três gestos, e a escolha de qual faz o quê importa: arrastar o fundo
 * **move a vista**, porque é o gesto mais frequente num fluxo maior que a
 * tela; Shift + arrastar **seleciona em massa**; arrastar um nó move o nó, e
 * leva junto todos os outros selecionados.
 *
 * Arrastar muda só onde o nó aparece, nunca quando ele acontece. Quem define
 * o momento de cada etapa é o campo de dias — deixar a posição no desenho
 * mandar no tempo faria o percurso mudar só por reorganizar o canvas.
 */
export function CanvasFluxoRastreio({
  nos,
  paleta,
  editavel,
  onMover,
  onEditar,
  onRemover,
  onRemoverVarios,
  onDuplicar,
  onReordenar,
  conexoes,
  onConectar,
  onDesconectar,
}: {
  nos: No[]
  paleta: ItemPaleta[]
  editavel: boolean
  onMover: (indice: number, x: number, y: number) => void
  onEditar: (indice: number, campo: keyof No, valor: string | number) => void
  onRemover: (indice: number) => void
  onRemoverVarios: (indices: number[]) => void
  onDuplicar: (indices: number[]) => void
  onReordenar: (indice: number, direcao: -1 | 1) => void
  conexoes: Conexao[]
  onConectar: (de: string, para: string) => void
  onDesconectar: (de: string, para: string) => void
}) {
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [arrastandoNo, setArrastandoNo] = useState<number | null>(null)
  const [deslocamento, setDeslocamento] = useState({ x: 0, y: 0 })
  const [marquee, setMarquee] = useState<Retangulo | null>(null)
  const [panning, setPanning] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [encaixeLigado, setEncaixeLigado] = useState(true)
  const [ligando, setLigando] = useState<{
    de: string
    origemX: number
    origemY: number
    x: number
    y: number
  } | null>(null)

  const areaRef = useRef<HTMLDivElement>(null)
  const inicioArrasto = useRef({ x: 0, y: 0 })
  const posicoesIniciais = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panInicial = useRef({ x: 0, y: 0, desloc: { x: 0, y: 0 } })
  const posicoesRef = useRef<{ x: number; y: number }[]>([])

  const posicoes = nos.map((no, indice) => posicaoDoNo(no, indice))
  posicoesRef.current = posicoes

  const principal = selecionados.size === 1 ? [...selecionados][0]! : null
  const noSelecionado = principal !== null ? nos[principal] : undefined
  const itemSelecionado = noSelecionado
    ? paleta.find((item) => item.codigo === noSelecionado.codigo)
    : undefined

  /** Coordenada do ponteiro no espaço do canvas, já descontado o pan. */
  const paraCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const caixa = areaRef.current?.getBoundingClientRect()
      if (!caixa) return { x: 0, y: 0 }
      // Divide pelo zoom: o ponteiro chega em pixels de tela e as posições
      // dos nós vivem no espaço do canvas, antes da escala.
      return {
        x: (clientX - caixa.left - deslocamento.x) / zoom,
        y: (clientY - caixa.top - deslocamento.y) / zoom,
      }
    },
    [deslocamento, zoom],
  )

  // Arrasto de nó: move todos os selecionados juntos, preservando as
  // distâncias entre eles.
  useEffect(() => {
    if (arrastandoNo === null) return

    function aoMover(evento: PointerEvent) {
      const atual = paraCanvas(evento.clientX, evento.clientY)
      const dx = atual.x - inicioArrasto.current.x
      const dy = atual.y - inicioArrasto.current.y

      for (const [indice, inicial] of posicoesIniciais.current) {
        onMover(
          indice,
          Math.max(0, encaixar(inicial.x + dx, encaixeLigado)),
          Math.max(0, encaixar(inicial.y + dy, encaixeLigado)),
        )
      }
    }

    function aoSoltar() {
      setArrastandoNo(null)
      posicoesIniciais.current.clear()
    }

    window.addEventListener('pointermove', aoMover)
    window.addEventListener('pointerup', aoSoltar)
    return () => {
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltar)
    }
  }, [arrastandoNo, onMover, paraCanvas, encaixeLigado])

  // Pan da vista e seleção em massa compartilham o arrasto no fundo; o Shift
  // decide qual dos dois.
  useEffect(() => {
    if (!panning && !marquee) return

    function aoMover(evento: PointerEvent) {
      if (panning) {
        setDeslocamento({
          x: panInicial.current.desloc.x + (evento.clientX - panInicial.current.x),
          y: panInicial.current.desloc.y + (evento.clientY - panInicial.current.y),
        })
        return
      }
      const atual = paraCanvas(evento.clientX, evento.clientY)
      setMarquee((anterior) => (anterior ? { ...anterior, x2: atual.x, y2: atual.y } : anterior))
    }

    function aoSoltar() {
      setMarquee((atual) => {
        if (atual) {
          const dentro = new Set<number>()
          posicoesRef.current.forEach((pos, indice) => {
            if (seInterceptam(atual, pos.x, pos.y)) dentro.add(indice)
          })
          setSelecionados(dentro)
        }
        return null
      })
      setPanning(false)
    }

    window.addEventListener('pointermove', aoMover)
    window.addEventListener('pointerup', aoSoltar)
    return () => {
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltar)
    }
  }, [panning, marquee, paraCanvas])

  // Ligação em curso: acompanha o ponteiro até soltar sobre um nó.
  useEffect(() => {
    if (!ligando) return

    function aoMover(evento: PointerEvent) {
      const atual = paraCanvas(evento.clientX, evento.clientY)
      setLigando((anterior) => (anterior ? { ...anterior, x: atual.x, y: atual.y } : anterior))
    }

    function aoSoltar() {
      setLigando(null)
    }

    window.addEventListener('pointermove', aoMover)
    window.addEventListener('pointerup', aoSoltar)
    return () => {
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltar)
    }
  }, [ligando, paraCanvas])

  function aoApertarNoFundo(evento: ReactPointerEvent) {
    if (evento.target !== evento.currentTarget) return

    if (evento.shiftKey) {
      const inicio = paraCanvas(evento.clientX, evento.clientY)
      setMarquee({ x1: inicio.x, y1: inicio.y, x2: inicio.x, y2: inicio.y })
      return
    }

    setSelecionados(new Set())
    panInicial.current = { x: evento.clientX, y: evento.clientY, desloc: deslocamento }
    setPanning(true)
  }

  function aoApertarNoNo(evento: ReactPointerEvent, indice: number) {
    evento.stopPropagation()

    const jaSelecionado = selecionados.has(indice)
    // Arrastar um nó que já faz parte da seleção move o grupo inteiro; clicar
    // num nó de fora troca a seleção por ele.
    const proxima = new Set(evento.shiftKey || jaSelecionado ? selecionados : [])
    if (evento.shiftKey && jaSelecionado) proxima.delete(indice)
    else proxima.add(indice)
    setSelecionados(proxima)

    if (!editavel) return

    inicioArrasto.current = paraCanvas(evento.clientX, evento.clientY)
    posicoesIniciais.current = new Map(
      [...proxima].map((i) => [i, posicoesRef.current[i] ?? posicaoPadrao(i)]),
    )
    setArrastandoNo(indice)
  }

  // Delete apaga a seleção; Ctrl+D duplica. Ignorados enquanto o foco está
  // num campo, senão apagar texto apagaria nós.
  useEffect(() => {
    if (!editavel) return

    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null
      if (alvo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return
      if (selecionados.size === 0) return

      if (evento.key === 'Delete') {
        evento.preventDefault()
        onRemoverVarios([...selecionados])
        setSelecionados(new Set())
      }

      if (evento.key.toLowerCase() === 'd' && (evento.ctrlKey || evento.metaKey)) {
        evento.preventDefault()
        onDuplicar([...selecionados])
      }
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [editavel, selecionados, onRemoverVarios, onDuplicar])

  // Enquanto ninguém desenhou nada, as setas mostram a cadeia linear que o
  // percurso já tem — o canvas não pode nascer sem ligação nenhuma e dar a
  // impressão de que a ordem se perdeu.
  const manuais = conexoes.length > 0
  const indicePorId = new Map(nos.map((no, i) => [no.id ?? `sem-id-${i}`, i]))
  const arestas = manuais
    ? conexoes
        .map((conexao) => ({
          de: indicePorId.get(conexao.de),
          para: indicePorId.get(conexao.para),
          chave: `${conexao.de}->${conexao.para}`,
        }))
        .filter((a): a is { de: number; para: number; chave: string } =>
          a.de !== undefined && a.para !== undefined,
        )
    : nos.slice(0, -1).map((_, i) => ({ de: i, para: i + 1, chave: `linear-${i}` }))

  const alturaConteudo = Math.max(460, ...posicoes.map((p) => p.y + ALTURA_NO + 80))
  const larguraConteudo = Math.max(1000, ...posicoes.map((p) => p.x + LARGURA_NO + 80))

  const botaoBarra =
    'rounded-pilula border border-borda-campo px-3 py-1 text-texto-principal hover:bg-superficie-card'

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-texto-secundario">
          <span>Arraste o fundo para mover a vista.</span>
          <span>Shift + arrastar seleciona vários.</span>
          <span>Delete apaga · Ctrl+D duplica.</span>
          {selecionados.size > 0 ? (
            <span className="rounded-pilula bg-brand-bg px-2 py-0.5 font-medium text-brand-texto">
              {selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''}
            </span>
          ) : null}
          <span className="ml-auto flex gap-2">
            {editavel && selecionados.size > 0 ? (
              <>
                <button type="button" onClick={() => onDuplicar([...selecionados])} className={botaoBarra}>
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemoverVarios([...selecionados])
                    setSelecionados(new Set())
                  }}
                  className="rounded-pilula border border-borda-campo px-3 py-1 text-erro hover:bg-superficie-card"
                >
                  Excluir
                </button>
              </>
            ) : null}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={encaixeLigado}
                onChange={(e) => setEncaixeLigado(e.target.checked)}
              />
              Encaixar na grade
            </label>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Number((z - 0.1).toFixed(2))))}
              aria-label="Diminuir zoom"
              className={botaoBarra}
            >
              −
            </button>
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Number((z + 0.1).toFixed(2))))}
              aria-label="Aumentar zoom"
              className={botaoBarra}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                setDeslocamento({ x: 0, y: 0 })
                setZoom(1)
              }}
              className={botaoBarra}
            >
              Centralizar
            </button>
          </span>
        </div>

        <div
          className="relative overflow-hidden rounded-lg border border-borda-campo bg-superficie-bloco"
          style={{ height: 560 }}
        >
          <div
            ref={areaRef}
            onPointerDown={aoApertarNoFundo}
            onWheel={(e) => {
              // Só com Ctrl/Cmd: sem isso, rolar a página sobre o canvas
              // mudaria o zoom sem querer.
              if (!e.ctrlKey && !e.metaKey) return
              e.preventDefault()
              setZoom((z) =>
                Math.min(
                  ZOOM_MAX,
                  Math.max(ZOOM_MIN, Number((z - Math.sign(e.deltaY) * 0.1).toFixed(2))),
                ),
              )
            }}
            className={`absolute inset-0 ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(120,120,120,0.28) 1px, transparent 1px)',
              backgroundSize: `${GRADE * zoom}px ${GRADE * zoom}px`,
              backgroundPosition: `${deslocamento.x}px ${deslocamento.y}px`,
            }}
          >
            <div
              className="pointer-events-none absolute"
              style={{
                transform: `translate(${deslocamento.x}px, ${deslocamento.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: larguraConteudo,
                height: alturaConteudo,
              }}
            >
              <svg
                className="absolute inset-0"
                width={larguraConteudo}
                height={alturaConteudo}
                aria-hidden="true"
              >
                {arestas.map(({ de, para, chave }) => {
                  const origem = posicoes[de]!
                  const destino = posicoes[para]!
                  const x1 = origem.x + LARGURA_NO
                  const y1 = origem.y + ALTURA_NO / 2
                  const x2 = destino.x
                  const y2 = destino.y + ALTURA_NO / 2
                  const meio = (x1 + x2) / 2
                  return (
                    <g key={chave}>
                      <path
                        d={`M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className={manuais ? 'text-brand' : 'text-borda-campo'}
                      />
                      {manuais && editavel ? (
                        // Alvo clicável sobre a curva, para remover a ligação.
                        <path
                          d={`M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={14}
                          className="pointer-events-auto cursor-pointer"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            const idDe = nos[de]?.id
                            const idPara = nos[para]?.id
                            if (idDe && idPara) onDesconectar(idDe, idPara)
                          }}
                        >
                          <title>Clique para remover esta ligação</title>
                        </path>
                      ) : null}
                    </g>
                  )
                })}

                {ligando ? (
                  <path
                    d={`M ${ligando.origemX} ${ligando.origemY} L ${ligando.x} ${ligando.y}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="text-brand"
                  />
                ) : null}
              </svg>

              {marquee ? (
                <div
                  aria-hidden="true"
                  className="absolute border-2 border-brand bg-brand/10"
                  style={{
                    left: Math.min(marquee.x1, marquee.x2),
                    top: Math.min(marquee.y1, marquee.y2),
                    width: Math.abs(marquee.x2 - marquee.x1),
                    height: Math.abs(marquee.y2 - marquee.y1),
                  }}
                />
              ) : null}

              {nos.map((no, indice) => {
                const pos = posicoes[indice]!
                const item = paleta.find((p) => p.codigo === no.codigo)
                const ehCobranca = (no.tipo ?? item?.tipo) === 'COBRANCA'
                const ativo = selecionados.has(indice)

                return (
                  <div
                    key={chaveDoNo(no, indice)}
                    onPointerDown={(e) => aoApertarNoNo(e, indice)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={ativo}
                    aria-label={`Nó ${indice + 1}: ${no.titulo}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelecionados(new Set([indice]))
                      }
                    }}
                    style={{ left: pos.x, top: pos.y, width: LARGURA_NO }}
                    className={`pointer-events-auto absolute flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left shadow-sm ${
                      editavel ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${
                      ehCobranca
                        ? 'border-brand-texto bg-brand-bg'
                        : item?.terminal
                          ? 'border-texto-secundario bg-superficie-card'
                          : 'border-brand bg-superficie-card'
                    } ${ativo ? 'ring-2 ring-brand ring-offset-2' : ''}`}
                  >
                    {editavel ? (
                      <>
                        {/* Alça de saída: arraste dela até outro nó para ligar. */}
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`Ligar a partir de ${no.titulo}`}
                          title="Arraste até outro nó para ligar"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            const id = no.id
                            if (!id) return
                            setLigando({
                              de: id,
                              origemX: pos.x + LARGURA_NO,
                              origemY: pos.y + ALTURA_NO / 2,
                              x: pos.x + LARGURA_NO,
                              y: pos.y + ALTURA_NO / 2,
                            })
                          }}
                          className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-brand bg-superficie-card"
                        />
                        {/* Alça de entrada: solte aqui para fechar a ligação. */}
                        <span
                          aria-hidden="true"
                          onPointerUp={(e) => {
                            if (!ligando || !no.id || ligando.de === no.id) return
                            e.stopPropagation()
                            onConectar(ligando.de, no.id)
                            setLigando(null)
                          }}
                          className={`absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 ${
                            ligando && ligando.de !== no.id
                              ? 'border-brand bg-brand'
                              : 'border-borda-campo bg-superficie-card'
                          }`}
                        />
                      </>
                    ) : null}

                    {editavel ? (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemover(indice)
                          setSelecionados(new Set())
                        }}
                        aria-label={`Excluir ${no.titulo}`}
                        title="Excluir nó"
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-borda-campo bg-superficie-card text-sm font-bold text-erro shadow-sm hover:bg-erro hover:text-white"
                      >
                        ×
                      </button>
                    ) : null}

                    <span className="text-xs font-medium uppercase tracking-wide text-texto-secundario">
                      {indice + 1}. {ehCobranca ? 'Cobrança' : 'Etapa'}
                      {item?.terminal ? ' · fim' : ''}
                    </span>
                    <span className="line-clamp-2 text-sm font-bold text-texto-principal">
                      {no.titulo}
                    </span>
                    <span className="text-xs text-texto-secundario">
                      Dia {no.diasAposEmissao}
                      {ehCobranca && no.valorCentavos
                        ? ` · R$ ${(no.valorCentavos / 100).toFixed(2).replace('.', ',')}`
                        : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <aside className="w-full shrink-0 rounded-lg border border-borda-campo bg-superficie-bloco p-4 lg:w-80">
        {selecionados.size > 1 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-texto-principal">
              {selecionados.size} nós selecionados
            </h3>
            <p className="text-sm text-texto-secundario">
              Arraste qualquer um deles para mover o grupo. Para editar o texto, selecione um só.
            </p>
            {editavel ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onDuplicar([...selecionados])}
                  className="rounded-pilula bg-brand px-4 py-1.5 text-sm font-medium text-white"
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemoverVarios([...selecionados])
                    setSelecionados(new Set())
                  }}
                  className="rounded-pilula border border-borda-campo px-4 py-1.5 text-sm text-erro"
                >
                  Excluir
                </button>
              </div>
            ) : null}
          </div>
        ) : !noSelecionado ? (
          <p className="text-sm text-texto-secundario">
            Clique em um nó para editar. Arraste o fundo para mover a vista e Shift + arrastar
            para selecionar vários.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-texto-principal">Nó {principal! + 1}</h3>
              {editavel ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onReordenar(principal!, -1)}
                    disabled={principal === 0}
                    aria-label="Mover para antes no percurso"
                    className="rounded px-2 py-1 text-brand-texto disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onReordenar(principal!, 1)}
                    disabled={principal === nos.length - 1}
                    aria-label="Mover para depois no percurso"
                    className="rounded px-2 py-1 text-brand-texto disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              ) : null}
            </div>

            <p className="font-mono text-xs text-texto-secundario">{noSelecionado.codigo}</p>

            <label className="flex flex-col gap-1 text-xs text-texto-secundario">
              Título na timeline
              <input
                className={CAMPO}
                value={noSelecionado.titulo}
                onChange={(e) => onEditar(principal!, 'titulo', e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-texto-secundario">
              Descrição
              <input
                className={CAMPO}
                value={noSelecionado.descricao}
                onChange={(e) => onEditar(principal!, 'descricao', e.target.value)}
              />
            </label>

            {editavel ? (
              <label className="flex flex-col gap-1 text-xs text-texto-secundario">
                Dias após a emissão
                <input
                  type="number"
                  min={0}
                  max={365}
                  className={CAMPO}
                  value={noSelecionado.diasAposEmissao}
                  onChange={(e) => onEditar(principal!, 'diasAposEmissao', Number(e.target.value))}
                />
              </label>
            ) : null}

            {itemSelecionado?.tipo === 'COBRANCA' ? (
              <div className="flex flex-col gap-2 rounded-lg border border-borda-campo p-3">
                <span className="text-xs font-bold text-texto-principal">Cobrança</span>
                <label className="flex flex-col gap-1 text-xs text-texto-secundario">
                  Valor (R$)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={CAMPO}
                    value={noSelecionado.valorCentavos ? noSelecionado.valorCentavos / 100 : ''}
                    onChange={(e) =>
                      onEditar(principal!, 'valorCentavos', Math.round(Number(e.target.value) * 100))
                    }
                  />
                </label>
                <p className="text-xs text-texto-secundario">
                  O valor aparece na timeline como pendência. A ligação com um meio de pagamento
                  ainda não está disponível.
                </p>
              </div>
            ) : null}

            {editavel ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onDuplicar([principal!])}
                  className="rounded-pilula border border-borda-campo px-4 py-1.5 text-sm text-texto-principal"
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemover(principal!)
                    setSelecionados(new Set())
                  }}
                  className="rounded-pilula border border-borda-campo px-4 py-1.5 text-sm text-erro"
                >
                  Excluir
                </button>
              </div>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  )
}

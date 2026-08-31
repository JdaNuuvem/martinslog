'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

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

export type No = {
  codigo: string
  titulo: string
  descricao: string
  diasAposEmissao: number
  tipo?: TipoNo
  x?: number
  y?: number
  valorCentavos?: number
}

const LARGURA_NO = 220
const ALTURA_NO = 76
const COLUNA = 300
const LINHA = 120

const CAMPO =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/** Posição padrão de um nó que ainda não foi arrastado: uma escada. */
function posicaoPadrao(indice: number): { x: number; y: number } {
  return { x: 40 + (indice % 3) * COLUNA, y: 40 + Math.floor(indice / 3) * LINHA * 2 + (indice % 3) * 30 }
}

function posicaoDoNo(no: No, indice: number): { x: number; y: number } {
  return { x: no.x ?? posicaoPadrao(indice).x, y: no.y ?? posicaoPadrao(indice).y }
}

/**
 * Canvas do fluxo de rastreio.
 *
 * A ordem dos nós na lista é a ordem do percurso — as conexões desenhadas
 * seguem essa ordem, e arrastar um nó muda só onde ele aparece, não quando
 * ele acontece. Isso é deliberado: quem define o momento de cada etapa é o
 * campo de dias, e deixar a posição no canvas mandar no tempo faria o
 * percurso mudar sem ninguém pedir, só por reorganizar o desenho.
 *
 * Para reordenar o percurso existem as setas no painel do nó.
 */
export function CanvasFluxoRastreio({
  nos,
  paleta,
  editavel,
  onMover,
  onEditar,
  onRemover,
  onReordenar,
}: {
  nos: No[]
  paleta: ItemPaleta[]
  editavel: boolean
  onMover: (indice: number, x: number, y: number) => void
  onEditar: (indice: number, campo: keyof No, valor: string | number) => void
  onRemover: (indice: number) => void
  onReordenar: (indice: number, direcao: -1 | 1) => void
}) {
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [arrastando, setArrastando] = useState<number | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const deslocamento = useRef({ x: 0, y: 0 })

  const aoSoltar = useCallback(() => setArrastando(null), [])

  useEffect(() => {
    if (arrastando === null) return

    function aoMover(evento: PointerEvent) {
      const area = areaRef.current
      if (!area || arrastando === null) return
      const caixa = area.getBoundingClientRect()
      const x = Math.max(0, evento.clientX - caixa.left - deslocamento.current.x)
      const y = Math.max(0, evento.clientY - caixa.top - deslocamento.current.y)
      onMover(arrastando, Math.round(x), Math.round(y))
    }

    window.addEventListener('pointermove', aoMover)
    window.addEventListener('pointerup', aoSoltar)
    return () => {
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltar)
    }
  }, [arrastando, onMover, aoSoltar])

  function iniciarArrasto(evento: ReactPointerEvent, indice: number) {
    if (!editavel) return
    const area = areaRef.current
    if (!area) return
    const caixa = area.getBoundingClientRect()
    const pos = posicaoDoNo(nos[indice]!, indice)
    deslocamento.current = {
      x: evento.clientX - caixa.left - pos.x,
      y: evento.clientY - caixa.top - pos.y,
    }
    setArrastando(indice)
    setSelecionado(indice)
  }

  const posicoes = nos.map((no, indice) => posicaoDoNo(no, indice))
  const alturaArea = Math.max(420, ...posicoes.map((p) => p.y + ALTURA_NO + 60))
  const larguraArea = Math.max(900, ...posicoes.map((p) => p.x + LARGURA_NO + 60))

  const noSelecionado = selecionado !== null ? nos[selecionado] : undefined
  const itemSelecionado = noSelecionado
    ? paleta.find((item) => item.codigo === noSelecionado.codigo)
    : undefined

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-borda-campo bg-superficie-bloco"
        style={{ maxHeight: 560 }}>
        <div
          ref={areaRef}
          className="relative"
          style={{
            width: larguraArea,
            height: alturaArea,
            backgroundImage:
              'radial-gradient(circle, rgba(120,120,120,0.28) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          {/* Conectores. Ficam atrás dos nós e seguem a ordem do percurso. */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={larguraArea}
            height={alturaArea}
            aria-hidden="true"
          >
            {posicoes.slice(0, -1).map((origem, indice) => {
              const destino = posicoes[indice + 1]!
              const x1 = origem.x + LARGURA_NO
              const y1 = origem.y + ALTURA_NO / 2
              const x2 = destino.x
              const y2 = destino.y + ALTURA_NO / 2
              const meio = (x1 + x2) / 2
              return (
                <path
                  key={indice}
                  d={`M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="text-borda-campo"
                />
              )
            })}
          </svg>

          {nos.map((no, indice) => {
            const pos = posicoes[indice]!
            const item = paleta.find((p) => p.codigo === no.codigo)
            const ehCobranca = (no.tipo ?? item?.tipo) === 'COBRANCA'
            const ativo = selecionado === indice

            return (
              <button
                key={`${no.codigo}-${indice}`}
                type="button"
                onPointerDown={(e) => iniciarArrasto(e, indice)}
                onClick={() => setSelecionado(indice)}
                aria-pressed={ativo}
                style={{ left: pos.x, top: pos.y, width: LARGURA_NO }}
                className={`absolute flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left shadow-sm ${
                  editavel ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  ehCobranca
                    ? 'border-brand-texto bg-brand-bg'
                    : item?.terminal
                      ? 'border-texto-secundario bg-superficie-card'
                      : 'border-brand bg-superficie-card'
                } ${ativo ? 'ring-2 ring-brand ring-offset-2' : ''}`}
              >
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
              </button>
            )
          })}
        </div>
      </div>

      <aside className="w-full shrink-0 rounded-lg border border-borda-campo bg-superficie-bloco p-4 lg:w-80">
        {!noSelecionado ? (
          <p className="text-sm text-texto-secundario">
            Clique em um nó do fluxo para editar. Arraste para reposicionar.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-texto-principal">
                Nó {selecionado! + 1}
              </h3>
              {editavel ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onReordenar(selecionado!, -1)}
                    disabled={selecionado === 0}
                    aria-label="Mover para antes no percurso"
                    className="rounded px-2 py-1 text-brand-texto disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onReordenar(selecionado!, 1)}
                    disabled={selecionado === nos.length - 1}
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
                onChange={(e) => onEditar(selecionado!, 'titulo', e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-texto-secundario">
              Descrição
              <input
                className={CAMPO}
                value={noSelecionado.descricao}
                onChange={(e) => onEditar(selecionado!, 'descricao', e.target.value)}
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
                  onChange={(e) =>
                    onEditar(selecionado!, 'diasAposEmissao', Number(e.target.value))
                  }
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
                    value={
                      noSelecionado.valorCentavos ? noSelecionado.valorCentavos / 100 : ''
                    }
                    onChange={(e) =>
                      onEditar(
                        selecionado!,
                        'valorCentavos',
                        Math.round(Number(e.target.value) * 100),
                      )
                    }
                  />
                </label>
                <p className="text-xs text-texto-secundario">
                  O valor aparece na timeline como pendência. A ligação com um meio de pagamento
                  ainda não está disponível — ver a observação abaixo do fluxo.
                </p>
              </div>
            ) : null}

            {editavel ? (
              <button
                type="button"
                onClick={() => {
                  onRemover(selecionado!)
                  setSelecionado(null)
                }}
                className="self-start text-sm font-medium text-erro hover:underline"
              >
                Remover nó
              </button>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  )
}

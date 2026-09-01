import type { EventoRastreio, FluxoPublico } from '@/lib/rastreio-schema'

/**
 * Percurso do envio, desenhado como o fluxo que a conta montou.
 *
 * Mostra os nós configurados pelo lojista, no mesmo formato do construtor —
 * nós ligados por conectores curvos —, com o já percorrido em destaque e o
 * atual marcado.
 *
 * **Nenhuma data das etapas que ainda não aconteceram.** É a linha da seção 7
 * da spec: dizer por onde a encomenda passa descreve o serviço; dizer quando
 * ela passa promete uma data que a simulação ainda pode mudar. Por isso o
 * componente recebe só a forma do percurso — código, título e posição —, e
 * nunca os dias.
 */

const LARGURA = 190
const ALTURA = 64
const COLUNA = 250
const LINHA = 110

type Estado = 'percorrido' | 'atual' | 'pendente'

function posicao(no: FluxoPublico['nos'][number], indice: number) {
  // Sem posição salva, cai num arranjo em escada. Vale para a conta que
  // nunca arrastou nada no canvas.
  return {
    x: no.x ?? 40 + (indice % 4) * COLUNA,
    y: no.y ?? 40 + Math.floor(indice / 4) * LINHA,
  }
}

export function FluxoRastreio({
  fluxo,
  eventos,
}: {
  fluxo: FluxoPublico
  eventos: EventoRastreio[]
}) {
  if (fluxo.nos.length === 0) return null

  const ocorridos = new Set(eventos.map((evento) => evento.codigo))
  const codigoAtual = eventos[0]?.codigo

  // O último nó já percorrido é o "atual". Percorrer a lista até ele evita
  // marcar como atual um nó que aparece duas vezes no percurso.
  const indiceAtual = fluxo.nos.reduce(
    (ultimo, no, indice) => (ocorridos.has(no.codigo) ? indice : ultimo),
    -1,
  )

  const posicoes = fluxo.nos.map(posicao)

  // Sem ligações desenhadas, o percurso é a cadeia na ordem dos nós — a mesma
  // regra que o construtor usa.
  const indicePorId = new Map(fluxo.nos.map((no, i) => [no.id, i]))
  const arestas =
    fluxo.conexoes.length > 0
      ? fluxo.conexoes
          .map((c) => ({ de: indicePorId.get(c.de), para: indicePorId.get(c.para) }))
          .filter((a): a is { de: number; para: number } => a.de !== undefined && a.para !== undefined)
      : fluxo.nos.slice(0, -1).map((_, i) => ({ de: i, para: i + 1 }))

  const largura = Math.max(...posicoes.map((p) => p.x + LARGURA + 40), 600)
  const altura = Math.max(...posicoes.map((p) => p.y + ALTURA + 40), 200)

  function estadoDoNo(indice: number): Estado {
    const no = fluxo.nos[indice]!
    if (indice === indiceAtual) return 'atual'
    if (no.codigo === codigoAtual) return 'atual'
    return indice < indiceAtual || ocorridos.has(no.codigo) ? 'percorrido' : 'pendente'
  }

  const classes: Record<Estado, string> = {
    percorrido: 'border-brand bg-brand-bg text-brand-texto',
    atual: 'border-brand bg-brand text-white shadow-md',
    pendente: 'border-borda-campo bg-superficie-bloco text-texto-secundario',
  }

  return (
    <section
      aria-label="Caminho do envio"
      className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Caminho do envio</h2>
        <p className="text-sm text-texto-secundario">
          As etapas pelas quais esta encomenda passa. Não há previsão de data para as que ainda
          não aconteceram.
        </p>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="relative" style={{ width: largura, height: altura, minWidth: '100%' }}>
          <svg
            className="absolute inset-0"
            width={largura}
            height={altura}
            aria-hidden="true"
          >
            {arestas.map(({ de, para }, indice) => {
              const origem = posicoes[de]!
              const destino = posicoes[para]!
              const x1 = origem.x + LARGURA
              const y1 = origem.y + ALTURA / 2
              const x2 = destino.x
              const y2 = destino.y + ALTURA / 2
              const meio = (x1 + x2) / 2
              const percorrida = estadoDoNo(para) !== 'pendente'
              return (
                <path
                  key={indice}
                  d={`M ${x1} ${y1} C ${meio} ${y1}, ${meio} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={percorrida ? 'text-brand' : 'text-borda-campo'}
                />
              )
            })}
          </svg>

          <ol className="contents">
            {fluxo.nos.map((no, indice) => {
              const pos = posicoes[indice]!
              const estado = estadoDoNo(indice)
              return (
                <li
                  key={`${no.id}-${indice}`}
                  aria-current={estado === 'atual' ? 'step' : undefined}
                  style={{ left: pos.x, top: pos.y, width: LARGURA }}
                  className={`absolute flex flex-col justify-center gap-0.5 rounded-lg border-2 p-3 ${classes[estado]}`}
                >
                  <span className="line-clamp-2 text-sm font-bold">{no.titulo}</span>
                  {estado === 'atual' ? (
                    <span className="text-xs font-medium uppercase tracking-wide">
                      Etapa atual
                    </span>
                  ) : estado === 'percorrido' ? (
                    <span className="text-xs">Concluída</span>
                  ) : (
                    <span className="text-xs">Ainda não aconteceu</span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}

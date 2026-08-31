import type { EventoRastreio } from '@/lib/rastreio-schema'

/**
 * Diagrama do caminho que um envio percorre, com a etapa atual destacada.
 *
 * Mostra **etapas genéricas, nunca os eventos futuros deste envio**. A
 * distinção é o que mantém a página dentro da regra da spec (seção 7:
 * "eventos futuros nunca aparecem, nem esmaecidos"): dizer que todo envio
 * passa por "Saiu para entrega" é descrever o serviço; dizer que este envio
 * sai para entrega na terça é prometer uma data que a simulação ainda pode
 * mudar. Por isso nenhum nó pendente carrega data ou hora.
 *
 * As ramificações aparecem sempre, e não só quando acontecem, porque o
 * objetivo é o destinatário entender de antemão o que pode acontecer com a
 * encomenda dele — e reconhecer o estado quando acontecer.
 */

type EstadoEtapa = 'concluida' | 'atual' | 'pendente'

type Etapa = {
  /** Códigos de evento que colocam o envio nesta etapa. */
  codigos: string[]
  titulo: string
  /** Uma linha explicando o que a etapa significa para quem recebe. */
  ajuda: string
}

/** Trilho principal: o caminho que a maior parte dos envios percorre. */
const CAMINHO_PRINCIPAL: Etapa[] = [
  {
    codigos: ['ETIQUETA_EMITIDA'],
    titulo: 'Etiqueta emitida',
    ajuda: 'O remetente preparou o envio.',
  },
  {
    codigos: ['POSTADO'],
    titulo: 'Postado',
    ajuda: 'A encomenda entrou na rede de transporte.',
  },
  {
    codigos: ['TRANSFERENCIA', 'AGUARDANDO_TRATAMENTO'],
    titulo: 'Em trânsito',
    ajuda: 'Passando pelas unidades até a cidade de destino.',
  },
  {
    codigos: ['SAIU_PARA_ENTREGA'],
    titulo: 'Saiu para entrega',
    ajuda: 'É preciso alguém no endereço para receber.',
  },
  {
    codigos: ['ENTREGUE'],
    titulo: 'Entregue',
    ajuda: 'Fim do percurso.',
  },
]

/** Desvios possíveis, com o ponto do trilho de onde saem. */
const DESVIOS: (Etapa & { saiDe: string; consequencia: string })[] = [
  {
    saiDe: 'Saiu para entrega',
    codigos: ['TENTATIVA_FRUSTRADA', 'AGUARDANDO_RETIRADA'],
    titulo: 'Tentativa sem sucesso',
    ajuda: 'Ninguém no endereço para receber.',
    consequencia: 'Uma nova tentativa é feita.',
  },
  {
    saiDe: 'Saiu para entrega',
    codigos: ['DEVOLUCAO_INICIADA', 'DEVOLVIDO'],
    titulo: 'Devolvido ao remetente',
    ajuda: 'O prazo de retirada terminou sem a encomenda ser recebida.',
    consequencia: 'A encomenda volta para quem enviou.',
  },
  {
    saiDe: 'Em trânsito',
    codigos: ['EXTRAVIADO'],
    titulo: 'Extraviado',
    ajuda: 'A encomenda não foi localizada no fluxo de transporte.',
    consequencia: 'O valor pago é devolvido ao remetente.',
  },
]

function estadoDaEtapa(
  etapa: Etapa,
  codigosOcorridos: Set<string>,
  indiceAtual: number,
  indiceEtapa: number,
): EstadoEtapa {
  if (etapa.codigos.some((codigo) => codigosOcorridos.has(codigo))) {
    return indiceEtapa === indiceAtual ? 'atual' : 'concluida'
  }
  return indiceEtapa < indiceAtual ? 'concluida' : 'pendente'
}

const CLASSES_NO: Record<EstadoEtapa, string> = {
  concluida: 'border-brand bg-brand-bg text-brand-texto',
  atual: 'border-brand bg-brand text-white shadow-md',
  pendente: 'border-borda-campo bg-superficie-bloco text-texto-secundario',
}

export function FluxoRastreio({ eventos }: { eventos: EventoRastreio[] }) {
  const codigosOcorridos = new Set(eventos.map((evento) => evento.codigo))

  // A etapa atual é a última do trilho que já teve algum evento. Um desvio
  // não avança o trilho: quem está em "aguardando retirada" continua na
  // etapa de entrega, que é onde a encomenda de fato está parada.
  const indiceAtual = CAMINHO_PRINCIPAL.reduce(
    (ultimo, etapa, indice) =>
      etapa.codigos.some((codigo) => codigosOcorridos.has(codigo)) ? indice : ultimo,
    0,
  )

  const desviosOcorridos = DESVIOS.filter((desvio) =>
    desvio.codigos.some((codigo) => codigosOcorridos.has(codigo)),
  )

  return (
    <section
      aria-label="Caminho do envio"
      className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Caminho do envio</h2>
        <p className="text-sm text-texto-secundario">
          As etapas pelas quais uma encomenda passa. Não há previsão de data para as que ainda
          não aconteceram.
        </p>
      </div>

      {/* Rola na horizontal em telas estreitas em vez de espremer os nós. */}
      <div className="overflow-x-auto pb-2">
        <ol className="flex min-w-max items-stretch gap-2">
          {CAMINHO_PRINCIPAL.map((etapa, indice) => {
            const estado = estadoDaEtapa(etapa, codigosOcorridos, indiceAtual, indice)
            return (
              <li key={etapa.titulo} className="flex items-center gap-2">
                <div
                  aria-current={estado === 'atual' ? 'step' : undefined}
                  className={`flex w-40 flex-col gap-1 rounded-lg border-2 p-3 ${CLASSES_NO[estado]}`}
                >
                  <span className="text-sm font-bold">{etapa.titulo}</span>
                  <span
                    className={`text-xs ${estado === 'atual' ? 'text-white/90' : 'text-texto-secundario'}`}
                  >
                    {etapa.ajuda}
                  </span>
                  {estado === 'atual' ? (
                    <span className="mt-1 text-xs font-medium uppercase tracking-wide">
                      Etapa atual
                    </span>
                  ) : null}
                </div>
                {indice < CAMINHO_PRINCIPAL.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`h-0.5 w-6 ${indice < indiceAtual ? 'bg-brand' : 'bg-borda-campo'}`}
                  />
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-2 border-t border-borda-campo pt-4">
        <h3 className="text-sm font-bold text-texto-principal">Se algo sair do previsto</h3>
        <ul className="flex flex-col gap-2">
          {DESVIOS.map((desvio) => {
            const ocorreu = desviosOcorridos.includes(desvio)
            return (
              <li
                key={desvio.titulo}
                className={`flex flex-col gap-0.5 rounded-lg border p-3 ${
                  ocorreu ? 'border-brand bg-brand-bg' : 'border-borda-campo'
                }`}
              >
                <span className="text-sm font-medium text-texto-principal">
                  {desvio.titulo}
                  <span className="ml-2 text-xs font-normal text-texto-secundario">
                    a partir de &quot;{desvio.saiDe}&quot;
                  </span>
                  {ocorreu ? (
                    <span className="ml-2 rounded-pilula bg-brand px-2 py-0.5 text-xs font-medium text-white">
                      Aconteceu neste envio
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-texto-secundario">
                  {desvio.ajuda} {desvio.consequencia}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

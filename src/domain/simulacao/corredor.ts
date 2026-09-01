import type { LocalidadeSimulacao } from './tipos'

/**
 * Onde ficam os pontos de apoio da malha, para a encomenda passar por
 * lugares que fazem sentido no caminho.
 *
 * Até aqui a simulação só conhecia dois lugares — a cidade de quem envia e a
 * de quem recebe —, então uma encomenda do Ceará para o Rio Grande do Sul
 * "transferia" de Fortaleza direto para Porto Alegre. Quem acompanha o
 * rastreio percebe: falta o meio do caminho.
 *
 * Uma capital por estado basta para isso. O ponto não é reproduzir a malha
 * real de nenhuma transportadora, é que a sequência de cidades seja
 * geograficamente honesta: quem sai de Fortaleza rumo a Porto Alegre passa
 * por Recife, Salvador, São Paulo — e não por Manaus.
 *
 * Coordenadas aproximadas do centro de cada capital, em graus decimais.
 */
export type Hub = LocalidadeSimulacao & { lat: number; lon: number }

export const HUBS: readonly Hub[] = [
  { cidade: 'Rio Branco', uf: 'AC', lat: -9.97, lon: -67.81 },
  { cidade: 'Maceió', uf: 'AL', lat: -9.65, lon: -35.71 },
  { cidade: 'Macapá', uf: 'AP', lat: 0.03, lon: -51.07 },
  { cidade: 'Manaus', uf: 'AM', lat: -3.12, lon: -60.02 },
  { cidade: 'Salvador', uf: 'BA', lat: -12.97, lon: -38.5 },
  { cidade: 'Fortaleza', uf: 'CE', lat: -3.73, lon: -38.53 },
  { cidade: 'Brasília', uf: 'DF', lat: -15.78, lon: -47.93 },
  { cidade: 'Vitória', uf: 'ES', lat: -20.32, lon: -40.34 },
  { cidade: 'Goiânia', uf: 'GO', lat: -16.69, lon: -49.26 },
  { cidade: 'São Luís', uf: 'MA', lat: -2.53, lon: -44.3 },
  { cidade: 'Cuiabá', uf: 'MT', lat: -15.6, lon: -56.1 },
  { cidade: 'Campo Grande', uf: 'MS', lat: -20.44, lon: -54.65 },
  { cidade: 'Belo Horizonte', uf: 'MG', lat: -19.92, lon: -43.94 },
  { cidade: 'Belém', uf: 'PA', lat: -1.46, lon: -48.5 },
  { cidade: 'João Pessoa', uf: 'PB', lat: -7.12, lon: -34.86 },
  { cidade: 'Curitiba', uf: 'PR', lat: -25.43, lon: -49.27 },
  { cidade: 'Recife', uf: 'PE', lat: -8.05, lon: -34.9 },
  { cidade: 'Teresina', uf: 'PI', lat: -5.09, lon: -42.8 },
  { cidade: 'Rio de Janeiro', uf: 'RJ', lat: -22.91, lon: -43.17 },
  { cidade: 'Natal', uf: 'RN', lat: -5.79, lon: -35.21 },
  { cidade: 'Porto Alegre', uf: 'RS', lat: -30.03, lon: -51.23 },
  { cidade: 'Porto Velho', uf: 'RO', lat: -8.76, lon: -63.9 },
  { cidade: 'Boa Vista', uf: 'RR', lat: 2.82, lon: -60.67 },
  { cidade: 'Florianópolis', uf: 'SC', lat: -27.6, lon: -48.55 },
  { cidade: 'São Paulo', uf: 'SP', lat: -23.55, lon: -46.63 },
  { cidade: 'Aracaju', uf: 'SE', lat: -10.91, lon: -37.07 },
  { cidade: 'Palmas', uf: 'TO', lat: -10.18, lon: -48.33 },
]

const HUB_POR_UF = new Map(HUBS.map((hub) => [hub.uf.toUpperCase(), hub]))

/** Hub do estado, quando conhecido. */
export function hubDaUf(uf: string): Hub | undefined {
  return HUB_POR_UF.get(uf.trim().toUpperCase())
}

/**
 * Distância aproximada em quilômetros entre dois pontos.
 *
 * Projeção equirretangular em vez de Haversine: para escolher a ordem das
 * escalas de um trecho, o erro dela é irrelevante, e ela evita trigonometria
 * pesada num caminho que roda a cada emissão de etiqueta.
 */
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const KM_POR_GRAU = 111.32
  const latMedia = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dx = (b.lon - a.lon) * Math.cos(latMedia) * KM_POR_GRAU
  const dy = (b.lat - a.lat) * KM_POR_GRAU

  return Math.sqrt(dx * dx + dy * dy)
}

/** Largura do corredor: hub mais afastado que isto não está "no caminho". */
const DESVIO_MAXIMO_KM = 450

/** Trechos curtos não ganham escala nenhuma: ninguém transborda ali. */
const DISTANCIA_MINIMA_PARA_ESCALA_KM = 300

/**
 * As cidades por onde a encomenda passa entre a origem e o destino, na ordem
 * da viagem.
 *
 * Um hub entra quando está **entre** os dois pontos (projeção sobre o trecho
 * dentro dele) e perto o bastante da linha reta — é o que separa "está no
 * caminho" de "fica do outro lado do país". Entre os que sobram, o trecho é
 * dividido em `maximo` faixas e cada faixa cede a sua parada mais próxima da
 * reta, para que as escalas se espalhem pelo caminho inteiro.
 *
 * Devolve lista vazia quando origem e destino são perto demais, quando a UF
 * de um dos dois é desconhecida, ou quando nada cai no corredor — nesses
 * casos o roteiro segue como antes, sem escala.
 */
export function escalasDaRota(
  origem: LocalidadeSimulacao,
  destino: LocalidadeSimulacao,
  maximo: number,
): LocalidadeSimulacao[] {
  if (maximo <= 0) return []

  const partida = hubDaUf(origem.uf)
  const chegada = hubDaUf(destino.uf)
  if (!partida || !chegada) return []

  const distanciaTotal = distanciaKm(partida, chegada)
  if (distanciaTotal < DISTANCIA_MINIMA_PARA_ESCALA_KM) return []

  const candidatos = HUBS.filter((hub) => hub.uf !== partida.uf && hub.uf !== chegada.uf)
    .map((hub) => ({ hub, ...posicaoNoTrecho(partida, chegada, hub) }))
    // Fora das pontas: 0 é a origem e 1 é o destino, e um hub logo ao lado de
    // uma delas não é escala, é a própria cidade de novo.
    .filter(({ posicao, desvioKm }) => posicao > 0.08 && posicao < 0.92 && desvioKm < DESVIO_MAXIMO_KM)

  /*
    Uma escala por faixa do trecho, em vez das `maximo` mais próximas da reta.
    Escolher só pelo desvio agrupa as paradas onde a malha é mais densa: um
    Fortaleza–Porto Alegre saía com São Paulo, Curitiba e Florianópolis, três
    cidades vizinhas no fim do caminho, e a encomenda sumia do Nordeste até
    reaparecer no Sudeste. Dividir o trecho e pegar a melhor de cada pedaço
    espalha as paradas pelo caminho inteiro.
  */
  const escolhidas: typeof candidatos = []

  for (let faixa = 0; faixa < maximo; faixa += 1) {
    const inicio = faixa / maximo
    const fim = (faixa + 1) / maximo

    const melhor = candidatos
      .filter(
        (candidato) =>
          candidato.posicao >= inicio &&
          candidato.posicao < fim &&
          !escolhidas.includes(candidato),
      )
      .sort((a, b) => a.desvioKm - b.desvioKm)[0]

    if (melhor) escolhidas.push(melhor)
  }

  return escolhidas
    .sort((a, b) => a.posicao - b.posicao)
    .map(({ hub }) => ({ cidade: hub.cidade, uf: hub.uf }))
}

/**
 * Onde um ponto cai em relação ao trecho: `posicao` de 0 (origem) a 1
 * (destino), e o quanto ele se afasta da linha reta.
 */
function posicaoNoTrecho(
  origem: { lat: number; lon: number },
  destino: { lat: number; lon: number },
  ponto: { lat: number; lon: number },
): { posicao: number; desvioKm: number } {
  const dx = destino.lon - origem.lon
  const dy = destino.lat - origem.lat
  const comprimento = dx * dx + dy * dy

  if (comprimento === 0) return { posicao: 0, desvioKm: distanciaKm(origem, ponto) }

  const posicao =
    ((ponto.lon - origem.lon) * dx + (ponto.lat - origem.lat) * dy) / comprimento

  const projetado = { lon: origem.lon + posicao * dx, lat: origem.lat + posicao * dy }

  return { posicao, desvioKm: distanciaKm(projetado, ponto) }
}

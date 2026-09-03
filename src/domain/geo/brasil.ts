import { FAIXAS_BR } from './faixas-br'

/**
 * Decide se um endereço IPv4 pertence a uma faixa alocada ao Brasil.
 *
 * A lista vem da base de geolocalização do DB-IP, publicada mensalmente em CSV,
 * sem chave de acesso.
 *
 * NÃO usa o registro do LACNIC, que é a fonte autoritativa de ALOCAÇÃO — e foi
 * a primeira tentativa. Registro de alocação não é geolocalização: ele diz a
 * quem o bloco foi entregue, e onde ele é usado pode ser outro país. O defeito
 * apareceu no primeiro teste, com o servidor da própria Martins Log, em
 * Campinas, ficando FORA da lista de faixas brasileiras.
 *
 * O que isto NÃO é: prova de localização. Uma VPN em São Paulo faz um visitante
 * de Lisboa parecer brasileiro, e um chip de operadora estrangeira em roaming
 * faz o contrário. Serve para reduzir tráfego que não interessa, nunca como
 * controle de acesso — quem precisa de garantia usa senha, não geografia.
 */

/** Faixas ordenadas, como pares [primeiro, último] de inteiros de 32 bits. */
let faixas: [number, number][] | null = null

function carregar(): [number, number][] {
  if (faixas) return faixas

  /*
    Convertido uma vez e guardado em memória. A lista vem de um módulo, e não
    de leitura de disco, porque o middleware roda no runtime Edge — onde `fs`
    não existe. O arquivo é gerado por script, então atualizar a lista continua
    sendo um comando, sem tocar em lógica.
  */
  const bruto = FAIXAS_BR
  const lidas: [number, number][] = []

  for (const linha of bruto.split('\n')) {
    if (!linha || linha.startsWith('#')) continue
    const virgula = linha.indexOf(',')
    if (virgula === -1) continue
    const inicio = Number(linha.slice(0, virgula))
    const fim = Number(linha.slice(virgula + 1))
    if (Number.isFinite(inicio) && Number.isFinite(fim)) lidas.push([inicio, fim])
  }

  faixas = lidas
  return faixas
}

/** Quantas faixas a lista carregou. Serve para o teste provar que ela não veio vazia. */
export function totalDeFaixas(): number {
  return carregar().length
}

/**
 * Converte um IPv4 em inteiro. Devolve `null` para qualquer coisa que não seja
 * um IPv4 válido — inclusive IPv6, que esta lista não cobre.
 */
export function paraInteiro(ip: string): number | null {
  const limpo = ip.trim()

  /*
    IPv4 mapeado em IPv6 (`::ffff:200.1.2.3`) chega assim quando o servidor
    escuta nas duas pilhas. Sem desembrulhar, um visitante brasileiro legítimo
    seria tratado como endereço inválido.
  */
  const mapeado = limpo.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const candidato = mapeado ? mapeado[1]! : limpo

  const partes = candidato.split('.')
  if (partes.length !== 4) return null

  let valor = 0
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null
    const octeto = Number(parte)
    if (octeto > 255) return null
    valor = valor * 256 + octeto
  }

  return valor
}

/**
 * `true` quando o IP está numa faixa brasileira.
 *
 * Busca binária: são mais de seis mil faixas, então cada consulta faz cerca de
 * treze comparações. Varredura linear custaria centenas de vezes mais em toda
 * requisição, e isto roda antes de qualquer página.
 */
export function ehIpBrasileiro(ip: string): boolean {
  const valor = paraInteiro(ip)
  if (valor === null) return false

  const lista = carregar()
  let inicio = 0
  let fim = lista.length - 1

  while (inicio <= fim) {
    const meio = (inicio + fim) >> 1
    const [primeiro, ultimo] = lista[meio]!
    if (valor < primeiro) fim = meio - 1
    else if (valor > ultimo) inicio = meio + 1
    else return true
  }

  return false
}

/**
 * Endereços que não têm país: rede interna, laço local, ligação entre
 * contêineres.
 *
 * Precisam passar. É por eles que a verificação de saúde do próprio servidor
 * chega — e um bloqueio que derruba a verificação de saúde derruba a aplicação
 * inteira, achando que está protegendo.
 */
export function ehIpPrivado(ip: string): boolean {
  const valor = paraInteiro(ip)
  if (valor === null) return false

  const dentro = (a: string, prefixo: number) => {
    const base = paraInteiro(a)!
    const mascara = prefixo === 0 ? 0 : (0xffffffff << (32 - prefixo)) >>> 0
    return (valor & mascara) >>> 0 === (base & mascara) >>> 0
  }

  return (
    dentro('10.0.0.0', 8) ||
    dentro('172.16.0.0', 12) ||
    dentro('192.168.0.0', 16) ||
    dentro('127.0.0.0', 8) ||
    dentro('169.254.0.0', 16) ||
    // Rede compartilhada de provedor (CGNAT). Muita operadora móvel brasileira
    // entrega o cliente por aqui, e o IP público real fica fora do alcance.
    dentro('100.64.0.0', 10)
  )
}

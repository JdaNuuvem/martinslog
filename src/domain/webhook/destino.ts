/**
 * Guardas de destino para webhook de saída.
 *
 * Webhook de saída é SSRF por construção: o servidor busca uma URL que o
 * próprio usuário cadastrou. Sem estas guardas, qualquer cliente usa o nosso
 * servidor como sonda da rede interna — e `169.254.169.254`, o endpoint de
 * metadados das nuvens, entrega credenciais de instância a quem conseguir
 * uma requisição até lá.
 *
 * Este módulo é puro: valida o que dá para validar sem rede. A validação do
 * **IP resolvido** acontece no serviço, depois do DNS e a cada
 * redirecionamento — sem ela, um domínio público apontando para 127.0.0.1
 * passaria por aqui intacto.
 */

const FAIXAS_IPV4_BLOQUEADAS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "este host"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, inclui metadados de nuvem
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // atribuições especiais da IANA
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada
]

function ipv4ParaNumero(ip: string): number | null {
  const partes = ip.split('.')
  if (partes.length !== 4) return null

  let numero = 0
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null
    const octeto = Number(parte)
    if (octeto > 255) return null
    numero = numero * 256 + octeto
  }
  return numero
}

/**
 * Diz se um endereço IP cai em faixa privada, local ou reservada. Aceita
 * IPv4, IPv6 e a forma IPv4-mapeada-em-IPv6 (`::ffff:127.0.0.1`), que é como
 * um resolvedor pode devolver um endereço de loopback quando a pilha é dupla.
 */
export function ehIpPrivado(ip: string): boolean {
  const limpo = ip.trim().toLowerCase().replace(/^\[|\]$/g, '')

  const mapeado = limpo.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapeado?.[1]) {
    return ehIpPrivado(mapeado[1])
  }

  if (limpo.includes(':')) {
    // `::` (não especificado), `::1` (loopback), `fe80::/10` (link-local) e
    // `fc00::/7` (únicos locais) cobrem o que não deve ser alcançável.
    return (
      limpo === '::' ||
      limpo === '::1' ||
      /^fe[89ab]/.test(limpo) ||
      /^f[cd]/.test(limpo)
    )
  }

  const numero = ipv4ParaNumero(limpo)
  if (numero === null) {
    // Não é IP: é nome de host, e quem decide é a validação pós-DNS.
    return false
  }

  return FAIXAS_IPV4_BLOQUEADAS.some(([base, bits]) => {
    const baseNumero = ipv4ParaNumero(base)
    if (baseNumero === null) return false
    const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (numero & mascara) === (baseNumero & mascara)
  })
}

export type ResultadoDestino = { valida: true; url: URL } | { valida: false; motivo: string }

/** Nomes que sempre apontam para a própria máquina, sem precisar de DNS. */
const HOSTS_LOCAIS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost'])

/**
 * Valida a URL cadastrada pelo cliente, antes de qualquer requisição.
 *
 * Exige HTTPS: o corpo carrega dados do envio e a assinatura, e em texto
 * claro os dois vão para qualquer intermediário no caminho.
 */
export function validarUrlDestino(valor: string): ResultadoDestino {
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return { valida: false, motivo: 'URL inválida.' }
  }

  if (url.protocol !== 'https:') {
    return { valida: false, motivo: 'A URL precisa usar https.' }
  }

  if (url.username !== '' || url.password !== '') {
    return { valida: false, motivo: 'A URL não pode conter usuário e senha.' }
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (HOSTS_LOCAIS.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { valida: false, motivo: 'Destino em rede interna não é permitido.' }
  }

  if (ehIpPrivado(host)) {
    return { valida: false, motivo: 'Destino em rede interna não é permitido.' }
  }

  return { valida: true, url }
}

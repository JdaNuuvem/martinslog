/**
 * Gera `geo-br.conf` — o mapa de faixas brasileiras que o nginx consulta.
 *
 * Usa a mesma fonte do app (base de geolocalização do DB-IP, publicada
 * mensalmente em CSV sem chave de acesso), para que as duas metades do site
 * concordem sobre quem é brasileiro. Fontes diferentes deixariam um visitante
 * entrar na landing e ser barrado no painel, ou o contrário.
 *
 * NÃO usa o registro do LACNIC. Foi a primeira tentativa no app e reprovou o
 * próprio servidor da Martins Log, em Campinas: registro de alocação diz a quem
 * o bloco foi entregue, não onde ele é usado.
 *
 * O nginx precisa de CIDR, não de intervalo — então cada faixa é decomposta nos
 * maiores blocos alinhados que couberem dentro dela.
 *
 * Uso:
 *   node scripts/gerar-geo-br.mjs            # baixa o mês corrente
 *   node scripts/gerar-geo-br.mjs arquivo.csv
 */
import fs from 'fs'
import { execSync } from 'child_process'

const SAIDA = 'geo-br.conf'

function paraInteiro(ip) {
  const p = ip.split('.')
  if (p.length !== 4) return null
  let v = 0
  for (const parte of p) {
    const o = Number(parte)
    if (!Number.isInteger(o) || o < 0 || o > 255) return null
    v = v * 256 + o
  }
  return v
}

function paraTexto(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** Decompõe [inicio, fim] nos maiores blocos CIDR alinhados que couberem. */
function paraCidrs(inicio, fim) {
  const saida = []
  let atual = inicio

  while (atual <= fim) {
    // O maior bloco que começa em `atual` sem passar do alinhamento dele.
    let tamanho = 32
    while (tamanho > 0) {
      const candidato = tamanho - 1
      const bloco = 2 ** (32 - candidato)
      if (atual % bloco !== 0 || atual + bloco - 1 > fim) break
      tamanho = candidato
    }
    saida.push(`${paraTexto(atual)}/${tamanho}`)
    atual += 2 ** (32 - tamanho)
  }

  return saida
}

function baixar() {
  const mes = new Date().toISOString().slice(0, 7)
  const url = `https://download.db-ip.com/free/dbip-country-lite-${mes}.csv.gz`
  const tmp = `dbip-${mes}.csv`
  console.log(`  baixando ${url}`)
  execSync(`curl -sS -m 300 "${url}" | gunzip -c > "${tmp}"`, { stdio: 'inherit', shell: true })
  return tmp
}

const arquivo = process.argv[2] ?? baixar()
const linhas = fs.readFileSync(arquivo, 'utf8').split('\n')

const brutas = []
for (const linha of linhas) {
  if (!linha.endsWith(',BR')) continue
  const p = linha.split(',')
  if (p.length !== 3 || p[0].includes(':')) continue
  const a = paraInteiro(p[0])
  const b = paraInteiro(p[1])
  if (a === null || b === null || b < a) continue
  brutas.push([a, b])
}

brutas.sort((x, y) => x[0] - y[0])

const faixas = []
for (const [ini, fim] of brutas) {
  const ultima = faixas[faixas.length - 1]
  if (ultima && ini <= ultima[1] + 1) {
    if (fim > ultima[1]) ultima[1] = fim
  } else {
    faixas.push([ini, fim])
  }
}

const cidrs = faixas.flatMap(([i, f]) => paraCidrs(i, f))

console.log(`  faixas fundidas: ${faixas.length}`)
console.log(`  blocos CIDR:     ${cidrs.length}`)

if (cidrs.length < 5000) {
  /*
    Guarda contra o pior acidente: gerar um mapa curto a partir de um CSV
    truncado e fechar o site para o Brasil inteiro. Preferir não gravar nada a
    gravar uma lista incompleta — o nginx aceitaria as duas sem reclamar.
  */
  console.error(`\n  ERRO: só ${cidrs.length} blocos. Esperado mais de 5000.`)
  console.error('  O arquivo de origem provavelmente veio incompleto. Nada foi gravado.')
  process.exit(1)
}

const conteudo = [
  '# Faixas de IPv4 do Brasil, da base de geolocalização do DB-IP.',
  '# Geradas por scripts/gerar-geo-br.mjs — não editar à mão.',
  '# Regerar mensalmente: a base muda e IP muda de país.',
  '#',
  '# `default fora` é deliberado e importante: endereço que a base não conhece',
  '# é tratado como estrangeiro. Quem quiser o contrário troca aqui — mas leia',
  '# antes o comentário do nginx.conf sobre o que acontece sem cabeçalho de IP.',
  'geo $pais_visitante {',
  '  default fora;',
  '  # Rede interna e laço local não têm país: é por eles que a verificação de',
  '  # saúde do próprio servidor chega, e derrubá-la derruba o site.',
  '  127.0.0.0/8 br;',
  '  10.0.0.0/8 br;',
  '  172.16.0.0/12 br;',
  '  192.168.0.0/16 br;',
  '  169.254.0.0/16 br;',
  '  # Rede compartilhada de operadora (CGNAT). Muita operadora móvel brasileira',
  '  # entrega o cliente por aqui.',
  '  100.64.0.0/10 br;',
  ...cidrs.map((c) => `  ${c} br;`),
  '}',
  '',
].join('\n')

fs.writeFileSync(SAIDA, conteudo)
console.log(`  gravado: ${SAIDA} (${(conteudo.length / 1024).toFixed(0)} KB)`)

/**
 * Gera a lista de faixas de IP do Brasil a partir da base do DB-IP.
 *
 * POR QUE NÃO O LACNIC. A primeira versão usava o registro do LACNIC, que é a
 * fonte autoritativa de ALOCAÇÃO. Não serve aqui: o registro diz a quem o bloco
 * foi entregue, e onde ele é usado pode ser outro país. Transferências entre
 * operadoras também não aparecem.
 *
 * O defeito apareceu no primeiro teste: o servidor da própria Martins Log, em
 * Campinas, ficava FORA da lista. A faixa vizinha constava como brasileira, a
 * nossa não. Um bloqueio construído assim barraria tráfego brasileiro legítimo
 * e ninguém saberia — o visitante simplesmente vai embora.
 *
 * O DB-IP publica geolocalização por país mensalmente, em CSV, sem chave de
 * acesso e sob licença que permite uso comercial com atribuição.
 *
 * A saída é um MÓDULO TypeScript, não um arquivo de dados: o middleware do
 * Next.js roda no runtime Edge, onde `fs` não existe, e o lint do projeto
 * proíbe importar `fs` — com razão, porque um bloqueio que depende de leitura
 * de disco falha de forma diferente em cada ambiente.
 *
 * Uso:
 *   node scripts/gerar-faixas-br.mjs            # baixa o mês corrente
 *   node scripts/gerar-faixas-br.mjs arquivo.csv
 */
import fs from 'fs'
import { execSync } from 'child_process'

const SAIDA = 'src/domain/geo/faixas-br.ts'

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
  // formato: primeiro_ip,ultimo_ip,PAIS
  if (!linha.endsWith(',BR')) continue
  const p = linha.split(',')
  if (p.length !== 3) continue
  // Só IPv4: a lista de IPv6 é enorme e o proxy entrega IPv4 mapeado.
  if (p[0].includes(':')) continue
  const a = paraInteiro(p[0])
  const b = paraInteiro(p[1])
  if (a === null || b === null || b < a) continue
  brutas.push([a, b])
}

brutas.sort((x, y) => x[0] - y[0])

/*
  Funde faixas adjacentes ou sobrepostas. Além de encurtar a busca binária,
  elimina o caso em que uma faixa termina exatamente onde a próxima começa e um
  IP legítimo cairia na fresta entre as duas.
*/
const faixas = []
for (const [ini, fim] of brutas) {
  const ultima = faixas[faixas.length - 1]
  if (ultima && ini <= ultima[1] + 1) {
    if (fim > ultima[1]) ultima[1] = fim
  } else {
    faixas.push([ini, fim])
  }
}

const total = faixas.reduce((s, [i, f]) => s + (f - i + 1), 0)
console.log(`  faixas no CSV:      ${brutas.length}`)
console.log(`  faixas fundidas:    ${faixas.length}`)
console.log(`  endereços cobertos: ${total.toLocaleString('pt-BR')}`)

if (faixas.length < 3000) {
  // Guarda contra o pior acidente possível: gerar uma lista curta ou vazia a
  // partir de um CSV truncado, e fechar o site para o Brasil inteiro.
  console.error(`\n  ERRO: só ${faixas.length} faixas. Esperado mais de 3000.`)
  console.error('  O arquivo de origem provavelmente veio incompleto. Nada foi gravado.')
  process.exit(1)
}

const CABECALHO = [
  '/**',
  ' * Faixas de IPv4 do Brasil, geradas por `scripts/gerar-faixas-br.mjs` a partir',
  ' * da base de geolocalização do DB-IP. NÃO EDITAR À MÃO.',
  ' *',
  ' * Vai como módulo, e não como arquivo lido do disco, porque o middleware do',
  ' * Next.js roda no runtime Edge — onde `fs` não existe.',
  ' *',
  ' * Formato: uma linha por faixa, `primeiro,ultimo` em inteiro de 32 bits.',
  ` * ${faixas.length} faixas. Regerar mensalmente: a base muda e IP muda de país.`,
  ' */',
].join('\n')

const corpo = faixas.map(([i, f]) => `${i},${f}`).join('\n')
const conteudo = `${CABECALHO}\nexport const FAIXAS_BR = \`${corpo}\`\n`

fs.writeFileSync(SAIDA, conteudo)
console.log(`  gravado: ${SAIDA} (${(conteudo.length / 1024).toFixed(0)} KB)`)

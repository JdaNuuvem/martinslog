/**
 * Audita TODOS os códigos de rastreio: nenhum comprador pode receber um link
 * que não abre.
 *
 * Três portões, na ordem em que a rota pública os aplica — porque um código
 * pode existir no banco e mesmo assim devolver "não encontramos":
 *
 *  1. FORMATO e DÍGITO VERIFICADOR. `codigoRastreioSchema` recusa antes de
 *     qualquer consulta. Código com dígito errado nunca chega ao banco.
 *  2. EXISTÊNCIA do envio com aquele código.
 *  3. LINHA DO TEMPO com pelo menos um evento já vencido — sem isso a página
 *     abre vazia, que para o comprador é o mesmo que não funcionar.
 *
 * Confere os códigos vindos das DUAS pontas: os que a plataforma emitiu e os
 * que a loja mostra ao comprador. A segunda lista é a que importa de verdade,
 * porque é dela que saem os links já enviados por SMS e e-mail.
 */
import { readFileSync } from 'fs'
import { prisma } from '../src/infra/db/client'
import { validarCodigoRastreio } from '../src/domain/shipment/codigo-rastreio'
import { ehCodigoSandbox } from '../src/domain/shipment/codigo-rastreio'

const CAMINHO_PARES =
  'C:/Users/diazz/AppData/Local/Temp/claude/C--Users-diazz/9925e768-4e79-419e-9c68-aabe58671185/scratchpad/todos-codigos.json'

type Par = { codigo: string; origem: string }

async function main() {
  const daLoja: Par[] = JSON.parse(readFileSync(CAMINHO_PARES, 'utf8'))

  const daPlataforma = await prisma.shipment.findMany({
    where: { codigoRastreio: { not: null } },
    select: { codigoRastreio: true, referenciaExterna: true, status: true },
  })

  const agora = new Date()
  const comEvento = new Set(
    (
      await prisma.$queryRaw<Array<{ codigo: string }>>`
        SELECT DISTINCT s."codigoRastreio" AS codigo
        FROM shipments s
        JOIN tracking_events e ON e."shipmentId" = s.id AND e."ocorridoEm" <= ${agora}
        WHERE s."codigoRastreio" IS NOT NULL`
    ).map((x) => x.codigo),
  )

  const existentes = new Set(daPlataforma.map((s) => s.codigoRastreio!))

  const todos = new Map<string, string>()
  for (const s of daPlataforma) todos.set(s.codigoRastreio!, 'plataforma')
  for (const p of daLoja) if (!todos.has(p.codigo)) todos.set(p.codigo, `loja:${p.origem}`)

  const digitoRuim: string[] = []
  const naoExiste: string[] = []
  const semEvento: string[] = []
  let sandbox = 0
  let ok = 0

  for (const [codigo, origem] of todos) {
    if (ehCodigoSandbox(codigo)) { sandbox++; continue }
    if (!validarCodigoRastreio(codigo)) { digitoRuim.push(`${codigo} (${origem})`); continue }
    if (!existentes.has(codigo)) { naoExiste.push(`${codigo} (${origem})`); continue }
    if (!comEvento.has(codigo)) { semEvento.push(`${codigo} (${origem})`); continue }
    ok++
  }

  console.log(`=== ${todos.size} códigos auditados (plataforma + lojas)`)
  console.log(`   abrem normalmente:              ${ok}`)
  console.log(`   sandbox (sem rastreio público): ${sandbox}`)
  console.log(`   DÍGITO VERIFICADOR INVÁLIDO:    ${digitoRuim.length}`)
  console.log(`   ENVIO NÃO EXISTE:               ${naoExiste.length}`)
  console.log(`   SEM NENHUM EVENTO VENCIDO:      ${semEvento.length}`)
  for (const x of digitoRuim.slice(0, 10)) console.log(`     digito: ${x}`)
  for (const x of naoExiste.slice(0, 10)) console.log(`     ausente: ${x}`)
  for (const x of semEvento.slice(0, 10)) console.log(`     sem evento: ${x}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

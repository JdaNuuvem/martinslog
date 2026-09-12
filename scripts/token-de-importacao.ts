/**
 * Cria um token de API por loja, dedicado à importação de histórico.
 *
 * A cota da API pública é de 60 chamadas por minuto POR TOKEN. Importar
 * cinco mil pedidos pelo token que as lojas usam ao vivo consumiria essa
 * cota inteira por uma hora e meia, e cada checkout real feito nesse período
 * levaria 429 — a importação do passado derrubando a venda do presente.
 *
 * Um token separado tem balde separado. É a diferença entre uma importação
 * que ninguém percebe e uma que custa vendas.
 *
 * Imprime o valor em claro uma única vez, porque só o hash é guardado.
 * Revogue depois de usar: `npx tsx scripts/token-de-importacao.ts --revogar`.
 */
import { createHash, randomBytes } from 'crypto'
import { prisma } from '../src/infra/db/client'

const NOME = 'importacao-historico'
const revogar = process.argv.includes('--revogar')

async function main() {
  if (revogar) {
    const { count } = await prisma.apiToken.updateMany({
      where: { nome: NOME, revogadoEm: null },
      data: { revogadoEm: new Date() },
    })
    console.log(`${count} tokens de importação revogados`)
    return
  }

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, userId: true } })

  for (const perfil of perfis) {
    const existente = await prisma.apiToken.findFirst({
      where: { perfilId: perfil.id, nome: NOME, revogadoEm: null },
    })
    if (existente) {
      // O valor em claro não volta — quem perdeu o token revoga e cria outro.
      console.log(`${perfil.nome}\tJA_EXISTE (revogue para gerar outro)`)
      continue
    }

    const claro = `frete_live_${randomBytes(32).toString('hex')}`
    await prisma.apiToken.create({
      data: {
        userId: perfil.userId,
        perfilId: perfil.id,
        nome: NOME,
        tokenHash: createHash('sha256').update(claro).digest('hex'),
        ambiente: 'PRODUCAO',
      },
    })
    console.log(`${perfil.nome}\t${claro}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

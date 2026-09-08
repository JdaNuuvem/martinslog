/**
 * Dá a cada loja o texto de mensagem que ela não tem.
 *
 * O texto é por loja, e uma loja sem texto ativo não é uma loja que manda
 * mensagem feia: é uma loja que não manda mensagem nenhuma. O comprador paga,
 * o envio nasce, a fila procura o que dizer, não acha, e desiste em silêncio —
 * o único sintoma é uma linha a menos no painel, que ninguém vai procurar.
 *
 * A `bruteforce` subiu assim na máquina nova. São poucos pedidos, e é
 * exatamente por isso que ninguém perceberia.
 *
 * O texto copia o das outras três, palavra por palavra: `{{loja}}` já resolve
 * para o nome de exibição de cada uma, então uma frase serve às quatro sem
 * ninguém se passar por ninguém.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/texto-que-falta.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'

const aplicar = process.argv.includes('--aplicar')

async function main() {
  const modelo = await prisma.mensagemTemplate.findFirst({
    where: { ativo: true, canal: 'SMS', evento: 'PEDIDO_PAGO' },
    select: { canal: true, evento: true, previa: true, nome: true, idioma: true, variaveis: true },
  })

  if (!modelo) {
    console.error('Nenhum texto ativo para copiar. Configure o primeiro pelo painel.')
    process.exit(1)
  }

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })

  for (const perfil of perfis) {
    const tem = await prisma.mensagemTemplate.count({ where: { perfilId: perfil.id, ativo: true } })
    if (tem > 0) {
      console.log(`${perfil.nome}: já tem ${tem}`)
      continue
    }

    console.log(`${perfil.nome}: SEM texto — ${aplicar ? 'copiando' : 'copiaria'} o das outras`)
    if (!aplicar) continue

    await prisma.mensagemTemplate.create({
      data: {
        perfilId: perfil.id,
        canal: modelo.canal,
        evento: modelo.evento,
        nome: modelo.nome,
        idioma: modelo.idioma,
        variaveis: modelo.variaveis as never,
        previa: modelo.previa,
        ativo: true,
      },
    })
    console.log(`   ${modelo.previa}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

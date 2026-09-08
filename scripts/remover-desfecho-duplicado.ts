/**
 * Remove o desfecho duplicado na linha do tempo.
 *
 * `consertar-template-de-rastreio.ts` acrescenta "saiu para entrega" e
 * "entregue" ao fim de quem não tem desfecho. Duas execuções dele correram
 * ao mesmo tempo — a primeira estourou o tempo do terminal e continuou viva
 * em segundo plano enquanto a segunda começava — e cada uma leu a lista antes
 * de a outra gravar. Quem estava nas duas leituras recebeu o par duas vezes.
 *
 * Na tela isso é o comprador vendo "Objeto entregue ao destinatário", e três
 * dias depois "Objeto saiu para entrega" de novo, seguido de outra entrega.
 *
 * Fica o PRIMEIRO desfecho: é o mais próximo do percurso previsto e é o que o
 * comprador pode já ter visto. Some tudo que vier depois dele — o que vem
 * depois de uma entrega não é história, é ruído.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/remover-desfecho-duplicado.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'

const aplicar = process.argv.includes('--aplicar')

async function main() {
  const repetidos = await prisma.$queryRaw<Array<{ shipmentId: string; n: bigint }>>`
    SELECT "shipmentId", COUNT(*) AS n FROM tracking_events
    WHERE codigo = 'ENTREGUE' GROUP BY 1 HAVING COUNT(*) > 1`

  console.log(`${repetidos.length} envios com mais de um desfecho`)

  let removidos = 0
  for (const r of repetidos) {
    const entregas = await prisma.trackingEvent.findMany({
      where: { shipmentId: r.shipmentId, codigo: 'ENTREGUE' },
      orderBy: { sequencia: 'asc' },
      select: { sequencia: true },
    })

    const primeira = entregas[0]!.sequencia

    // Tudo acima da primeira entrega: o par extra inteiro, não só a entrega.
    const sobrando = await prisma.trackingEvent.findMany({
      where: { shipmentId: r.shipmentId, sequencia: { gt: primeira } },
      select: { id: true, sequencia: true, codigo: true },
      orderBy: { sequencia: 'asc' },
    })

    console.log(`  ${r.shipmentId}: entrega em ${primeira}; sobram ${sobrando.map((x) => `${x.sequencia}:${x.codigo}`).join(' ')}`)

    if (aplicar && sobrando.length) {
      const { count } = await prisma.trackingEvent.deleteMany({
        where: { id: { in: sobrando.map((x) => x.id) } },
      })
      removidos += count
    }
  }

  console.log(aplicar ? `${removidos} eventos removidos` : '(simulação — passe --aplicar)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

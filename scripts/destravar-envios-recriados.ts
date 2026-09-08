/**
 * Conserta os envios recriados na migração: eles estavam com o status
 * congelado e nunca mais avançariam.
 *
 * `regerar-linha-do-tempo.ts` gravou no envio o status DERIVADO do último
 * evento já vencido (POSTED, DELIVERED). A emissão de verdade nunca faz isso:
 * ela grava sempre `GENERATED` e deixa `sincronizarEnvio` andar.
 *
 * A diferença é fatal por causa da máquina de estados. `sincronizarEnvio`
 * percorre os eventos desde a sequência 1, e o primeiro é sempre
 * `ETIQUETA_EMITIDA`, que traduz para `GENERATED`. Num envio normal o status
 * persistido também é `GENERATED`, então a primeira volta cai no `continue` e
 * o laço segue. Num envio marcado `POSTED`, a transição `POSTED → GENERATED`
 * não existe (`estados.ts`: `POSTED: ['DELIVERED','LOST']`) e o laço faz
 * `break` no PRIMEIRO evento — todas as voltas seguintes, inclusive a que
 * entregaria o pacote, ficam inalcançáveis. O envio congela em POSTED para
 * sempre.
 *
 * O estrago não aparece na página do comprador, que deriva o que mostrar do
 * último evento visível. Aparece onde ninguém olha: `entregueEm` nunca é
 * preenchido, os webhooks `order.posted` e `order.delivered` nunca são
 * enfileirados — e a loja, que espelha o rastreio pelo webhook, segue
 * mostrando em trânsito um pacote entregue. Era exatamente o problema que a
 * migração veio resolver.
 *
 * Aqui os envios voltam ao estado em que a emissão os deixaria, e o relógio
 * volta a movê-los sozinho:
 *
 *  - `status` = GENERATED, como a emissão grava;
 *  - `postadoEm`/`entregueEm`/`devolvidoEm` = nulos, porque quem os preenche é
 *    `datasDoStatus`, no passo em que o status muda de verdade;
 *  - `simulacaoIniciadaEm` e `fatorSimulacao` preenchidos — o script anterior
 *    os deixou nulos, e sem eles o envio some de "reaplicar template", recusa
 *    troca de cenário ("ainda não teve a etiqueta emitida") e calcula offset
 *    zero ao forçar uma etapa.
 *
 * A linha do tempo NÃO é tocada: ela está correta, ancorada na data original,
 * e é imutável depois de gravada porque o comprador já a viu.
 *
 * Envio CANCELLED fica de fora: cancelamento é decisão, não atraso de relógio,
 * e ressuscitá-lo faria um pedido cancelado voltar a "chegando".
 *
 * Uso: DATABASE_URL=… npx tsx scripts/destravar-envios-recriados.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'

const aplicar = process.argv.includes('--aplicar')

async function main() {
  /*
    A marca dos recriados é `simulacaoIniciadaEm` nulo com linha do tempo
    presente: a emissão real sempre grava o campo, então nenhum envio nascido
    pelo caminho normal entra aqui. Mais confiável do que filtrar por data.
  */
  const alvos = await prisma.shipment.findMany({
    where: {
      simulacaoIniciadaEm: null,
      codigoRastreio: { not: null },
      status: { not: 'CANCELLED' },
      trackingEvents: { some: {} },
    },
    select: { id: true, status: true, criadoEm: true },
  })

  const porStatus: Record<string, number> = {}
  for (const e of alvos) porStatus[e.status] = (porStatus[e.status] ?? 0) + 1

  console.log(`${alvos.length} envios recriados, congelados no status:`)
  console.log(' ', Object.entries(porStatus).map(([k, v]) => `${k}=${v}`).join(' '))

  if (!aplicar) {
    console.log('(simulação — passe --aplicar)')
    return
  }

  let feitos = 0
  for (const envio of alvos) {
    await prisma.shipment.update({
      where: { id: envio.id },
      data: {
        status: 'GENERATED',
        geradoEm: envio.criadoEm,
        // A âncora que `regerar-linha-do-tempo.ts` usou para datar os eventos.
        // Ela precisa estar gravada, senão os offsets não têm origem.
        simulacaoIniciadaEm: envio.criadoEm,
        fatorSimulacao: 1,
        postadoEm: null,
        entregueEm: null,
        devolvidoEm: null,
      },
    })
    feitos++
    if (feitos % 200 === 0) console.log(`   … ${feitos}`)
  }

  console.log(`${feitos} destravados. O status volta a andar sozinho na sincronização.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

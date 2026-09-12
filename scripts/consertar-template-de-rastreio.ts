/**
 * Conserta o template de rastreio e as linhas do tempo que ele produziu.
 *
 * O template ativo usa códigos que o gerador conhece (`TRANSFERENCIA_FILIAL`,
 * `TENTATIVA_ENTREGA_1..5`) mas que o motor de sincronização **não sabe
 * traduzir** para um estado de envio: eles não estão em `STATUS_POR_CODIGO`, e
 * os dois caminhos que chamam `sincronizarEnvio` não passam mapa de tradução.
 * Ao chegar no primeiro deles, a varredura para. Efeito medido: 1.900 envios
 * congelados, `order.delivered` nunca enfileirado, e a loja — que espelha o
 * rastreio pelo webhook — parada para sempre.
 *
 * Além disso o template terminava em "3ª tentativa de entrega". Sem etapa de
 * entrega, nenhum envio podia alcançar `DELIVERED`, e o comprador terminava a
 * história vendo uma entrega frustrada.
 *
 * Duas correções, nenhuma delas mudando UMA PALAVRA do que o comprador lê:
 *
 *  1. **Código traduzível, título intacto.** `TRANSFERENCIA_FILIAL` vira
 *     `TRANSFERENCIA` e `TENTATIVA_ENTREGA_*` vira `TENTATIVA_FRUSTRADA` —
 *     mesmo significado, ambos mapeados para `POSTED`. O que aparece na tela é
 *     `titulo`/`descricao`, que não são tocados: continua "Transferência entre
 *     filiais" e "1ª tentativa de entrega". O gerador também continua achando
 *     a fase de entrega, porque `TENTATIVA_FRUSTRADA` está na lista que ele
 *     usa para decidir em que cidade cada etapa acontece.
 *
 *  2. **Final que existe.** Duas etapas no fim: "Saiu para entrega" e
 *     "Entregue". São ACRESCENTADAS ao que já está gravado, nunca reescritas —
 *     `reaplicarTemplate` apagaria a linha do tempo inteira e mudaria datas que
 *     o comprador já viu, que é justamente o que não se pode fazer.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/consertar-template-de-rastreio.ts [--aplicar]
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/infra/db/client'

const aplicar = process.argv.includes('--aplicar')

/** Código intraduzível → equivalente que o motor entende. Título não muda. */
const EQUIVALENTE: Record<string, string> = {
  TRANSFERENCIA_FILIAL: 'TRANSFERENCIA',
  TENTATIVA_ENTREGA_1: 'TENTATIVA_FRUSTRADA',
  TENTATIVA_ENTREGA_2: 'TENTATIVA_FRUSTRADA',
  TENTATIVA_ENTREGA_3: 'TENTATIVA_FRUSTRADA',
  TENTATIVA_ENTREGA_4: 'TENTATIVA_FRUSTRADA',
  TENTATIVA_ENTREGA_5: 'TENTATIVA_FRUSTRADA',
  AGUARDANDO_TRIBUTO: 'AGUARDANDO_TRATAMENTO',
  TAXA_ALFANDEGA: 'AGUARDANDO_TRATAMENTO',
}

const FINAL = [
  {
    codigo: 'SAIU_PARA_ENTREGA',
    titulo: 'Objeto saiu para entrega ao destinatário',
    descricao: 'Objeto saiu para entrega ao destinatário',
  },
  {
    codigo: 'ENTREGUE',
    titulo: 'Objeto entregue ao destinatário',
    descricao: 'Objeto entregue ao destinatário',
  },
]

const UM_DIA_MS = 24 * 60 * 60 * 1000

async function corrigirTemplate() {
  const template = await prisma.rastreioTemplate.findFirst({ where: { ativo: true } })
  if (!template) {
    console.log('[template] nenhum ativo — nada a fazer')
    return
  }

  const passos = template.passos as Array<Record<string, unknown>>
  const jaTemEntrega = passos.some((p) => p.codigo === 'ENTREGUE')

  const novos = passos.map((p) => {
    const equivalente = EQUIVALENTE[String(p.codigo)]
    return equivalente ? { ...p, codigo: equivalente } : p
  })

  if (!jaTemEntrega) {
    for (const etapa of FINAL) {
      novos.push({
        id: `no-${Date.now()}-${etapa.codigo.toLowerCase()}`,
        tipo: 'ETAPA',
        codigo: etapa.codigo,
        titulo: etapa.titulo,
        descricao: etapa.descricao,
        diasAposAnterior: 1,
      })
    }
  }

  const trocados = passos.filter((p) => EQUIVALENTE[String(p.codigo)]).length
  console.log(`[template] ${passos.length} passos: ${trocados} com código intraduzível, entrega no fim: ${jaTemEntrega ? 'já tinha' : 'ACRESCENTADA'}`)

  if (!aplicar) return
  await prisma.rastreioTemplate.update({ where: { id: template.id }, data: { passos: novos as unknown as Prisma.InputJsonValue } })
  console.log(`[template] atualizado para ${novos.length} passos`)
}

async function corrigirEventos() {
  const codigos = Object.keys(EQUIVALENTE)

  const quantos = await prisma.trackingEvent.count({ where: { codigo: { in: codigos } } })
  console.log(`[eventos] ${quantos} eventos com código intraduzível`)
  if (aplicar) {
    for (const [de, para] of Object.entries(EQUIVALENTE)) {
      const { count } = await prisma.trackingEvent.updateMany({
        where: { codigo: de },
        // `status` também: a coluna guardava uma cópia do código, e deixá-la
        // com o valor antigo faria o histórico contar duas versões do mesmo
        // evento.
        data: { codigo: para, status: para },
      })
      if (count) console.log(`[eventos] ${de} → ${para}: ${count}`)
    }
  }
}

async function completarLinhasDoTempo() {
  /*
    Só envios cuja linha do tempo NÃO chega a uma etapa terminal. Acrescentar
    "entregue" depois de "entregue" duplicaria o desfecho na tela de quem já
    recebeu.
  */
  const envios = await prisma.shipment.findMany({
    where: {
      codigoRastreio: { not: null },
      trackingEvents: { some: {}, none: { codigo: { in: ['ENTREGUE', 'DEVOLVIDO', 'EXTRAVIADO'] } } },
    },
    select: {
      id: true,
      destinatario: true,
      trackingEvents: {
        orderBy: { sequencia: 'desc' },
        take: 1,
        select: { sequencia: true, offsetMinutos: true, ocorridoEm: true, cidade: true, uf: true },
      },
    },
  })

  console.log(`[linhas] ${envios.length} envios sem desfecho na linha do tempo`)
  if (!aplicar) return

  let feitos = 0
  for (const envio of envios) {
    const ultimo = envio.trackingEvents[0]
    if (!ultimo) continue

    const destino = envio.destinatario as { cidade?: string; uf?: string } | null

    await prisma.trackingEvent.createMany({
      data: FINAL.map((etapa, i) => ({
        shipmentId: envio.id,
        sequencia: ultimo.sequencia + i + 1,
        offsetMinutos: ultimo.offsetMinutos + (i + 1) * 1440,
        codigo: etapa.codigo,
        status: etapa.codigo,
        titulo: etapa.titulo,
        descricao: etapa.descricao,
        unidadeOrigem: null,
        unidadeDestino: null,
        // A entrega acontece na cidade de quem recebe, não na última escala.
        cidade: destino?.cidade ?? ultimo.cidade,
        uf: destino?.uf ?? ultimo.uf,
        ocorridoEm: new Date(ultimo.ocorridoEm.getTime() + (i + 1) * UM_DIA_MS),
      })),
      skipDuplicates: true,
    })

    feitos++
    if (feitos % 250 === 0) console.log(`[linhas] … ${feitos}`)
  }

  console.log(`[linhas] ${feitos} completadas`)
}

async function main() {
  console.log(aplicar ? '=== APLICANDO ===' : '=== simulação ===')
  await corrigirTemplate()
  await corrigirEventos()
  await completarLinhasDoTempo()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

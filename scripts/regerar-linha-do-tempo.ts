/**
 * Gera a linha do tempo dos envios que foram recriados sem ela.
 *
 * Os envios da migração de servidor nasceram de um `INSERT` direto, para
 * preservar o código de rastreio que mil e duzentos compradores já receberam
 * por SMS e e-mail. O `INSERT` trouxe o código, mas não a linha do tempo — que
 * na emissão normal é materializada inteira, com os eventos já datados no
 * futuro, e não existe fora dela. O comprador abria o link, via o código e
 * nenhuma história.
 *
 * A âncora é a data ORIGINAL do envio, não agora. Ancorar em `now` faria todo
 * pacote — inclusive o postado há três semanas — recomeçar em "etiqueta
 * emitida", e a linha do tempo do comprador andaria para trás. Ancorada na
 * data original, ela reproduz exatamente o percurso que a plataforma teria
 * produzido se nada tivesse se perdido: os eventos já vencidos aparecem, os
 * futuros continuam no futuro, e `sincronizarEnvio` move o status sozinho na
 * primeira consulta.
 *
 * Por isso mesmo o status vindo da loja é DESCARTADO aqui. Ele era um palpite
 * feito na exportação; o motor é a fonte da verdade, e é dele que a loja
 * copiou o status em primeiro lugar.
 *
 * Só toca em envio SEM nenhum evento: repetir é seguro, e um envio que já tem
 * linha do tempo é deixado exatamente como está — ela é imutável depois de
 * gravada, porque o cliente já a viu.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/regerar-linha-do-tempo.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'
import { calcularOcorridoEm, gerarRoteiro, statusDoEvento } from '../src/domain/simulacao/roteiro'
import { catalogoDoUsuario } from '../src/server/status-rastreio-service'
import type { LocalidadeSimulacao } from '../src/domain/simulacao/tipos'
import type { StatusShipment } from '../src/domain/shipment/estados'

const aplicar = process.argv.includes('--aplicar')

function localidade(endereco: unknown): LocalidadeSimulacao | null {
  const registro = endereco as { cidade?: unknown; uf?: unknown } | null
  if (typeof registro?.cidade !== 'string' || typeof registro?.uf !== 'string') return null
  if (!registro.cidade.trim() || !registro.uf.trim()) return null
  return { cidade: registro.cidade, uf: registro.uf }
}

async function main() {
  const semEventos = await prisma.shipment.findMany({
    where: { codigoRastreio: { not: null }, trackingEvents: { none: {} } },
    select: {
      id: true,
      userId: true,
      codigoRastreio: true,
      cenario: true,
      criadoEm: true,
      remetente: true,
      destinatario: true,
      service: { select: { prazoBase: true } },
    },
    orderBy: { criadoEm: 'asc' },
  })

  console.log(`${semEventos.length} envios com código e sem linha do tempo`)
  if (semEventos.length === 0) return

  // O catálogo é por conta e a migração trouxe tudo para uma só: ler uma vez
  // evita 1.250 idas ao banco para receber a mesma resposta.
  const catalogos = new Map<string, Awaited<ReturnType<typeof catalogoDoUsuario>>>()

  const agora = new Date()
  let feitos = 0
  let semEndereco = 0
  const porStatus: Record<string, number> = {}

  for (const envio of semEventos) {
    const origem = localidade(envio.remetente)
    const destino = localidade(envio.destinatario)

    /*
      Sem cidade/UF não há rota, e inventar uma produziria um percurso por
      cidades onde o pacote nunca esteve. Estes ficam sem linha do tempo — o
      código continua respondendo, mostrando o status persistido, que é pouco
      mas é verdade.
    */
    if (!origem || !destino) {
      semEndereco++
      continue
    }

    if (!catalogos.has(envio.userId)) {
      catalogos.set(envio.userId, await catalogoDoUsuario(envio.userId))
    }
    const catalogo = catalogos.get(envio.userId)!

    const roteiro = gerarRoteiro({
      cenario: envio.cenario,
      prazoDias: envio.service.prazoBase,
      origem,
      destino,
      textos: catalogo.textos,
      etapasExtras: catalogo.etapasExtras,
      posicoesDias: catalogo.posicoesDias,
    })

    const eventos = roteiro.map((evento) => ({
      shipmentId: envio.id,
      sequencia: evento.sequencia,
      offsetMinutos: evento.offsetMinutos,
      codigo: evento.codigo,
      status: evento.codigo,
      titulo: evento.titulo,
      descricao: evento.descricao,
      unidadeOrigem: evento.unidadeOrigem,
      unidadeDestino: evento.unidadeDestino,
      cidade: evento.cidade,
      uf: evento.uf,
      // Fator 1: o tempo destes envios já correu de verdade, no relógio, e
      // acelerá-lo os empurraria para "entregue" antes da hora.
      ocorridoEm: calcularOcorridoEm(envio.criadoEm, evento.offsetMinutos, 1),
    }))

    // O último evento já vencido diz onde o pacote está hoje.
    const vencidos = eventos.filter((e) => e.ocorridoEm <= agora)
    const ultimo = vencidos[vencidos.length - 1]
    const status: StatusShipment = ultimo ? statusDoEvento(ultimo.codigo) : 'GENERATED'
    porStatus[status] = (porStatus[status] ?? 0) + 1

    if (aplicar) {
      await prisma.$transaction([
        prisma.trackingEvent.createMany({ data: eventos }),
        prisma.shipment.update({
          where: { id: envio.id },
          data: {
            status,
            geradoEm: envio.criadoEm,
            postadoEm: vencidos.find((e) => e.codigo === 'POSTADO')?.ocorridoEm ?? null,
            entregueEm: vencidos.find((e) => e.codigo === 'ENTREGUE')?.ocorridoEm ?? null,
          },
        }),
      ])
    }

    feitos++
    if (feitos % 200 === 0) console.log(`   … ${feitos}`)
  }

  console.log(aplicar ? `gerados: ${feitos}` : `gerariam: ${feitos} (simulação)`)
  console.log(`sem cidade/UF, deixados como estavam: ${semEndereco}`)
  console.log('status resultante:', porStatus)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

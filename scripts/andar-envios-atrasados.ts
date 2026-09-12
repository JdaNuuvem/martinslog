/**
 * Faz o relógio alcançar os envios recriados, num ritmo escolhido.
 *
 * Depois de `destravar-envios-recriados.ts` eles voltaram a `GENERATED` e o
 * relógio pode movê-los — mas quem move é `sincronizarEnvio`, e ele só roda
 * quando alguém consulta. Deixar por conta do acaso significa que os mil e
 * duzentos avançam todos de uma vez, no instante em que o painel abrir:
 * `sincronizarEnviosPendentesDoUsuario` varre a conta inteira numa
 * requisição. Seriam ~2.500 webhooks nascendo juntos, numa máquina de um
 * núcleo que atende checkout ao vivo.
 *
 * Aqui o mesmo trabalho acontece antes, devagar e observável. Cada envio abre
 * a transação dele, os eventos `order.posted` e `order.delivered` entram na
 * fila normal e o agendador entrega no ritmo dele.
 *
 * Chama a função de produção, não uma cópia: se `sincronizarEnvio` mudar, isto
 * muda junto. Copiar a lógica aqui é como se escreve o bug que só existe na
 * migração.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/andar-envios-atrasados.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'
import { sincronizarEnvio } from '../src/server/sincronizar-envio-service'

const aplicar = process.argv.includes('--aplicar')

/** Uma pausa curta entre envios: o banco atende checkout ao mesmo tempo. */
const PAUSA_MS = 120

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const atrasados = await prisma.shipment.findMany({
    where: {
      simulacaoIniciadaEm: { not: null },
      codigoRastreio: { not: null },
      status: { in: ['GENERATED', 'POSTED'] },
    },
    select: { id: true, codigoRastreio: true, status: true },
    orderBy: { criadoEm: 'asc' },
  })

  console.log(`${atrasados.length} envios que o relógio pode ter deixado para trás`)
  if (!aplicar) {
    console.log('(simulação — passe --aplicar)')
    return
  }

  const mudou: Record<string, number> = {}
  let iguais = 0
  let erros = 0

  for (const envio of atrasados) {
    try {
      const novo = await sincronizarEnvio(envio.id)
      if (novo === envio.status) iguais++
      else mudou[`${envio.status}→${novo}`] = (mudou[`${envio.status}→${novo}`] ?? 0) + 1
    } catch (erro) {
      erros++
      if (erros <= 3) console.log(`   ✗ ${envio.codigoRastreio}: ${(erro as Error).message?.slice(0, 100)}`)
    }
    await dormir(PAUSA_MS)
  }

  console.log('avançaram:', Object.entries(mudou).map(([k, v]) => `${k}=${v}`).join(' ') || 'nenhum')
  console.log(`já estavam em dia: ${iguais} | erros: ${erros}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

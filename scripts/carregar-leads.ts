/**
 * Porta de linha de comando da carga inicial da base de leads.
 *
 * A lógica mora em `src/server/carga-leads.ts`, com teste; este arquivo só lê a
 * flag, chama e relata.
 *
 * Variáveis OBRIGATÓRIAS no ambiente, e o `tsx` não lê `.env` sozinho:
 * - `DATABASE_URL` — o banco que vai receber os leads. Confira antes: rodar com
 *   `--aplicar` contra o banco errado grava leads nele.
 * - `LEAD_FINGERPRINT_KEY` — sem ela, toda aparição com CPF falha.
 * - `SECRET_ENCRYPTION_KEY` — sem ela, o CPF não pode ser cifrado.
 *
 * Sem `--aplicar`, só conta as aparições. Sai com código 1 se alguma falhar,
 * para que a carga incompleta não passe por completa num agendador ou num CI.
 *
 * Uso:
 *   DATABASE_URL=… LEAD_FINGERPRINT_KEY=… SECRET_ENCRYPTION_KEY=… npx tsx scripts/carregar-leads.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'
import { carregarLeads, coletarAparicoes } from '../src/server/carga-leads'

const aplicar = process.argv.includes('--aplicar')

async function principal(): Promise<void> {
  if (!aplicar) {
    const entradas = await coletarAparicoes()
    console.log(`${entradas.length} aparições encontradas. Simulação: rode com --aplicar para gravar.`)
    return
  }

  const { processadas, semChave, falhas } = await carregarLeads()
  const total = await prisma.lead.count()

  console.log(`Processadas: ${processadas}. Sem chave utilizável: ${semChave}. Falhas: ${falhas}.`)
  console.log(`Base com ${total} leads.`)

  if (falhas > 0) {
    console.error(
      'A carga ficou INCOMPLETA. Confira LEAD_FINGERPRINT_KEY e SECRET_ENCRYPTION_KEY ' +
        'e rode de novo — a carga é idempotente.',
    )
    process.exitCode = 1
  }
}

principal()
  .catch((erro) => {
    console.error(erro)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

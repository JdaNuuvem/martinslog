/**
 * Cadastra o webhook único que avisa a loja quando o pacote anda.
 *
 * A plataforma move o envio (postado, saiu para entrega, entregue) e a loja
 * espelha isso na página de acompanhamento do comprador. Sem este cadastro a
 * plataforma anda sozinha: o comprador que abre o rastreio pela loja vê o
 * pedido parado em "etiqueta emitida" para sempre, enquanto o pacote já foi
 * entregue. Foi o que estava acontecendo — a conta não tinha webhook nenhum.
 *
 * UM cadastro para as quatro lojas, de propósito. O disparo é por conta, e do
 * outro lado o `/api/ml/hook` descobre a loja pelo próprio evento, não pelo
 * domínio. Quatro cadastros com quatro segredos seria voltar ao desenho que
 * fazia o evento da PG cair no banco da Best Buy Tech.
 *
 * O segredo NÃO é gerado aqui: ele já existe do lado da loja, e inventar um
 * novo faria toda entrega voltar 401. Passe o mesmo valor que está em
 * `ml_config.webhook_secret` na plataforma da loja.
 *
 * Uso: DATABASE_URL=… npx tsx scripts/webhook-unico.ts <url> <segredo>
 */
import { prisma } from '../src/infra/db/client'
import { EVENTOS } from '../src/server/webhook-service'

const [url, segredo] = process.argv.slice(2) as (string | undefined)[]

if (!url || !segredo) {
  console.error('uso: npx tsx scripts/webhook-unico.ts <url> <segredo>')
  process.exit(1)
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({
    where: { papel: 'ADMIN' },
    select: { id: true, email: true },
  })

  const existente = await prisma.webhookApp.findFirst({ where: { userId: admin.id, url } })

  const dados = {
    url: url!,
    segredo: segredo!,
    eventos: [...EVENTOS],
    ativo: true,
    // Sem perfil: vale para a conta inteira, que é o que faz um cadastro só
    // cobrir as quatro lojas.
    perfilId: null,
  }

  const app = existente
    ? await prisma.webhookApp.update({ where: { id: existente.id }, data: dados })
    : await prisma.webhookApp.create({ data: { userId: admin.id, ...dados } })

  console.log(`${existente ? 'atualizado' : 'criado'}: ${app.url}`)
  console.log(`conta: ${admin.email}`)
  console.log(`eventos: ${EVENTOS.join(', ')}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

/**
 * Provisiona uma loja do Montador PRO na Martins Log, em um comando.
 *
 * Uma loja precisa de cinco coisas para funcionar de ponta a ponta, e faltar
 * qualquer uma delas produz o mesmo sintoma mudo — o comprador paga e não
 * recebe rastreio nenhum. Foi o que aconteceu com a FORCEBRUTE: 271 vendas
 * pagas, zero etiquetas, porque a loja nunca foi cadastrada aqui.
 *
 *   1. conta (isenta da taxa por etiqueta, como as outras lojas da casa)
 *   2. perfil, que é o que separa uma loja da outra no painel
 *   3. token de API preso a esse perfil
 *   4. destino de webhook — o endereço ÚNICO, com o segredo único
 *   5. texto do SMS de "pedido pago", copiado de uma loja que já funciona
 *
 * Repetir é seguro: cada passo procura antes de criar, e só o token nasce
 * novo a cada execução (o valor em claro existe uma vez só, então não há como
 * "reaproveitar" um token antigo — quem perdeu o valor precisa de outro).
 *
 * Uso:
 *   node scripts/provisionar-loja.mjs --email <email> --senha <senha> \
 *        --loja "NOME DA LOJA" --webhook <url> --segredo <hex> [--modelo <email de loja existente>]
 */
import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()

function arg(nome, obrigatorio = true) {
  const i = process.argv.indexOf(`--${nome}`)
  const valor = i >= 0 ? process.argv[i + 1] : undefined
  if (obrigatorio && !valor) {
    console.error(`Falta --${nome}`)
    process.exit(1)
  }
  return valor
}

/*
  Mesmos parâmetros de `src/server/auth/cadastro.ts`. Divergir aqui geraria uma
  conta que existe no banco e não consegue entrar — o pior tipo de defeito,
  porque só aparece na hora em que alguém precisa do acesso.
*/
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }

/** CPF válido qualquer, com dígitos verificadores certos. */
function cpfValido(semente) {
  const base = String(semente).padStart(9, '0').slice(-9).split('').map(Number)
  const dv = (nums, peso) => {
    const soma = nums.reduce((s, n, i) => s + n * (peso - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(base, 10)
  const d2 = dv([...base, d1], 11)
  return [...base, d1, d2].join('')
}

async function main() {
  const email = arg('email')
  const senha = arg('senha')
  const nomeLoja = arg('loja')
  const webhookUrl = arg('webhook')
  const segredo = arg('segredo')
  const modelo = arg('modelo', false)

  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    // `documento` é único: derivado do e-mail para não colidir com as contas
    // que já existem, e ainda assim passar na conferência de dígito.
    const semente = parseInt(createHash('sha256').update(email).digest('hex').slice(0, 8), 16)
    user = await prisma.user.create({
      data: {
        nome: nomeLoja,
        email,
        documento: cpfValido(semente % 1_000_000_000),
        senhaHash: await hash(senha, ARGON),
        papel: 'CLIENTE',
        // CPF, e não CNPJ: o documento é gerado com dígito de CPF logo acima.
        tipo: 'PF',
        // As lojas da casa não pagam a taxa por etiqueta — é o mesmo desenho
        // das outras três, e sem isso a emissão trava por saldo zero.
        isentoCobranca: true,
      },
    })
    await prisma.wallet.create({ data: { userId: user.id } })
    console.log(`conta criada: ${email}`)
  } else {
    console.log(`conta já existia: ${email}`)
  }

  let perfil = await prisma.perfil.findFirst({ where: { userId: user.id } })
  if (!perfil) {
    perfil = await prisma.perfil.create({
      data: { userId: user.id, nome: nomeLoja, nomeExibicao: 'Tiktok shop' },
    })
    console.log(`perfil criado: ${perfil.nome}`)
  } else {
    console.log(`perfil já existia: ${perfil.nome}`)
  }

  const tokenClaro = `frete_live_${randomBytes(32).toString('hex')}`
  await prisma.apiToken.create({
    data: {
      userId: user.id,
      perfilId: perfil.id,
      nome: `Montador PRO — ${nomeLoja}`,
      tokenHash: createHash('sha256').update(tokenClaro).digest('hex'),
      ambiente: 'PRODUCAO',
    },
  })
  console.log(`token criado`)

  const EVENTOS = [
    'order.created',
    'order.released',
    'order.generated',
    'order.posted',
    'order.delivered',
    'order.cancelled',
  ]
  const jaTem = await prisma.webhookApp.findFirst({ where: { userId: user.id } })
  if (jaTem) {
    await prisma.webhookApp.update({
      where: { id: jaTem.id },
      data: { url: webhookUrl, segredo, eventos: EVENTOS, ativo: true },
    })
    console.log('webhook atualizado')
  } else {
    await prisma.webhookApp.create({
      data: { userId: user.id, url: webhookUrl, segredo, eventos: EVENTOS, ativo: true },
    })
    console.log('webhook criado')
  }

  if (modelo) {
    const perfilModelo = await prisma.perfil.findFirst({
      where: { user: { email: modelo } },
      include: { templates: true },
    })
    for (const t of perfilModelo?.templates ?? []) {
      const existe = await prisma.mensagemTemplate.findFirst({
        where: { perfilId: perfil.id, evento: t.evento, canal: t.canal },
      })
      if (existe) continue
      await prisma.mensagemTemplate.create({
        data: {
          perfilId: perfil.id,
          canal: t.canal,
          evento: t.evento,
          nome: t.nome,
          idioma: t.idioma,
          previa: t.previa,
          variaveis: t.variaveis,
          ativo: t.ativo,
        },
      })
      console.log(`texto copiado: ${t.canal} ${t.evento}`)
    }
  }

  console.log('\n=== GUARDE ESTE VALOR: ele não volta a aparecer ===')
  console.log(`TOKEN=${tokenClaro}`)
  console.log(`PERFIL=${perfil.id}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

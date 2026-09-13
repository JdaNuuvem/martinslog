import { PrismaClient } from "@prisma/client"
import { hashSenha } from "../src/server/auth/senha"

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL
  const senha = process.env.ADMIN_SENHA
  const documento = process.env.ADMIN_DOCUMENTO ?? "00000000000"
  const nome = process.env.ADMIN_NOME ?? "Administrador"

  if (!email || !senha) throw new Error("ADMIN_EMAIL e ADMIN_SENHA obrigatorios")

  const senhaHash = await hashSenha(senha)

  const user = await prisma.user.upsert({
    where: { email },
    update: { papel: "ADMIN", senhaHash, emailVerificadoEm: new Date() },
    create: {
      tipo: "PF",
      papel: "ADMIN",
      documento,
      nome,
      email,
      senhaHash,
      emailVerificadoEm: new Date(),
    },
  })

  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, saldoCentavos: 0 },
  })

  console.log("admin pronto:", user.email)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

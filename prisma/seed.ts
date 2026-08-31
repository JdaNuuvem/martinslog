import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const prisma = new PrismaClient()

// Faixas de CEP por macrorregião (início/fim, 8 dígitos numéricos, sem hífen).
// Baseadas na distribuição oficial dos Correios por primeiro(s) dígito(s) do CEP,
// simplificadas para não deixar buraco nem sobreposição entre regiões.
const MACRORREGIOES = [
  { nome: 'Norte', cepIni: 66000000, cepFim: 69999999 },
  { nome: 'Nordeste', cepIni: 40000000, cepFim: 65999999 },
  { nome: 'Centro-Oeste', cepIni: 70000000, cepFim: 79999999 },
  { nome: 'Sudeste', cepIni: 1000000, cepFim: 39999999 },
  { nome: 'Sul', cepIni: 80000000, cepFim: 99999999 },
] as const

// Fator de distância aproximado entre macrorregiões (1.0 = mesma região).
const FATOR_DISTANCIA: Record<string, number> = {
  'Norte|Norte': 1.0,
  'Nordeste|Nordeste': 1.0,
  'Centro-Oeste|Centro-Oeste': 1.0,
  'Sudeste|Sudeste': 1.0,
  'Sul|Sul': 1.0,
  'Norte|Nordeste': 1.1,
  'Norte|Centro-Oeste': 1.15,
  'Norte|Sudeste': 1.3,
  'Norte|Sul': 1.4,
  'Nordeste|Centro-Oeste': 1.2,
  'Nordeste|Sudeste': 1.15,
  'Nordeste|Sul': 1.35,
  'Centro-Oeste|Sudeste': 1.1,
  'Centro-Oeste|Sul': 1.15,
  'Sudeste|Sul': 1.05,
}

function fatorDistancia(origem: string, destino: string): number {
  const chave1 = `${origem}|${destino}`
  const chave2 = `${destino}|${origem}`
  return FATOR_DISTANCIA[chave1] ?? FATOR_DISTANCIA[chave2] ?? 1.2
}

// Faixas de peso taxável (gramas), sem buraco e sem sobreposição.
const FAIXAS_PESO = [
  { pesoMinG: 1, pesoMaxG: 300, precoBaseCentavos: 2500 },
  { pesoMinG: 301, pesoMaxG: 1000, precoBaseCentavos: 3500 },
  { pesoMinG: 1001, pesoMaxG: 2000, precoBaseCentavos: 4500 },
  { pesoMinG: 2001, pesoMaxG: 5000, precoBaseCentavos: 7000 },
  { pesoMinG: 5001, pesoMaxG: 10000, precoBaseCentavos: 11000 },
  { pesoMinG: 10001, pesoMaxG: 30000, precoBaseCentavos: 22000 },
] as const

const SERVICOS = [
  { codigo: 'ECONOMICO', nome: 'Econômico', prazoBase: 5, fatorPreco: 1.0 },
  { codigo: 'RAPIDO', nome: 'Rápido', prazoBase: 2, fatorPreco: 1.25 },
  { codigo: 'EXPRESSO', nome: 'Expresso', prazoBase: 1, fatorPreco: 1.6 },
] as const

async function upsertUsuarioComCarteira(params: {
  documento: string
  nome: string
  email: string
  senha: string
  papel: 'ADMIN' | 'CLIENTE'
  saldoInicialCentavos: number
}) {
  const senhaHash = await hash(params.senha)

  const user = await prisma.user.upsert({
    where: { email: params.email },
    update: {},
    create: {
      tipo: 'PF',
      papel: params.papel,
      documento: params.documento,
      nome: params.nome,
      email: params.email,
      senhaHash,
      emailVerificadoEm: new Date(),
    },
  })

  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, saldoCentavos: 0 },
  })

  if (params.saldoInicialCentavos > 0) {
    const jaTemCredito = await prisma.ledgerEntry.findFirst({
      where: { walletId: wallet.id, refTipo: 'SEED', refId: user.id, tipo: 'CREDITO' },
    })

    if (!jaTemCredito) {
      await prisma.$transaction([
        prisma.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            tipo: 'CREDITO',
            valorCentavos: params.saldoInicialCentavos,
            saldoAposCentavos: params.saldoInicialCentavos,
            refTipo: 'SEED',
            refId: user.id,
            descricao: 'Crédito inicial de teste (seed)',
          },
        }),
        prisma.wallet.update({
          where: { id: wallet.id },
          data: { saldoCentavos: params.saldoInicialCentavos },
        }),
      ])
    }
  }

  return user
}

async function main() {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: {
      nome: 'Transportadora Própria',
      slug: 'transportadora-propria',
      ativo: true,
    },
  })

  const servicos = []
  for (const s of SERVICOS) {
    const service = await prisma.service.upsert({
      where: { carrierId_codigo: { carrierId: carrier.id, codigo: s.codigo } },
      update: {},
      create: {
        carrierId: carrier.id,
        codigo: s.codigo,
        nome: s.nome,
        prazoBase: s.prazoBase,
        exigePudo: false,
        entregaSabado: false,
        limitePesoG: 30000,
        limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
        ativo: true,
      },
    })
    servicos.push({ ...s, id: service.id })
  }

  // Limpa regras antigas do seed para permitir reexecução idempotente.
  await prisma.priceRule.deleteMany({ where: { serviceId: { in: servicos.map((s) => s.id) } } })

  const regrasParaCriar: Array<{
    serviceId: string
    cepOrigemIni: number
    cepOrigemFim: number
    cepDestinoIni: number
    cepDestinoFim: number
    pesoMinG: number
    pesoMaxG: number
    precoBalcaoCentavos: number
    precoCustoCentavos: number
    precoVendaCentavos: number
    prazoDias: number
  }> = []

  for (const origem of MACRORREGIOES) {
    for (const destino of MACRORREGIOES) {
      const fator = fatorDistancia(origem.nome, destino.nome)

      for (const faixa of FAIXAS_PESO) {
        for (const servico of servicos) {
          const precoBalcaoCentavos = Math.round(faixa.precoBaseCentavos * fator * servico.fatorPreco)
          const precoVendaCentavos = Math.round(precoBalcaoCentavos * 0.5)
          const precoCustoCentavos = Math.round(precoVendaCentavos * 0.75)
          const prazoDias = servico.prazoBase + (origem.nome === destino.nome ? 0 : 1)

          regrasParaCriar.push({
            serviceId: servico.id,
            cepOrigemIni: origem.cepIni,
            cepOrigemFim: origem.cepFim,
            cepDestinoIni: destino.cepIni,
            cepDestinoFim: destino.cepFim,
            pesoMinG: faixa.pesoMinG,
            pesoMaxG: faixa.pesoMaxG,
            precoBalcaoCentavos,
            precoCustoCentavos,
            precoVendaCentavos,
            prazoDias,
          })
        }
      }
    }
  }

  await prisma.priceRule.createMany({ data: regrasParaCriar })

  await upsertUsuarioComCarteira({
    documento: '00000000000',
    nome: 'Admin Teste',
    email: 'admin@frete.teste',
    senha: 'AdminTeste123!',
    papel: 'ADMIN',
    saldoInicialCentavos: 0,
  })

  await upsertUsuarioComCarteira({
    documento: '11111111111',
    nome: 'Cliente Teste',
    email: 'cliente@frete.teste',
    senha: 'ClienteTeste123!',
    papel: 'CLIENTE',
    saldoInicialCentavos: 10000,
  })

  const totalPriceRules = await prisma.priceRule.count()
  console.log(`Seed concluído. PriceRule geradas: ${totalPriceRules}`)
}

main()
  .catch((erro) => {
    console.error(erro)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

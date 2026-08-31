import type { User, Quote } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Fábricas de dados para testes de integração que tocam o banco de teste
 * (ver `DATABASE_URL` em `vitest.config.ts`). Cada fábrica cria dados
 * mínimos e determinísticos — nada de `faker` aleatório, para manter os
 * testes de concorrência reprodutíveis.
 */

let contador = 0
function proximoSufixo(): string {
  contador += 1
  return `${Date.now()}${contador}`
}

const SERVICO_ECO_ID = 'eco'

/**
 * Cria um usuário de teste com uma `Wallet` já com o saldo informado
 * (em centavos). Usado pelos testes de pagamento de envio que precisam de
 * um saldo inicial conhecido.
 */
export async function criarUsuarioComSaldo(saldoCentavos: number): Promise<User> {
  const sufixo = proximoSufixo()
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: sufixo.padStart(11, '0').slice(-11),
      nome: 'Usuário Teste Envio',
      email: `envio-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })

  await prisma.wallet.create({ data: { userId: user.id, saldoCentavos } })

  return user
}

async function garantirServicoEco(): Promise<void> {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-teste' },
    update: {},
    create: { nome: 'Transportadora Teste', slug: 'transportadora-teste' },
  })

  await prisma.service.upsert({
    where: { id: SERVICO_ECO_ID },
    update: {},
    create: {
      id: SERVICO_ECO_ID,
      carrierId: carrier.id,
      codigo: 'eco',
      nome: 'Econômico',
      prazoBase: 5,
      limitePesoG: 30000,
      limiteDimensoes: {},
    },
  })
}

export type OpcoesCotacaoValida = {
  /** Preço final (em centavos) da opção 'eco' dentro da cotação. */
  precoCentavos?: number
  /** Se `true`, a cotação já nasce expirada (para testar CotacaoExpiradaError). */
  expirada?: boolean
}

/**
 * Cria uma `Quote` válida do usuário, com uma única opção de serviço
 * disponível (id fixo `'eco'`), pronta para virar um envio via
 * `criarEnvio`. O preço é determinístico e controlável via `opcoes`, para
 * que os testes de concorrência (que dependem de um saldo que cobre
 * exatamente um envio) sejam reprodutíveis.
 */
export async function criarCotacaoValida(
  userId: string,
  opcoes: OpcoesCotacaoValida = {},
): Promise<Quote> {
  await garantirServicoEco()

  const precoCentavos = opcoes.precoCentavos ?? 1416
  const expiraEm = opcoes.expirada
    ? new Date(Date.now() - 60 * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000)

  return prisma.quote.create({
    data: {
      userId,
      cepOrigem: '01310-100',
      cepDestino: '20040-020',
      formato: 'CAIXA',
      pesoG: 1000,
      altura: 10,
      largura: 10,
      comprimento: 10,
      pesoCubadoG: 1000,
      pesoTaxavelG: 1000,
      opcionais: {},
      opcoes: [
        {
          servicoId: SERVICO_ECO_ID,
          servicoNome: 'Econômico',
          carrierNome: 'Transportadora Teste',
          disponivel: true,
          observacao: null,
          precoBalcaoCentavos: precoCentavos,
          precoFinalCentavos: precoCentavos,
          descontoCentavos: 0,
          descontoPercentual: 0,
          prazoDias: 5,
        },
      ],
      expiraEm,
    },
  })
}

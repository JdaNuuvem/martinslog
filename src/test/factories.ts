import { randomInt } from 'crypto'
import type { User, Quote } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * Fábricas de dados para testes de integração que tocam o banco de teste
 * (ver `DATABASE_URL` em `vitest.config.ts`).
 */

let contador = 0
function proximoSufixo(): string {
  contador += 1
  return `${Date.now()}${contador}`
}

/**
 * Documento único para `User.documento` (índice único no banco).
 *
 * A versão anterior concatenava `Date.now()` (13 dígitos) com o contador e
 * cortava para os últimos 11 dígitos (`slice(-11)`) — como o timestamp em
 * milissegundos domina os 13 dígitos, o contador quase nunca sobrevivia ao
 * corte, e dois `User` criados no mesmo milissegundo (comum quando vários
 * arquivos de teste rodam em paralelo contra o mesmo banco, ou quando o
 * módulo é recarregado por arquivo e `contador` reinicia em 1 para cada
 * um) geravam o mesmo `documento` e violavam a constraint única — foi o
 * que quebrou `route.test.ts` de `carteira/recarga` e de
 * `envios/[id]/etiqueta` (arquivos de outras sessões que já consomem esta
 * fábrica). Combinar o contador (garante unicidade dentro do processo) com
 * um sorteio de 6 dígitos (reduz a chance de colisão entre processos a
 * praticamente zero) resolve os dois casos.
 */
function proximoDocumento(): string {
  contador += 1
  const aleatorio = randomInt(0, 1_000_000).toString().padStart(6, '0')
  return `${contador}${aleatorio}`.padStart(11, '0').slice(-11)
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
      documento: proximoDocumento(),
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
  /**
   * CEPs da rota cotada. `criarEnvio` confere os CEPs do envio contra os da
   * cotação, então um teste que precise de outra rota — origem e destino na
   * mesma cidade, por exemplo — tem de cotar essa rota.
   */
  cepOrigem?: string
  cepDestino?: string
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
      cepOrigem: opcoes.cepOrigem ?? '01310-100',
      cepDestino: opcoes.cepDestino ?? '20040-020',
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

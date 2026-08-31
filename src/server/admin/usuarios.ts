import { prisma } from '@/infra/db/client'

/**
 * Consultas de leitura da área "Usuários" do painel administrativo.
 *
 * Só leitura: quem muda dinheiro está em `carteira.ts` e quem mexe em
 * etiquetas está em `envios.ts`. A separação é proposital — é fácil auditar
 * um módulo que sabidamente não escreve nada.
 */

export type UsuarioResumo = {
  id: string
  nome: string
  email: string
  documento: string
  papel: 'CLIENTE' | 'ADMIN'
  saldoCentavos: number
  envios: number
  criadoEm: Date
}

export type EnvioResumoAdmin = {
  id: string
  codigoRastreio: string | null
  status: string
  destinatarioNome: string
  precoCobradoCentavos: number
  criadoEm: Date
}

export type UsuarioDetalhe = UsuarioResumo & {
  telefone: string | null
  extrato: {
    id: string
    tipo: 'CREDITO' | 'DEBITO'
    valorCentavos: number
    saldoAposCentavos: number
    descricao: string
    criadoEm: Date
  }[]
  etiquetas: EnvioResumoAdmin[]
}

const LIMITE_LISTA = 50
const LIMITE_EXTRATO = 30
const LIMITE_ETIQUETAS = 50

function nomeDoDestinatario(destinatario: unknown): string {
  const registro = destinatario as { nome?: unknown } | null
  return typeof registro?.nome === 'string' ? registro.nome : '—'
}

/**
 * Lista usuários, opcionalmente filtrados por nome, e-mail ou documento.
 *
 * A busca é `contains` case-insensitive nos três campos ao mesmo tempo
 * porque quem opera o painel tem em mãos o que o cliente mandou no chamado —
 * às vezes o e-mail, às vezes o CPF — e não deveria precisar escolher em
 * qual caixa digitar.
 */
export async function listarUsuarios(busca = ''): Promise<UsuarioResumo[]> {
  const termo = busca.trim()

  const usuarios = await prisma.user.findMany({
    where: termo
      ? {
          OR: [
            { nome: { contains: termo, mode: 'insensitive' } },
            { email: { contains: termo, mode: 'insensitive' } },
            { documento: { contains: termo } },
          ],
        }
      : undefined,
    orderBy: { criadoEm: 'desc' },
    take: LIMITE_LISTA,
    select: {
      id: true,
      nome: true,
      email: true,
      documento: true,
      papel: true,
      criadoEm: true,
      wallet: { select: { saldoCentavos: true } },
      _count: { select: { shipments: true } },
    },
  })

  return usuarios.map((usuario) => ({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    documento: usuario.documento,
    papel: usuario.papel,
    // Carteira ainda não criada é saldo zero, não ausência de dado: a linha
    // nasce no primeiro crédito, e mostrar "—" confundiria quem opera.
    saldoCentavos: usuario.wallet?.saldoCentavos ?? 0,
    envios: usuario._count.shipments,
    criadoEm: usuario.criadoEm,
  }))
}

/**
 * Ficha completa de um usuário: dados, saldo, últimos lançamentos e as
 * etiquetas dele. Devolve `null` quando o id não existe — a página traduz
 * isso em 404.
 */
export async function obterUsuario(userId: string): Promise<UsuarioDetalhe | null> {
  const usuario = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nome: true,
      email: true,
      documento: true,
      telefone: true,
      papel: true,
      criadoEm: true,
      wallet: {
        select: {
          saldoCentavos: true,
          entries: {
            orderBy: { criadoEm: 'desc' },
            take: LIMITE_EXTRATO,
            select: {
              id: true,
              tipo: true,
              valorCentavos: true,
              saldoAposCentavos: true,
              descricao: true,
              criadoEm: true,
            },
          },
        },
      },
      shipments: {
        orderBy: { criadoEm: 'desc' },
        take: LIMITE_ETIQUETAS,
        select: {
          id: true,
          codigoRastreio: true,
          status: true,
          destinatario: true,
          precoCobradoCentavos: true,
          criadoEm: true,
        },
      },
      _count: { select: { shipments: true } },
    },
  })

  if (!usuario) {
    return null
  }

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    documento: usuario.documento,
    telefone: usuario.telefone,
    papel: usuario.papel,
    criadoEm: usuario.criadoEm,
    saldoCentavos: usuario.wallet?.saldoCentavos ?? 0,
    envios: usuario._count.shipments,
    extrato: usuario.wallet?.entries ?? [],
    etiquetas: usuario.shipments.map((envio) => ({
      id: envio.id,
      codigoRastreio: envio.codigoRastreio,
      status: envio.status,
      destinatarioNome: nomeDoDestinatario(envio.destinatario),
      precoCobradoCentavos: envio.precoCobradoCentavos,
      criadoEm: envio.criadoEm,
    })),
  }
}

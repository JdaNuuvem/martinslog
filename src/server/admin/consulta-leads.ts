import type { OrigemLead, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { decifrarCampo } from '@/infra/crypto/campo'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from '@/domain/lead/identidade'
import { POR_PAGINA, type LeadResumo, type ResultadoLeads } from '@/lib/leads-schema'

/**
 * Consulta da base de leads, para a administração.
 *
 * Nenhuma função daqui devolve CPF completo. A única que o decifra é
 * `revelarCpf`, e ela registra quem pediu — ver o comentário lá embaixo.
 */

export type FiltroLeads = {
  busca?: string
  perfilId?: string
  origem?: OrigemLead
  desde?: Date
  ate?: Date
  pagina?: number
  /**
   * Traz TODOS os que casam com o filtro, sem paginar. Só a exportação usa.
   *
   * Existe porque exportar "a lista filtrada" paginada exportaria as
   * primeiras cinquenta linhas e nada diria que o resto ficou de fora —
   * quem baixasse o arquivo concluiria que a base tem cinquenta pessoas.
   * O teto de dez mil é a proteção contra montar um CSV de centenas de
   * megabytes na memória do servidor; passando dele, a resposta avisa que
   * o filtro precisa ser mais estreito.
   */
  todas?: boolean
}

/** Teto de linhas por exportação. Acima disso, o filtro precisa estreitar. */
export const TETO_EXPORTACAO = 10_000

/**
 * Mascara o CPF preservando o miolo.
 *
 * O miolo basta para conferir que é a pessoa certa quando alguém dita o
 * número pelo telefone, e não basta para reconstituir o documento.
 */
function mascarar(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`
}

/**
 * Decifra e mascara, sem derrubar a tela quando o valor cifrado é ilegível.
 *
 * Um único registro corrompido — chave trocada, cópia de banco malfeita —
 * não pode tirar do ar a listagem inteira, o detalhe e a exportação. O log
 * leva só o `leadId`: o valor cifrado não vai para log nenhum.
 */
function mascararCpfCifrado(leadId: string, cifrado: string): string {
  try {
    return mascarar(decifrarCampo(cifrado))
  } catch {
    console.error('CPF de lead ilegível', { leadId })
    return 'ilegível'
  }
}

/** Um único aviso por processo quando falta a chave da impressão digital. */
let avisouChaveAusente = false

/**
 * Monta o `where` da busca livre.
 *
 * A busca por CPF é diferente das outras: o termo digitado vira impressão
 * digital e a comparação é hash contra hash. Consequência direta de não
 * guardar o número em claro — busca por CPF parcial não funciona, e não tem
 * como funcionar sem desfazer a proteção.
 */
function filtroDeBusca(termo: string): Prisma.LeadWhereInput | null {
  const limpo = termo.trim()
  if (!limpo) return null

  /*
    Todas as leituras possíveis do termo, combinadas com OU.

    Onze dígitos são AMBÍGUOS: um CPF e um celular com DDD têm exatamente o
    mesmo tamanho. Parar no primeiro formato que casa — CPF, que é testado
    antes — faria a busca por celular virar impressão digital de CPF e
    voltar vazia, para o formato de telefone mais comum do país.

    Cada leitura válida entra na busca. Não há falso positivo por
    coincidência de formato: as três colunas são exatas e únicas, então só
    casa o lead cujo valor é de fato aquele.
  */
  const leituras: Prisma.LeadWhereInput[] = []

  const cpf = normalizarCpf(limpo)
  if (cpf) {
    /*
      Sem `LEAD_FINGERPRINT_KEY` a impressão digital lança. A leitura de CPF
      DEGRADA em vez de a chave ser exigida na subida: exigir derrubaria o
      site inteiro num deploy onde ela ainda não foi configurada. E onze
      dígitos também são um celular — telefone e e-mail precisam continuar
      funcionando. O aviso sai uma vez por processo, para não inundar o log.
    */
    try {
      leituras.push({ cpfHash: impressaoDigitalCpf(cpf) })
    } catch {
      if (!avisouChaveAusente) {
        avisouChaveAusente = true
        console.warn('LEAD_FINGERPRINT_KEY ausente: a busca de leads por CPF está desligada.')
      }
    }
  }

  const telefone = normalizarTelefoneLead(limpo)
  if (telefone) leituras.push({ telefoneNormalizado: telefone })

  const email = normalizarEmail(limpo)
  if (email) leituras.push({ emailNormalizado: email })

  if (leituras.length === 0) {
    return { nome: { contains: limpo, mode: 'insensitive' } }
  }

  return { OR: leituras }
}

export async function listarLeads(filtro: FiltroLeads = {}): Promise<ResultadoLeads> {
  const pagina = Math.max(1, filtro.pagina ?? 1)
  const busca = filtro.busca ? filtroDeBusca(filtro.busca) : null

  const where: Prisma.LeadWhereInput = {
    ...(busca ?? {}),
    ...(filtro.desde || filtro.ate
      ? {
          ultimoContatoEm: {
            ...(filtro.desde ? { gte: filtro.desde } : {}),
            ...(filtro.ate ? { lte: filtro.ate } : {}),
          },
        }
      : {}),
    ...(filtro.perfilId || filtro.origem
      ? {
          origens: {
            some: {
              ...(filtro.perfilId ? { perfilId: filtro.perfilId } : {}),
              ...(filtro.origem ? { tipo: filtro.origem } : {}),
            },
          },
        }
      : {}),
  }

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { ultimoContatoEm: 'desc' },
      skip: filtro.todas ? 0 : (pagina - 1) * POR_PAGINA,
      take: filtro.todas ? TETO_EXPORTACAO : POR_PAGINA,
      include: {
        origens: { select: { perfilId: true }, distinct: ['perfilId'] },
      },
    }),
  ])

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  const nomeDoPerfil = new Map(perfis.map((p) => [p.id, p.nome]))

  const resumos: LeadResumo[] = leads.map((lead) => ({
    id: lead.id,
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone,
    /*
      O CPF sai MASCARADO da listagem, sempre.

      Numa lista, mil CPFs são lidos de uma vez por qualquer um que abra a
      tela ou tire um print. No detalhe, ler mil exige mil ações — e cada uma
      fica registrada.
    */
    cpfMascarado: lead.cpfCifrado ? mascararCpfCifrado(lead.id, lead.cpfCifrado) : null,
    lojas: lead.origens
      .map((o) => (o.perfilId ? nomeDoPerfil.get(o.perfilId) : null))
      .filter((nome): nome is string => nome !== null && nome !== undefined),
    totalPedidos: lead.totalPedidos,
    totalEnvios: lead.totalEnvios,
    valorTotalCentavos: lead.valorTotalCentavos,
    ultimoContatoEm: lead.ultimoContatoEm.toISOString(),
  }))

  return { leads: resumos, total, pagina, porPagina: POR_PAGINA }
}

export type LeadDetalhe = LeadResumo & {
  primeiroContatoEm: string
  origens: {
    tipo: OrigemLead
    loja: string | null
    pedidoId: string | null
    shipmentId: string | null
    conversaId: string | null
    ocorridoEm: string
  }[]
}

export async function obterLead(leadId: string): Promise<LeadDetalhe | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { origens: { orderBy: { ocorridoEm: 'desc' } } },
  })

  if (!lead) return null

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  const nomeDoPerfil = new Map(perfis.map((p) => [p.id, p.nome]))

  return {
    id: lead.id,
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone,
    cpfMascarado: lead.cpfCifrado ? mascararCpfCifrado(lead.id, lead.cpfCifrado) : null,
    lojas: [
      ...new Set(
        lead.origens
          .map((o) => (o.perfilId ? nomeDoPerfil.get(o.perfilId) : null))
          .filter((nome): nome is string => nome !== null && nome !== undefined),
      ),
    ],
    totalPedidos: lead.totalPedidos,
    totalEnvios: lead.totalEnvios,
    valorTotalCentavos: lead.valorTotalCentavos,
    primeiroContatoEm: lead.primeiroContatoEm.toISOString(),
    ultimoContatoEm: lead.ultimoContatoEm.toISOString(),
    origens: lead.origens.map((o) => ({
      tipo: o.tipo,
      loja: o.perfilId ? (nomeDoPerfil.get(o.perfilId) ?? null) : null,
      pedidoId: o.pedidoId,
      shipmentId: o.shipmentId,
      conversaId: o.conversaId,
      ocorridoEm: o.ocorridoEm.toISOString(),
    })),
  }
}

/**
 * Decifra e devolve o CPF completo de um lead.
 *
 * **É a única porta por onde o número sai do sistema**, e por isso cada
 * chamada grava `AuditLog`. O registro é o que permite responder, depois,
 * quem leu o documento de quem e quando — sem ele, "alguém exportou a base"
 * não tem como ser investigado.
 */
export async function revelarCpf(leadId: string, adminUserId: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { cpfCifrado: true },
  })

  if (!lead?.cpfCifrado) return null

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      acao: 'LEAD_CPF_REVELADO',
      entidade: 'Lead',
      entidadeId: leadId,
    },
  })

  return decifrarCampo(lead.cpfCifrado)
}

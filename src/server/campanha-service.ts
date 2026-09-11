import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { compor } from '@/domain/mensagem/texto'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { enviarNaConversa } from '@/server/conversa-service'

/**
 * Campanhas: a mesma mensagem para muitos compradores.
 *
 * É o recurso mais perigoso desta área, e o desenho existe para conter o
 * perigo, não para escondê-lo. Mandar em rajada de um número não-oficial é
 * exatamente o padrão que a Meta usa para banir — e número banido não volta,
 * levando junto o canal de TODAS as lojas que usam aquele celular.
 *
 * Três travas, todas no servidor:
 *
 * - `LOTE_POR_RODADA` limita quantas saem por execução do agendador;
 * - `INTERVALO_MS` espaça os envios, para não parecer rajada;
 * - `LIMITE_POR_HORA` é o teto absoluto, contado no banco.
 *
 * Nenhuma delas mora na tela. Trava de interface é trava que a primeira
 * chamada direta à API ignora.
 */

const LOTE_POR_RODADA = 10
const INTERVALO_MS = 4_000
const LIMITE_POR_HORA = 60

export type EntradaCampanha = {
  nome: string
  texto: string
  agendadaPara?: Date | null
  /** Telefones colados pela loja, em qualquer formato. */
  destinatarios: { contato: string; nome?: string | null }[]
}

/**
 * Cria a campanha já com a lista limpa.
 *
 * Telefone inválido é descartado aqui, e não na hora do envio: a loja precisa
 * ver o número de destinatários reais ANTES de agendar, senão ela agenda para
 * 500 e descobre depois que 80 eram lixo.
 */
export async function criarCampanha(
  userId: string,
  perfilId: string,
  entrada: EntradaCampanha,
): Promise<{ id: string; validos: number; descartados: number }> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const vistos = new Set<string>()
  const validos: { contato: string; nome: string | null }[] = []
  let descartados = 0

  for (const d of entrada.destinatarios) {
    const numero = normalizarTelefone(d.contato)
    if (!numero || vistos.has(numero)) {
      descartados++
      continue
    }
    vistos.add(numero)
    validos.push({ contato: numero, nome: d.nome?.trim() || null })
  }

  const campanha = await prisma.campanha.create({
    data: {
      perfilId,
      nome: entrada.nome.trim(),
      texto: entrada.texto,
      status: entrada.agendadaPara ? 'AGENDADA' : 'RASCUNHO',
      agendadaPara: entrada.agendadaPara ?? null,
      destinatarios: { createMany: { data: validos } },
    },
  })

  return { id: campanha.id, validos: validos.length, descartados }
}

/** Quantas mensagens de campanha já saíram na última hora, nesta loja. */
async function enviadasNaUltimaHora(perfilId: string): Promise<number> {
  return prisma.campanhaDestinatario.count({
    where: {
      status: 'ENVIADA',
      enviadaEm: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      campanha: { perfilId },
    },
  })
}

export type ResultadoRodada = {
  enviadas: number
  falhas: number
  /** Quantas deixaram de sair porque o teto por hora foi atingido. */
  seguradas: number
}

/**
 * Solta um lote da campanha. Chamado pelo agendador, de minuto em minuto.
 *
 * Intencionalmente devagar: o objetivo não é despachar rápido, é despachar
 * sem queimar o número. Uma campanha de 500 leva horas, e isso é a intenção.
 */
export async function dispararCampanhasPendentes(): Promise<ResultadoRodada> {
  const agora = new Date()

  const campanha = await prisma.campanha.findFirst({
    where: {
      status: { in: ['AGENDADA', 'ENVIANDO'] },
      OR: [{ agendadaPara: null }, { agendadaPara: { lte: agora } }],
    },
    orderBy: { agendadaPara: 'asc' },
    include: { perfil: { select: { id: true, nome: true, nomeExibicao: true } } },
  })

  if (!campanha) return { enviadas: 0, falhas: 0, seguradas: 0 }

  const jaSairam = await enviadasNaUltimaHora(campanha.perfilId)
  const espacoNaHora = Math.max(0, LIMITE_POR_HORA - jaSairam)
  if (espacoNaHora === 0) {
    return { enviadas: 0, falhas: 0, seguradas: LOTE_POR_RODADA }
  }

  const pendentes = await prisma.campanhaDestinatario.findMany({
    where: { campanhaId: campanha.id, status: 'PENDENTE' },
    take: Math.min(LOTE_POR_RODADA, espacoNaHora),
  })

  if (pendentes.length === 0) {
    await prisma.campanha.update({
      where: { id: campanha.id },
      data: { status: 'CONCLUIDA', concluidaEm: agora },
    })
    return { enviadas: 0, falhas: 0, seguradas: 0 }
  }

  if (campanha.status === 'AGENDADA') {
    await prisma.campanha.update({
      where: { id: campanha.id },
      data: { status: 'ENVIANDO', iniciadaEm: agora },
    })
  }

  const nomeLoja = campanha.perfil.nomeExibicao ?? campanha.perfil.nome
  let enviadas = 0
  let falhas = 0

  for (const destinatario of pendentes) {
    const texto = compor(campanha.texto, {
      loja: nomeLoja,
      cliente: destinatario.nome ?? '',
    })

    const resultado = await enviarNaConversa({
      perfilId: campanha.perfilId,
      contato: destinatario.contato,
      texto,
      // ROBO e não ATENDENTE: campanha não é atendimento, e marcá-la como
      // humana silenciaria o robô em todas as conversas atingidas.
      autor: 'ROBO',
    })

    await prisma.campanhaDestinatario.update({
      where: { id: destinatario.id },
      data: resultado.ok
        ? { status: 'ENVIADA', enviadaEm: new Date(), erro: null }
        : { status: 'FALHA', erro: resultado.erro },
    })

    if (resultado.ok) enviadas++
    else falhas++

    // Espaça o próximo. É a trava mais simples e a que mais protege: rajada
    // é o que dispara a suspeita do outro lado.
    if (pendentes.indexOf(destinatario) < pendentes.length - 1) {
      await new Promise((r) => setTimeout(r, INTERVALO_MS))
    }
  }

  return { enviadas, falhas, seguradas: 0 }
}

export async function listarCampanhas(userId: string, perfilId: string) {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const campanhas = await prisma.campanha.findMany({
    where: { perfilId },
    orderBy: { criadoEm: 'desc' },
    take: 50,
    include: {
      _count: { select: { destinatarios: true } },
      destinatarios: { where: { status: 'ENVIADA' }, select: { id: true } },
    },
  })

  return campanhas.map((c) => ({
    id: c.id,
    nome: c.nome,
    texto: c.texto,
    status: c.status,
    agendadaPara: c.agendadaPara,
    total: c._count.destinatarios,
    enviadas: c.destinatarios.length,
  }))
}

/** Para a campanha. O que já saiu não volta — só o que falta é cancelado. */
export async function cancelarCampanha(userId: string, campanhaId: string): Promise<void> {
  const campanha = await prisma.campanha.findUnique({
    where: { id: campanhaId },
    select: { perfilId: true },
  })
  if (!campanha) throw new NaoAutorizadoError('Campanha não encontrada.')
  if (!(await acharPerfil(userId, campanha.perfilId))) {
    throw new NaoAutorizadoError('Campanha não encontrada.')
  }

  await prisma.campanha.update({
    where: { id: campanhaId },
    data: { status: 'CANCELADA', concluidaEm: new Date() },
  })
}

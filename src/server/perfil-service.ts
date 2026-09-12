import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError, NaoAutorizadoError } from '@/domain/errors'

/**
 * Perfis de envio: as lojas dentro de uma conta.
 *
 * Toda função aqui recebe `userId` e resolve o perfil por ele, nunca só pelo
 * id do perfil. É a mesma regra dos envios: um id que existe em outra conta
 * responde como id que não existe, e a diferença entre "não é seu" e "não
 * existe" nunca chega ao cliente.
 */

const LIMITE_NOME = 60

/**
 * Teto de perfis por conta.
 *
 * Não é regra de negócio, é contenção: o seletor de perfil é uma lista, e uma
 * conta com trezentos perfis transforma a troca de loja num problema de busca.
 * Quando alguém legítimo esbarrar nisto, o número sobe — mas um script que
 * criasse perfis em laço para agora.
 */
const LIMITE_PERFIS = 50

export type PerfilResumo = {
  id: string
  nome: string
  ativo: boolean
  criadoEm: Date
  /** Se o WhatsApp daquele perfil está pronto para enviar. */
  whatsappConectado: boolean
  numeroExibicao: string | null
  /** Quantos eventos já têm mensagem configurada. */
  templatesAtivos: number
}

function validarNome(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, ' ')
  if (limpo.length === 0) {
    throw new ArquivoInvalidoError('Dê um nome ao perfil.')
  }
  if (limpo.length > LIMITE_NOME) {
    throw new ArquivoInvalidoError(`O nome do perfil passa de ${LIMITE_NOME} caracteres.`)
  }
  return limpo
}

export async function listarPerfis(userId: string): Promise<PerfilResumo[]> {
  const perfis = await prisma.perfil.findMany({
    where: { userId },
    orderBy: { criadoEm: 'asc' },
    select: {
      id: true,
      nome: true,
      ativo: true,
      criadoEm: true,
      // Só o que a lista mostra. O token cifrado do WhatsApp fica de fora de
      // propósito: ele não tem por que atravessar a rede numa listagem.
      whatsappConfig: { select: { ativo: true, verificadaEm: true, numeroExibicao: true } },
      _count: { select: { templates: { where: { ativo: true } } } },
    },
  })

  return perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    ativo: p.ativo,
    criadoEm: p.criadoEm,
    /*
      "Conectado" exige credencial verificada, e não apenas salva. Sem a
      verificação, a tela diria conectado para um token digitado errado, e o
      lojista só descobriria na primeira venda que não avisou ninguém.
    */
    whatsappConectado: Boolean(p.whatsappConfig?.ativo && p.whatsappConfig.verificadaEm),
    numeroExibicao: p.whatsappConfig?.numeroExibicao ?? null,
    templatesAtivos: p._count.templates,
  }))
}

/**
 * Resolve um perfil garantindo a posse. Devolve `null` quando não é da conta,
 * para quem chama transformar em 404.
 */
export async function acharPerfil(userId: string, perfilId: string) {
  const perfil = await prisma.perfil.findUnique({ where: { id: perfilId } })
  if (!perfil || perfil.userId !== userId) return null
  return perfil
}

export async function criarPerfil(userId: string, nome: string) {
  const limpo = validarNome(nome)

  const quantos = await prisma.perfil.count({ where: { userId } })
  if (quantos >= LIMITE_PERFIS) {
    throw new ArquivoInvalidoError(
      `Esta conta já tem ${LIMITE_PERFIS} perfis. Desative os que não usa antes de criar outro.`,
    )
  }

  const existente = await prisma.perfil.findUnique({
    where: { userId_nome: { userId, nome: limpo } },
  })
  if (existente) {
    throw new ArquivoInvalidoError(`Já existe um perfil chamado "${limpo}".`)
  }

  return prisma.perfil.create({ data: { userId, nome: limpo } })
}

export async function renomearPerfil(userId: string, perfilId: string, nome: string) {
  const perfil = await acharPerfil(userId, perfilId)
  if (!perfil) throw new NaoAutorizadoError('Perfil não encontrado.')

  const limpo = validarNome(nome)
  if (limpo === perfil.nome) return perfil

  const existente = await prisma.perfil.findUnique({
    where: { userId_nome: { userId, nome: limpo } },
  })
  if (existente) {
    throw new ArquivoInvalidoError(`Já existe um perfil chamado "${limpo}".`)
  }

  return prisma.perfil.update({ where: { id: perfilId }, data: { nome: limpo } })
}

export async function alternarPerfil(userId: string, perfilId: string, ativo: boolean) {
  const perfil = await acharPerfil(userId, perfilId)
  if (!perfil) throw new NaoAutorizadoError('Perfil não encontrado.')
  return prisma.perfil.update({ where: { id: perfilId }, data: { ativo } })
}

/**
 * Apaga o perfil — e, junto, a configuração de WhatsApp, os templates, os
 * pedidos e o histórico de mensagens dele.
 *
 * Perfil com envio no ar não é apagado. O envio guarda `perfilId` para saber
 * por qual WhatsApp avisar o comprador, e apagar o perfil no meio do trajeto
 * deixaria a encomenda viva sem ninguém para notificar — sem erro nenhum, só
 * silêncio até a entrega.
 */
export async function apagarPerfil(userId: string, perfilId: string): Promise<void> {
  const perfil = await acharPerfil(userId, perfilId)
  if (!perfil) throw new NaoAutorizadoError('Perfil não encontrado.')

  const emTransito = await prisma.shipment.count({
    where: {
      perfilId,
      status: { in: ['PENDING', 'RELEASED', 'GENERATED', 'POSTED'] },
    },
  })

  if (emTransito > 0) {
    throw new ArquivoInvalidoError(
      `Este perfil tem ${emTransito} envio(s) em andamento. Desative-o em vez de apagar — ` +
        'apagando, os compradores dessas encomendas deixariam de ser avisados.',
    )
  }

  await prisma.perfil.delete({ where: { id: perfilId } })
}

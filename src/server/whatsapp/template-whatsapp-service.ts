import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { DomainError, NaoAutorizadoError } from '@/domain/errors'
import { compor } from '@/domain/mensagem/texto'
import { env } from '@/env'
import { acharPerfil } from '@/server/perfil-service'

/**
 * Respostas prontas do atendimento no WhatsApp.
 *
 * O atendente escolhe, a plataforma preenche. Não é template da Meta (esse
 * precisa de aprovação e sai sozinho por evento) nem do SMS: é texto que uma
 * pessoa manda dentro de uma conversa já aberta, e que ela pode editar antes
 * de enviar.
 */

export class AtalhoRepetidoError extends DomainError {
  readonly codigo = 'ATALHO_REPETIDO'
  constructor() {
    super('Já existe uma resposta pronta com esse atalho nesta loja.')
  }
}

export const templateSchema = z.object({
  titulo: z.string().trim().min(1, 'Dê um título.').max(80),
  atalho: z
    .string()
    .trim()
    .toLowerCase()
    .max(30)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[a-z0-9_-]+$/.test(v), 'Atalho só com letras, números, - e _.'),
  texto: z.string().trim().min(1, 'Escreva o texto.').max(4096),
  ordem: z.number().int().min(0).max(10_000).optional(),
})

export type DadosTemplate = z.infer<typeof templateSchema>

export type TemplateApi = {
  id: string
  titulo: string
  atalho: string | null
  texto: string
  ordem: number
}

/**
 * O que toda loja recebe na primeira vez. Com atalho, para a trava de único
 * por loja segurar duas primeiras aberturas simultâneas.
 */
const PADROES: Array<Omit<TemplateApi, 'id'>> = [
  {
    titulo: 'Saudação',
    atalho: 'ola',
    texto: 'Olá, {{cliente}}! Aqui é da {{loja}}. Como posso ajudar?',
    ordem: 0,
  },
  {
    titulo: 'Pagamento confirmado',
    atalho: 'pago',
    texto:
      'Oi, {{cliente}}! O pagamento do seu pedido {{pedido}} foi confirmado. Já estamos preparando o envio.',
    ordem: 1,
  },
  {
    titulo: 'Código de rastreio',
    atalho: 'rastreio',
    texto:
      '{{cliente}}, o código de rastreio do seu pedido é {{codigo_rastreio}}. Acompanhe por aqui: {{link_rastreio}}',
    ordem: 2,
  },
  {
    titulo: 'Aguardando pagamento',
    atalho: 'pagamento',
    texto:
      'Oi, {{cliente}}! Seu pedido {{pedido}} ainda está aguardando o pagamento. Se precisar de ajuda para concluir, é só responder aqui.',
    ordem: 3,
  },
  {
    titulo: 'Pedido a caminho',
    atalho: 'caminho',
    texto: 'Boa notícia, {{cliente}}! Seu pedido {{pedido}} já está a caminho. Acompanhe: {{link_rastreio}}',
    ordem: 4,
  },
]

function paraApi(t: TemplateApi): TemplateApi {
  return { id: t.id, titulo: t.titulo, atalho: t.atalho, texto: t.texto, ordem: t.ordem }
}

function atalhoColidiu(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

export async function listarTemplates(userId: string, perfilId: string): Promise<TemplateApi[]> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const existentes = await prisma.templateWhatsapp.count({ where: { perfilId } })
  if (existentes === 0) {
    await prisma.templateWhatsapp.createMany({
      data: PADROES.map((p) => ({ ...p, perfilId })),
      skipDuplicates: true,
    })
  }

  const templates = await prisma.templateWhatsapp.findMany({
    where: { perfilId },
    orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
  })
  return templates.map(paraApi)
}

export async function criarTemplate(
  userId: string,
  perfilId: string,
  dados: DadosTemplate,
): Promise<TemplateApi> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
  try {
    const ordem = dados.ordem ?? (await prisma.templateWhatsapp.count({ where: { perfilId } }))
    return paraApi(
      await prisma.templateWhatsapp.create({
        data: { perfilId, titulo: dados.titulo, atalho: dados.atalho, texto: dados.texto, ordem },
      }),
    )
  } catch (erro) {
    if (atalhoColidiu(erro)) throw new AtalhoRepetidoError()
    throw erro
  }
}

async function templateDaConta(userId: string, id: string) {
  const template = await prisma.templateWhatsapp.findUnique({ where: { id } })
  if (!template || !(await acharPerfil(userId, template.perfilId))) {
    throw new NaoAutorizadoError('Resposta pronta não encontrada.')
  }
  return template
}

export async function atualizarTemplate(
  userId: string,
  id: string,
  dados: DadosTemplate,
): Promise<TemplateApi> {
  await templateDaConta(userId, id)
  try {
    return paraApi(
      await prisma.templateWhatsapp.update({
        where: { id },
        data: {
          titulo: dados.titulo,
          atalho: dados.atalho,
          texto: dados.texto,
          ...(dados.ordem === undefined ? {} : { ordem: dados.ordem }),
        },
      }),
    )
  } catch (erro) {
    if (atalhoColidiu(erro)) throw new AtalhoRepetidoError()
    throw erro
  }
}

export async function apagarTemplate(userId: string, id: string): Promise<void> {
  await templateDaConta(userId, id)
  await prisma.templateWhatsapp.delete({ where: { id } })
}

/**
 * O envio e o pedido mais recentes daquele telefone, na loja.
 *
 * Pelos últimos oito dígitos, como o robô: a loja cadastra com e sem 55, com
 * e sem o nono dígito. Sem telefone (conversa `@lid`) não há busca — a
 * alternativa, casar com string vazia, traria o pedido de outra pessoa.
 */
async function dadosDoPedido(perfilId: string, telefone: string | null) {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  const final = (digitos.startsWith('55') ? digitos.slice(2) : digitos).slice(-8)
  if (final.length < 8) return { pedido: null, codigo: null }

  /*
    O telefone do destinatário é texto livre da loja: "(11) 96666-5555" não
    contém "66665555". Compara só os dígitos, no banco — `string_contains` do
    Prisma olha o texto cru e não achava o envio de quem cadastrou formatado.
  */
  const [envios, pedido] = await Promise.all([
    prisma.$queryRaw<Array<{ codigoRastreio: string | null; referenciaExterna: string | null }>>`
      SELECT "codigoRastreio", "referenciaExterna"
      FROM "shipments"
      WHERE "perfilId" = ${perfilId}
        AND regexp_replace(COALESCE("destinatario"->>'telefone', ''), '\\D', '', 'g') LIKE ${'%' + final}
      ORDER BY "criadoEm" DESC
      LIMIT 1
    `,
    prisma.pedido.findFirst({
      where: { perfilId, clienteFone: { endsWith: final } },
      orderBy: { criadoEm: 'desc' },
      select: { externalId: true },
    }),
  ])

  const envio = envios[0]
  return {
    pedido: envio?.referenciaExterna ?? pedido?.externalId ?? null,
    codigo: envio?.codigoRastreio ?? null,
  }
}

/** Texto do template com as variáveis daquela conversa já preenchidas. */
export async function aplicarTemplate(
  userId: string,
  conversaId: string,
  templateId: string,
): Promise<string> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: {
      perfilId: true,
      nomeContato: true,
      telefone: true,
      loja: { select: { nome: true, nomeExibicao: true } },
    },
  })
  if (!conversa || !(await acharPerfil(userId, conversa.perfilId))) {
    throw new NaoAutorizadoError('Conversa não encontrada.')
  }

  const template = await prisma.templateWhatsapp.findUnique({ where: { id: templateId } })
  // Template de outra loja da MESMA conta também não serve: as variáveis
  // seriam preenchidas com a loja errada.
  if (!template || template.perfilId !== conversa.perfilId) {
    throw new NaoAutorizadoError('Resposta pronta não encontrada.')
  }

  const { pedido, codigo } = await dadosDoPedido(conversa.perfilId, conversa.telefone)

  return compor(template.texto, {
    cliente: conversa.nomeContato,
    loja: conversa.loja.nomeExibicao ?? conversa.loja.nome,
    pedido,
    codigo_rastreio: codigo,
    link_rastreio: codigo ? `${env.APP_URL}/r/${codigo}` : null,
  })
}

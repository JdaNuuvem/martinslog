import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError, NaoAutorizadoError } from '@/domain/errors'
import { cifrar, decifrar, dicaDaChave } from '@/infra/crypto/segredo'
import { enviarTemplate, normalizarTelefone, verificarCredencial } from '@/infra/whatsapp/cloud-api'
import { montarParametros } from '@/domain/mensagem/eventos'
import { acharPerfil } from '@/server/perfil-service'

/**
 * WhatsApp por perfil: guardar a credencial, provar que ela funciona e
 * entregar as mensagens.
 *
 * A fila segue o mesmo desenho da de webhooks (`webhook-service.ts`): a
 * mensagem é gravada primeiro e enviada depois, por um disparo periódico.
 * Enviar dentro da transação do evento amarraria o pagamento de um envio à
 * disponibilidade da Meta — e um timeout de lá derrubaria o checkout daqui.
 */

/** Espera antes de cada nova tentativa, em minutos. */
const ATRASOS_MINUTOS = [2, 10, 60, 360] as const
const MAXIMO_TENTATIVAS = ATRASOS_MINUTOS.length + 1

/** Quantas mensagens um disparo processa por vez. */
const LOTE_PADRAO = 25

/**
 * Teto de tempo do disparo inteiro. O laço é sequencial: sem ele, um lote com
 * destinos lentos multiplica o tempo limite individual pelo tamanho do lote.
 */
const ORCAMENTO_MS = 25_000

function proximaTentativaEm(tentativasFeitas: number, agora = new Date()): Date | null {
  const atraso = ATRASOS_MINUTOS[tentativasFeitas - 1]
  if (atraso === undefined) return null
  return new Date(agora.getTime() + atraso * 60 * 1000)
}

/* ===================== Configuração ===================== */

export type ConfigVisivel = {
  phoneNumberId: string
  wabaId: string | null
  dicaToken: string
  numeroExibicao: string | null
  ativo: boolean
  verificadaEm: Date | null
  ultimoErro: string | null
}

/**
 * O que a tela pode ver. Nunca inclui `tokenCifrado`: um token de terceiro que
 * volta em leitura transforma qualquer falha de autorização numa tela em
 * permissão de enviar mensagem em nome da loja, com o número dela.
 */
export async function obterConfig(userId: string, perfilId: string): Promise<ConfigVisivel | null> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const config = await prisma.whatsappConfig.findUnique({
    where: { perfilId },
    select: {
      phoneNumberId: true,
      wabaId: true,
      dicaToken: true,
      numeroExibicao: true,
      ativo: true,
      verificadaEm: true,
      ultimoErro: true,
    },
  })

  return config
}

export type EntradaConfig = {
  phoneNumberId: string
  wabaId?: string | null
  /** Token permanente da Meta. Ausente numa atualização, mantém o atual. */
  token?: string | null
}

/**
 * Salva a credencial e **prova que ela funciona antes de gravar como ativa**.
 *
 * Gravar sem verificar deixaria a tela dizendo "conectado" para um token
 * digitado errado, e o lojista só descobriria na primeira venda que não avisou
 * ninguém — quando o prejuízo já aconteceu e não há como reenviar o momento.
 */
export async function salvarConfig(userId: string, perfilId: string, entrada: EntradaConfig) {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const phoneNumberId = entrada.phoneNumberId.trim()
  if (!/^\d{5,}$/.test(phoneNumberId)) {
    throw new ArquivoInvalidoError(
      'O ID do número (phone_number_id) é a sequência de dígitos que aparece no painel da Meta.',
    )
  }

  const atual = await prisma.whatsappConfig.findUnique({ where: { perfilId } })
  const token = entrada.token?.trim()

  if (!token && !atual) {
    throw new ArquivoInvalidoError('Informe o token permanente da Meta.')
  }

  const tokenClaro = token || decifrar(atual!.tokenCifrado)

  const prova = await verificarCredencial(phoneNumberId, tokenClaro)
  if (!prova.ok) {
    throw new ArquivoInvalidoError(
      `A Meta recusou estas credenciais: ${prova.mensagem}. ` +
        'Confira o ID do número e se o token é permanente, não temporário.',
    )
  }

  const dados = {
    phoneNumberId,
    wabaId: entrada.wabaId?.trim() || null,
    numeroExibicao: prova.numeroExibicao,
    ativo: true,
    verificadaEm: new Date(),
    ultimoErro: null,
    ...(token ? { tokenCifrado: cifrar(token), dicaToken: dicaDaChave(token) } : {}),
  }

  return prisma.whatsappConfig.upsert({
    where: { perfilId },
    create: {
      perfilId,
      tokenCifrado: cifrar(tokenClaro),
      dicaToken: dicaDaChave(tokenClaro),
      ...dados,
    },
    update: dados,
  })
}

export async function desconectar(userId: string, perfilId: string): Promise<void> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
  await prisma.whatsappConfig.deleteMany({ where: { perfilId } })
}

/* ===================== Enfileiramento ===================== */

export type PedidoDeMensagem = {
  perfilId: string
  evento: string
  para: string
  pedidoId?: string | null
  shipmentId?: string | null
  /** Valores das variáveis, por chave do catálogo de eventos. */
  valores: Record<string, string | null | undefined>
}

/**
 * Põe uma mensagem na fila, se houver template ativo para o evento.
 *
 * Silêncio é resposta válida aqui: perfil sem WhatsApp conectado, ou evento
 * sem template, significa que o lojista não pediu essa mensagem. Tratar isso
 * como erro encheria o log de falhas que não são falhas e esconderia as
 * verdadeiras.
 *
 * A chave única do banco é o que garante que reprocessar um evento não manda a
 * mensagem duas vezes — a verificação em código sozinha perde a corrida entre
 * dois disparos simultâneos.
 */
export async function enfileirarMensagem(entrada: PedidoDeMensagem): Promise<'enfileirada' | 'sem-template' | 'sem-whatsapp' | 'telefone-invalido' | 'repetida'> {
  const config = await prisma.whatsappConfig.findUnique({
    where: { perfilId: entrada.perfilId },
    select: { ativo: true, verificadaEm: true },
  })
  if (!config?.ativo || !config.verificadaEm) return 'sem-whatsapp'

  const template = await prisma.mensagemTemplate.findUnique({
    where: { perfilId_evento: { perfilId: entrada.perfilId, evento: entrada.evento } },
  })
  if (!template || !template.ativo) return 'sem-template'

  const para = normalizarTelefone(entrada.para)
  if (!para) return 'telefone-invalido'

  try {
    await prisma.mensagemEnvio.create({
      data: {
        perfilId: entrada.perfilId,
        templateId: template.id,
        pedidoId: entrada.pedidoId ?? null,
        shipmentId: entrada.shipmentId ?? null,
        evento: entrada.evento,
        para,
        proximaTentativaEm: new Date(),
      },
    })
    return 'enfileirada'
  } catch (erro) {
    // Violação da chave única: a mensagem já existe para este evento e este
    // pedido/envio. É o caminho normal quando um evento é reprocessado.
    if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') {
      return 'repetida'
    }
    throw erro
  }
}

/* ===================== Disparo ===================== */

export type ResultadoDisparo = {
  enviadas: number
  falhas: number
  desistidas: number
  restantes: number
}

/**
 * Processa as mensagens vencidas.
 *
 * Como a fila de webhooks, é sob demanda: quem chama é o agendador. Enquanto
 * ninguém chamar, nada se perde — as mensagens ficam pendentes no banco.
 */
export async function dispararPendentes(limite = LOTE_PADRAO): Promise<ResultadoDisparo> {
  const comecou = Date.now()
  const agora = new Date()

  const pendentes = await prisma.mensagemEnvio.findMany({
    where: {
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: agora },
    },
    orderBy: { proximaTentativaEm: 'asc' },
    take: limite,
    include: {
      template: true,
      pedido: true,
      perfil: { select: { nome: true, whatsappConfig: true } },
    },
  })

  let enviadas = 0
  let falhas = 0
  let desistidas = 0

  for (const item of pendentes) {
    if (Date.now() - comecou > ORCAMENTO_MS) break

    const config = item.perfil.whatsappConfig
    if (!config || !config.ativo || !item.template) {
      // A credencial foi removida ou o template apagado depois do
      // enfileiramento. Não é falha de rede: insistir nunca vai funcionar.
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'DESISTIU',
          erro: 'WhatsApp desconectado ou template removido depois do agendamento.',
          proximaTentativaEm: null,
        },
      })
      desistidas++
      continue
    }

    const ordem = Array.isArray(item.template.variaveis)
      ? (item.template.variaveis as unknown[]).map(String)
      : []

    const resultado = await enviarTemplate({
      phoneNumberId: config.phoneNumberId,
      token: decifrar(config.tokenCifrado),
      para: item.para,
      nomeTemplate: item.template.nome,
      idioma: item.template.idioma,
      parametros: montarParametros(ordem, valoresDe(item)),
    })

    if (resultado.ok) {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'ENVIADA',
          idExterno: resultado.idExterno,
          enviadaEm: new Date(),
          tentativas: item.tentativas + 1,
          erro: null,
          proximaTentativaEm: null,
        },
      })
      enviadas++
      continue
    }

    const tentativas = item.tentativas + 1
    const proxima = resultado.retentavel ? proximaTentativaEm(tentativas) : null
    const desistiu = proxima === null

    await prisma.mensagemEnvio.update({
      where: { id: item.id },
      data: {
        status: desistiu ? 'DESISTIU' : 'PENDENTE',
        tentativas,
        erro: resultado.codigo ? `[${resultado.codigo}] ${resultado.mensagem}` : resultado.mensagem,
        proximaTentativaEm: proxima,
      },
    })

    /*
      Credencial inválida derruba o perfil inteiro, não só esta mensagem: com
      um token vencido, toda mensagem seguinte falharia igual, e a tela
      continuaria dizendo "conectado". Marcar aqui é o que faz o lojista
      descobrir pelo painel em vez de pelo cliente reclamando.
    */
    if (resultado.codigo === 190) {
      await prisma.whatsappConfig.update({
        where: { perfilId: item.perfilId },
        data: { verificadaEm: null, ultimoErro: resultado.mensagem },
      })
    }

    if (desistiu) desistidas++
    else falhas++
  }

  const restantes = await prisma.mensagemEnvio.count({
    where: {
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
  })

  return { enviadas, falhas, desistidas, restantes }
}

/**
 * Valores das variáveis no momento do envio.
 *
 * Lidos agora, e não congelados no enfileiramento, de propósito: entre a fila
 * e o envio o pedido pode ter sido pago, e mandar "conclua sua compra" para
 * quem já pagou é pior do que não mandar nada.
 */
function valoresDe(item: {
  para: string
  perfil: { nome: string }
  pedido: { clienteNome: string; valorCentavos: number; checkoutUrl: string | null } | null
}): Record<string, string> {
  const valores: Record<string, string> = { loja: item.perfil.nome }

  if (item.pedido) {
    valores.cliente = item.pedido.clienteNome
    valores.valor = (item.pedido.valorCentavos / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
    valores.link_checkout = item.pedido.checkoutUrl ?? ''
  }

  return valores
}

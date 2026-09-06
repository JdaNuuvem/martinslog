import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError, NaoAutorizadoError } from '@/domain/errors'
import { cifrar, decifrar, dicaDaChave } from '@/infra/crypto/segredo'
import { enviarTemplate, normalizarTelefone, verificarCredencial } from '@/infra/whatsapp/cloud-api'
import { montarParametros } from '@/domain/mensagem/eventos'
import { catalogoPronto } from '@/domain/mensagem/whatsapp-textos'
import { acharPerfil } from '@/server/perfil-service'
import { cancelarCobrancasDePedidoResolvido } from '@/server/recuperacao-service'

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

  const config = await prisma.whatsappConfig.upsert({
    where: { perfilId },
    create: {
      perfilId,
      tokenCifrado: cifrar(tokenClaro),
      dicaToken: dicaDaChave(tokenClaro),
      ...dados,
    },
    update: dados,
  })

  await espelharTextosPadrao(perfilId)

  return config
}

/**
 * Copia os textos prontos do catálogo para os templates deste perfil.
 *
 * Sem isto, o canal ficava mudo mesmo com a conta conectada: `enfileirarMensagem`
 * exige um `MensagemTemplate` de canal `WHATSAPP`, e **nada em todo o projeto
 * criava um**. A única escrita naquela tabela era a do SMS. A conta conectava,
 * o lojista via tudo verde e nenhuma mensagem saía.
 *
 * Nasce **inativo**, de propósito. A linha aqui é o espelho local de um texto
 * que precisa estar APROVADO na Meta — cadastrar lá é passo separado, feito por
 * quem é dono do número. Marcar ativo agora enfileiraria mensagem para um
 * template que a Meta ainda não conhece, e cada recusa dessas conta contra a
 * reputação do número.
 *
 * Não toca no que já existe: um texto que o lojista editou ou já ativou fica
 * como está.
 */
async function espelharTextosPadrao(perfilId: string): Promise<void> {
  for (const texto of catalogoPronto()) {
    try {
      await prisma.mensagemTemplate.create({
        data: {
          perfilId,
          canal: 'WHATSAPP',
          // `EventoMensagem` é uma união de literais; a coluna é texto livre
          // porque o catálogo de status é personalizável por conta.
          evento: String(texto.evento),
          nome: texto.nome,
          idioma: texto.idioma,
          previa: texto.corpo,
          variaveis: texto.variaveis,
          ativo: false,
        },
      })
    } catch (erro) {
      // Violação da chave única: o texto já existe para este perfil e evento.
      // É o caminho normal de quem reconecta a conta.
      if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') continue
      throw erro
    }
  }
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
    where: {
      perfilId_evento_canal: {
        perfilId: entrada.perfilId,
        evento: entrada.evento,
        canal: 'WHATSAPP',
      },
    },
  })
  if (!template || !template.ativo) return 'sem-template'

  const para = normalizarTelefone(entrada.para)
  if (!para) return 'telefone-invalido'

  try {
    await prisma.mensagemEnvio.create({
      data: {
        perfilId: entrada.perfilId,
        canal: 'WHATSAPP',
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

  /*
    Antes de qualquer envio, tira da fila a cobrança de pedido que já foi pago
    ou cancelado. Ler os valores frescos na hora do envio — o que `valoresDe`
    faz — não bastava: lia o pedido pago e mandava "conclua sua compra" mesmo
    assim, que é exatamente o que aquele comentário dizia ser pior do que não
    mandar nada.
  */
  await cancelarCobrancasDePedidoResolvido()

  const pendentes = await prisma.mensagemEnvio.findMany({
    where: {
      /*
        SÓ WhatsApp. Sem este filtro, esta fila varria também os SMS
        pendentes e tentava mandá-los pela Meta — que os recusaria, gastando
        as tentativas de cada um até o `DESISTIU`. O comprador nunca receberia
        o SMS, e o motivo gravado seria um erro do WhatsApp, apontando para o
        lugar errado. A fila irmã (`dispararSmsPendentes`) sempre filtrou por
        canal; esta não filtrava, e as duas rodam de minuto em minuto pelo
        mesmo agendador.
      */
      canal: 'WHATSAPP',
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
      parametros: montarParametros(ordem, await valoresDe(item)),
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
async function valoresDe(item: {
  para: string
  shipmentId: string | null
  perfil: { nome: string }
  pedido: { clienteNome: string; valorCentavos: number; checkoutUrl: string | null } | null
}): Promise<Record<string, string>> {
  const base = process.env.APP_URL ?? 'https://app.martinslog.net'
  const valores: Record<string, string> = { loja: item.perfil.nome }

  if (item.pedido) {
    valores.cliente = item.pedido.clienteNome
    valores.valor = (item.pedido.valorCentavos / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
    valores.link_checkout = item.pedido.checkoutUrl ?? ''
  }

  /*
    O rastreio faltava aqui, e o catálogo de textos tem um template inteiro
    sobre ele (`ETIQUETA_EMITIDA`: "já tem código de rastreio:
    {{codigo_rastreio}}"). Sem estes valores, esse texto sairia com as duas
    variáveis vazias — a mesma mensagem quebrada que o lado do SMS já
    aprendeu a não mandar.
  */
  if (item.shipmentId) {
    const envio = await prisma.shipment.findUnique({
      where: { id: item.shipmentId },
      select: { codigoRastreio: true, destinatario: true },
    })

    if (envio?.codigoRastreio) {
      valores.codigo_rastreio = envio.codigoRastreio
      valores.link_rastreio = `${base}/r/${envio.codigoRastreio}`
    }

    const destinatario = envio?.destinatario as { nome?: string } | null
    if (!valores.cliente && destinatario?.nome) {
      valores.cliente = destinatario.nome
    }
  }

  return valores
}

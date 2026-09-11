import type { CanalMensagem } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { env } from '@/env'
import { cifrar, decifrar, dicaDaChave } from '@/infra/crypto/segredo'
import { smsProvider, type CredenciaisSms } from '@/infra/sms'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { compor, custoDoTexto, TEXTOS_PADRAO_SMS } from '@/domain/mensagem/texto'
import { montarValores } from '@/server/valores-da-mensagem'

/**
 * Canal de SMS: da configuração ao envio.
 *
 * A fila e o histórico são os mesmos do WhatsApp (`MensagemEnvio`), porque o
 * problema é o mesmo: gravar primeiro, enviar depois, registrar o motivo de
 * cada falha. O que muda é onde o texto mora — no WhatsApp ele vive aprovado
 * na Meta, aqui ele é nosso.
 */

/** Espera antes de cada nova tentativa, em minutos. */
const ATRASOS_MINUTOS = [2, 10, 60, 360] as const
const MAXIMO_TENTATIVAS = ATRASOS_MINUTOS.length + 1

const LOTE_PADRAO = 25
const ORCAMENTO_MS = 25_000

function proximaTentativaEm(tentativasFeitas: number, agora = new Date()): Date | null {
  const atraso = ATRASOS_MINUTOS[tentativasFeitas - 1]
  if (atraso === undefined) return null
  return new Date(atraso * 60 * 1000 + agora.getTime())
}

/* ===================== Credenciais ===================== */

export type OrigemCredencial = 'perfil' | 'plataforma' | 'nenhuma'

export type CredencialResolvida = {
  origem: OrigemCredencial
  provedor: string
  credenciais: CredenciaisSms | null
}

/**
 * De quem é a conta que vai pagar este envio.
 *
 * O perfil tem precedência sobre a plataforma. A ordem importa: a loja que se
 * deu ao trabalho de contratar a própria conta espera aparecer como o próprio
 * remetente e pagar o próprio envio — cair na conta da plataforma sem aviso
 * seria a plataforma pagando pelo que não é dela.
 *
 * Sem nenhuma das duas, devolve `nenhuma` em vez de estourar. Não é erro: é
 * uma conta que ainda não ligou o canal, e a fila registra isso no histórico.
 */
export async function resolverCredencial(perfilId: string): Promise<CredencialResolvida> {
  const doPerfil = await prisma.smsConfig.findUnique({ where: { perfilId } })

  if (doPerfil?.ativo) {
    return {
      origem: 'perfil',
      provedor: doPerfil.provedor,
      credenciais: {
        identificador: doPerfil.identificador,
        chave: decifrar(doPerfil.chaveCifrada),
        remetente: doPerfil.remetente,
      },
    }
  }

  if (env.SMS_CHAVE && env.SMS_PROVEDOR) {
    return {
      origem: 'plataforma',
      provedor: env.SMS_PROVEDOR,
      credenciais: {
        identificador: env.SMS_IDENTIFICADOR ?? null,
        chave: env.SMS_CHAVE,
        remetente: env.SMS_REMETENTE ?? null,
      },
    }
  }

  return { origem: 'nenhuma', provedor: 'registrado', credenciais: null }
}

export type EntradaConfigSms = {
  provedor: string
  chave?: string | null
  identificador?: string | null
  remetente?: string | null
}

export type ConfigSmsVisivel = {
  provedor: string
  identificador: string | null
  dicaChave: string
  remetente: string | null
  ativo: boolean
  verificadaEm: Date | null
  ultimoErro: string | null
}

/**
 * Configuração visível de uma loja. A chave **nunca** sai daqui — só a dica.
 *
 * Um segredo que volta numa resposta transforma qualquer falha de autorização
 * em permissão de mandar SMS na conta do lojista, que é dinheiro dele.
 */
export async function obterConfig(
  userId: string,
  perfilId: string,
): Promise<ConfigSmsVisivel | null> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  return prisma.smsConfig.findUnique({
    where: { perfilId },
    select: {
      provedor: true,
      identificador: true,
      dicaChave: true,
      remetente: true,
      ativo: true,
      verificadaEm: true,
      ultimoErro: true,
    },
  })
}

/**
 * Guarda a conta própria de uma loja. A chave nunca volta em leitura.
 *
 * `userId` não é enfeite: sem ele, quem chamasse com o `perfilId` de outra
 * conta gravaria credencial na loja alheia. O perfil é sempre conferido
 * contra o dono da sessão.
 */
export async function salvarConfig(userId: string, perfilId: string, entrada: EntradaConfigSms) {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const atual = await prisma.smsConfig.findUnique({ where: { perfilId } })
  const chave = entrada.chave?.trim()

  if (!chave && !atual) {
    throw new Error('Informe a chave do provedor de SMS.')
  }

  const dados = {
    provedor: entrada.provedor.trim().toLowerCase(),
    identificador: entrada.identificador?.trim() || null,
    remetente: entrada.remetente?.trim() || null,
    ativo: true,
    ...(chave ? { chaveCifrada: cifrar(chave), dicaChave: dicaDaChave(chave) } : {}),
  }

  return prisma.smsConfig.upsert({
    where: { perfilId },
    create: { perfilId, chaveCifrada: cifrar(chave!), dicaChave: dicaDaChave(chave!), ...dados },
    update: dados,
  })
}

/**
 * Desliga o SMS da loja.
 *
 * Apaga a linha em vez de só marcar `ativo: false`: o que se quer ao
 * desconectar é que a chave do provedor deixe de existir aqui. Uma credencial
 * inativa continua sendo uma credencial guardada.
 *
 * A fila não é tocada — mensagens já registradas seguem no histórico, e
 * `resolverCredencial` passa a devolver `nenhuma`, que a fila trata sem erro.
 */
export async function desconectar(userId: string, perfilId: string): Promise<void> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
  await prisma.smsConfig.deleteMany({ where: { perfilId } })
}

/* ===================== Textos ===================== */

/**
 * Garante que a loja tenha um texto para o evento.
 *
 * Cria o padrão na primeira vez em que o evento acontece, em vez de exigir
 * que alguém preencha uma tela antes de a primeira venda ser avisada. Um canal
 * ligado que não manda nada porque ninguém escreveu o texto é a forma mais
 * silenciosa de o recurso não existir.
 *
 * O texto é editável depois; este é só o ponto de partida.
 */
export async function garantirTemplate(perfilId: string, evento: string) {
  const existente = await prisma.mensagemTemplate.findUnique({
    where: { perfilId_evento_canal: { perfilId, evento, canal: 'SMS' } },
  })
  if (existente) return existente

  const padrao = TEXTOS_PADRAO_SMS[evento]
  if (!padrao) return null

  return prisma.mensagemTemplate.create({
    data: {
      perfilId,
      canal: 'SMS',
      evento,
      nome: `sms-${evento.toLowerCase()}`,
      previa: padrao,
      variaveis: [],
    },
  })
}

/* ===================== Fila ===================== */

export type PedidoDeSms = {
  perfilId: string
  evento: string
  para: string
  pedidoId?: string | null
  shipmentId?: string | null
  valores: Record<string, string | null | undefined>
}

export type ResultadoEnfileiramento =
  | 'enfileirada'
  | 'sem-template'
  | 'telefone-invalido'
  | 'repetida'
  /**
   * O texto promete o rastreio e ainda não há envio de onde tirá-lo.
   *
   * Não é falha: é o mesmo aviso chegando cedo demais. Quem tem o código é o
   * envio, e ele nasce segundos depois — a mensagem sai de lá, inteira.
   */
  | 'sem-rastreio'

/**
 * Põe um SMS na fila.
 *
 * Diferente do WhatsApp, **não exige credencial configurada**. A mensagem é
 * enfileirada de qualquer jeito e o disparo decide por onde ela sai — inclusive
 * pelo provedor que só registra, quando não há conta contratada.
 *
 * A escolha é deliberada: recusar no enfileiramento faria as mensagens de hoje
 * desaparecerem, e no dia em que a conta fosse ligada não haveria histórico
 * nenhum mostrando o que teria sido enviado. Enfileirar sempre transforma o
 * período sem fornecedor num ensaio observável.
 */
/** O texto promete rastreio? Então precisa de um código para cumprir. */
function precisaRastreio(previa: string): boolean {
  return /\{\{\s*(link_rastreio|codigo_rastreio)\s*\}\}/i.test(previa)
}

export async function enfileirarSms(entrada: PedidoDeSms): Promise<ResultadoEnfileiramento> {
  const template = await garantirTemplate(entrada.perfilId, entrada.evento)
  if (!template || !template.ativo) return 'sem-template'

  const para = normalizarTelefone(entrada.para)
  if (!para) return 'telefone-invalido'

  /*
    Mensagem que promete o rastreio precisa do rastreio.

    O texto padrão de pagamento confirmado é inteiro sobre o link: "Acompanhe
    cada passo da entrega pelo link: {{link_rastreio}}". Esse valor só existe
    quando a mensagem está amarrada a um ENVIO — é dele que sai o código.

    Sem o envio, `compor` substitui por vazio e apara os dois-pontos soltos, e
    o comprador recebe "Acompanhe cada passo da entrega pelo link" e mais nada.
    Uma frase que promete e não entrega; pior do que silêncio, porque parece
    golpe malfeito.

    Isto também é o que impede a mensagem DUPLICADA. O aviso de pagamento
    chega por dois caminhos — o pedido marcado PAGO e o envio pago — e o
    segundo vem segundos depois com o código na mão. Barrar aqui deixa passar
    exatamente um: o que serve.
  */
  if (precisaRastreio(template.previa) && !entrada.shipmentId) return 'sem-rastreio'

  try {
    await prisma.mensagemEnvio.create({
      data: {
        perfilId: entrada.perfilId,
        canal: 'SMS' as CanalMensagem,
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
 * Processa os SMS vencidos.
 *
 * Como a fila de webhooks, é sob demanda: quem chama é o agendador. Enquanto
 * ninguém chamar, nada se perde — as mensagens ficam pendentes no banco.
 */
export async function dispararSmsPendentes(limite = LOTE_PADRAO): Promise<ResultadoDisparo> {
  const comecou = Date.now()

  const pendentes = await prisma.mensagemEnvio.findMany({
    where: {
      canal: 'SMS',
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
    orderBy: { proximaTentativaEm: 'asc' },
    take: limite,
    include: {
      template: true,
      pedido: true,
      perfil: { select: { nome: true, nomeExibicao: true } },
    },
  })

  let enviadas = 0
  let falhas = 0
  let desistidas = 0

  for (const item of pendentes) {
    if (Date.now() - comecou > ORCAMENTO_MS) break

    if (!item.template) {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'DESISTIU',
          erro: 'O texto foi removido depois do agendamento.',
          proximaTentativaEm: null,
        },
      })
      desistidas++
      continue
    }

    const valores = await valoresDe(item)

    /*
      Segunda trava do rastreio, agora na hora de mandar.

      O enfileiramento confere se EXISTE um envio; aqui confere se o envio já
      tem CÓDIGO. Os dois momentos são diferentes: `pagarEnvio` chama o aviso
      logo depois de emitir a etiqueta, e a emissão pode ter tropeçado — ela
      engole a falha de propósito, para não desfazer um débito que já
      aconteceu. Sem esta conferência o comprador recebia "Segue o link de
      rastreio do seu pedido" e nada mais, marcado como ENVIADA, sem
      retentativa nenhuma.

      Reagendar é o certo: a reemissão acontece e o código aparece minutos
      depois. Se nunca aparecer, a mensagem esgota as tentativas e some da
      fila com o motivo escrito — visível, em vez de entregue e errada.
    */
    if (precisaRastreio(item.template.previa) && !valores.link_rastreio) {
      const tentativasSemCodigo = item.tentativas + 1
      const proxima = proximaTentativaEm(tentativasSemCodigo)
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: proxima ? 'PENDENTE' : 'DESISTIU',
          tentativas: tentativasSemCodigo,
          erro: 'A etiqueta ainda não tem código de rastreio.',
          proximaTentativaEm: proxima,
        },
      })
      if (proxima) falhas++
      else desistidas++
      continue
    }

    const credencial = await resolverCredencial(item.perfilId)
    const texto = compor(item.template.previa, valores)

    const resultado = await smsProvider.enviar(
      credencial.credenciais ?? { chave: '' },
      { para: item.para, texto, referencia: item.id },
    )

    const tentativas = item.tentativas + 1

    /*
      Sem fornecedor contratado, quem "atende" é o provedor que escreve no log
      e devolve OK. Gravar isso como ENVIADA é a pior das saídas: a fila
      esvazia, o painel diz que a mensagem saiu e o comprador não recebeu
      nada. Uma fila parada é visível; uma fila esvaziada em falso é mentira —
      e foi assim que 33 mensagens sumiram na migração para a máquina nova.

      A mensagem fica PENDENTE e **não consome tentativa**: são cinco no total,
      e queimá-las contra a ausência de credencial faria o histórico desistir
      de gente que nunca teve chance de ser avisada. O texto é composto e
      registrado assim mesmo, que é o motivo de este provedor existir: telefone
      malformado e variável vazia aparecem no log, de graça, antes de haver
      contrato.
    */
    if (smsProvider.nome === 'registrado') {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'PENDENTE',
          texto,
          erro: 'Nenhum provedor de SMS configurado — a mensagem não saiu e continua na fila.',
          proximaTentativaEm: new Date(Date.now() + 15 * 60 * 1000),
          provedor: smsProvider.nome,
        },
      })
      continue
    }

    if (resultado.ok) {
      await prisma.mensagemEnvio.update({
        where: { id: item.id },
        data: {
          status: 'ENVIADA',
          idExterno: resultado.idExterno,
          enviadaEm: new Date(),
          tentativas,
          erro: null,
          proximaTentativaEm: null,
          /*
            Congela o texto EXATO que saiu. Recompor depois mostraria uma
            mensagem que ninguém recebeu: o template pode ser editado e o
            código de rastreio pode mudar. Quando o comprador diz "veio
            errada", esta é a única resposta possível.
          */
          texto,
          /*
            Grava o provedor que de fato atendeu, e não o configurado: sem
            fornecedor contratado quem atende é o que só registra, e o
            histórico precisa dizer isso. Do contrário, "enviada" mentiria.
            */
          provedor: smsProvider.nome,
        },
      })
      enviadas++
      continue
    }

    const proxima = resultado.retentavel ? proximaTentativaEm(tentativas) : null
    const desistiu = proxima === null

    await prisma.mensagemEnvio.update({
      where: { id: item.id },
      data: {
        status: desistiu ? 'DESISTIU' : 'PENDENTE',
        tentativas,
        // O texto vai junto mesmo na falha: metade das recusas de operadora se
        // explicam olhando o que se tentou mandar.
        texto,
        erro: resultado.codigo ? `[${resultado.codigo}] ${resultado.mensagem}` : resultado.mensagem,
        proximaTentativaEm: proxima,
        provedor: smsProvider.nome,
      },
    })

    if (desistiu) desistidas++
    else falhas++
  }

  const restantes = await prisma.mensagemEnvio.count({
    where: {
      canal: 'SMS',
      status: 'PENDENTE',
      tentativas: { lt: MAXIMO_TENTATIVAS },
      proximaTentativaEm: { lte: new Date() },
    },
  })

  return { enviadas, falhas, desistidas, restantes }
}

/**
 * Valores das variáveis, lidos no momento do envio.
 *
 * Não congelados no enfileiramento de propósito: entre a fila e o disparo o
 * envio pode ter ganhado código de rastreio, e mandar o aviso sem o link seria
 * mandar metade da mensagem.
 */
async function valoresDe(item: {
  perfilId: string
  shipmentId: string | null
  perfil: { nome: string; nomeExibicao: string | null }
  pedido: {
    clienteNome: string
    valorCentavos: number
    checkoutUrl: string | null
    externalId?: string | null
    produtos?: unknown
  } | null
}): Promise<Record<string, string>> {
  return montarValores(item)
}

export { custoDoTexto }

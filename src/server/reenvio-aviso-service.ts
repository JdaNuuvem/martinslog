import type { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { env } from '@/env'
import { enviarAtualizacao } from './email-service'
import { enfileirarSms } from './sms-service'
import { enfileirarMensagem } from './whatsapp-service'

/**
 * Reenvio manual do aviso de situação ao comprador.
 *
 * Existe para o caso que o suporte recebe todo dia: "não recebi o código".
 * O aviso automático sai uma vez só — e é assim de propósito, senão cada
 * leitura da página de rastreio dispararia outro —, então quando a mensagem
 * se perde no caminho não havia como mandá-la de novo sem mexer no banco à
 * mão.
 *
 * O que é reenviado é o aviso da situação ATUAL, não o histórico inteiro.
 * Remandar a linha do tempo toda faria o comprador receber "objeto postado"
 * depois de já ter recebido o pacote.
 */

/** Como cada canal respondeu ao pedido de reenvio. */
export type ResultadoCanal = {
  canal: 'SMS' | 'WHATSAPP' | 'EMAIL'
  /**
   * `reenfileirada` é a mensagem que já existia e voltou para a fila;
   * `enfileirada` é a que nunca chegou a existir e foi criada agora;
   * `enviada` é o e-mail, que sai na hora e não tem fila.
   */
  resultado: 'reenfileirada' | 'enfileirada' | 'enviada' | 'sem-destino' | 'sem-canal'
}

export type ResultadoReenvio = {
  /** Código do evento cuja mensagem foi reenviada. */
  evento: string
  titulo: string
  canais: ResultadoCanal[]
}

/**
 * Situações de mensagem que um reenvio pode ressuscitar.
 *
 * `PENDENTE` fica de fora: a mensagem ainda não saiu, está na fila e vai sair
 * sozinha. Devolvê-la para a fila não a faria sair mais cedo — só zeraria o
 * contador de tentativas de algo que já está em curso.
 */
const REENFILEIRAVEIS = ['ENVIADA', 'FALHA', 'DESISTIU'] as const

type DestinatarioGravado = {
  nome?: string
  email?: string
  telefone?: string
  cidade?: string
  uf?: string
}

/**
 * Reenvia, pelos canais que a loja tem configurados, o aviso da situação
 * atual do envio.
 *
 * Não cria canal nenhum: quem não tem WhatsApp conectado continua sem
 * WhatsApp, e o resultado diz isso em vez de falhar. O reenvio é uma
 * repetição do que já deveria ter saído, não uma configuração nova.
 *
 * A recusa de recebimento (o "pare de me mandar mensagem") é respeitada
 * porque ela é verificada no DISPARO, não aqui — ver `podeEnviar` em
 * `sms-service`. Um reenvio para quem pediu para parar entra na fila e é
 * descartado lá, como qualquer outro.
 */
export async function reenviarAvisoDoStatus(
  userId: string,
  shipmentId: string,
  agora: Date = new Date(),
): Promise<ResultadoReenvio> {
  const envio = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      userId: true,
      perfilId: true,
      sandbox: true,
      codigoRastreio: true,
      destinatario: true,
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
        take: 1,
      },
    },
  })

  // Envio inexistente e envio de outro dono dão a mesma resposta: quem chuta
  // um id não descobre se ele existe.
  if (!envio || envio.userId !== userId) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${shipmentId}`)
  }

  if (envio.sandbox) {
    throw new ValorInvalidoError(
      'Este é um envio de teste: não há comprador de verdade para avisar.',
    )
  }

  const evento = envio.trackingEvents[0]
  if (!envio.codigoRastreio || !evento) {
    throw new ValorInvalidoError(
      'Este envio ainda não tem nenhuma movimentação: não há aviso para reenviar.',
    )
  }

  const destinatario = (envio.destinatario as DestinatarioGravado | null) ?? {}
  const telefone = destinatario.telefone?.trim()
  const email = destinatario.email?.trim()

  const canais: ResultadoCanal[] = []

  /*
    Primeiro as mensagens que JÁ EXISTEM.

    Devolvê-las para a fila, em vez de criar linhas novas, é o que mantém a
    trava contra duplicata de pé: continua havendo uma mensagem por
    (perfil, evento, canal, envio), que é o que o índice único promete. E o
    texto já está congelado na linha — o comprador recebe exatamente o que
    deveria ter recebido, mesmo que o template tenha sido editado desde
    então.
  */
  const existentes = await prisma.mensagemEnvio.findMany({
    where: { shipmentId: envio.id, evento: evento.codigo, canal: { in: ['SMS', 'WHATSAPP'] } },
    select: { id: true, canal: true, status: true },
  })

  for (const mensagem of existentes) {
    if (!REENFILEIRAVEIS.includes(mensagem.status as (typeof REENFILEIRAVEIS)[number])) {
      continue
    }

    await prisma.mensagemEnvio.update({
      where: { id: mensagem.id },
      data: { status: 'PENDENTE', tentativas: 0, erro: null, proximaTentativaEm: agora },
    })
    canais.push({ canal: mensagem.canal as 'SMS' | 'WHATSAPP', resultado: 'reenfileirada' })
  }

  /*
    Depois os canais que nunca tiveram mensagem para este evento.

    Acontece o tempo todo: a mudança de situação avisa por e-mail, e SMS e
    WhatsApp só entram em eventos específicos. Aqui o reenvio é o PRIMEIRO
    envio — e é justamente o que quem clica no botão quer.
  */
  const jaTem = new Set(existentes.map((mensagem) => mensagem.canal))

  if (envio.perfilId && telefone) {
    if (!jaTem.has('SMS')) {
      const resultado = await enfileirarSms({
        perfilId: envio.perfilId,
        evento: evento.codigo,
        para: telefone,
        shipmentId: envio.id,
        valores: {},
      })
      canais.push({
        canal: 'SMS',
        resultado: resultado === 'enfileirada' ? 'enfileirada' : 'sem-canal',
      })
    }

    if (!jaTem.has('WHATSAPP')) {
      const resultado = await enfileirarMensagem({
        perfilId: envio.perfilId,
        evento: evento.codigo,
        para: telefone,
        shipmentId: envio.id,
        valores: {},
      })
      canais.push({
        canal: 'WHATSAPP',
        resultado: resultado === 'enfileirada' ? 'enfileirada' : 'sem-canal',
      })
    }
  } else {
    if (!jaTem.has('SMS')) canais.push({ canal: 'SMS', resultado: 'sem-destino' })
    if (!jaTem.has('WHATSAPP')) canais.push({ canal: 'WHATSAPP', resultado: 'sem-destino' })
  }

  canais.push({
    canal: 'EMAIL',
    resultado: email
      ? await reenviarEmail(envio.userId, envio.id, envio.codigoRastreio, email, destinatario, {
          codigo: evento.codigo,
          titulo: evento.titulo,
          descricao: evento.descricao,
          cidade: evento.cidade,
          uf: evento.uf,
        })
      : 'sem-destino',
  })

  /*
    O reenvio vai para o registro de auditoria porque ele TOCA O COMPRADOR:
    quando alguém reclamar de ter recebido a mesma mensagem três vezes, esta
    é a única resposta possível sobre quem mandou e quando.
  */
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      acao: 'AVISO_REENVIADO',
      entidade: 'Shipment',
      entidadeId: envio.id,
      depois: { evento: evento.codigo, canais } as unknown as Prisma.InputJsonValue,
    },
  })

  return { evento: evento.codigo, titulo: evento.titulo, canais }
}

/**
 * Reenvia o e-mail da situação atual.
 *
 * O aviso automático por e-mail é idempotente por `(shipmentId, evento)` —
 * um índice único no banco —, e essa trava existe para que a sincronização,
 * que roda a cada leitura do rastreio, não mande o mesmo aviso repetido.
 *
 * Um reenvio PEDIDO por alguém é outra coisa, e por isso o evento gravado
 * leva um sufixo com o número do reenvio. A alternativa seria apagar o
 * registro anterior para caber no índice, e aí o histórico de e-mails
 * passaria a mentir sobre quantas vezes o comprador foi avisado.
 */
async function reenviarEmail(
  userId: string,
  shipmentId: string,
  codigoRastreio: string,
  email: string,
  destinatario: DestinatarioGravado,
  evento: { codigo: string; titulo: string; descricao: string; cidade: string; uf: string },
): Promise<'enviada' | 'sem-canal'> {
  const anteriores = await prisma.emailDelivery.count({
    where: { shipmentId, evento: { startsWith: evento.codigo } },
  })

  const enviado = await enviarAtualizacao({
    userId,
    shipmentId,
    destinatarioEmail: email,
    codigoRastreio,
    evento: anteriores === 0 ? evento.codigo : `${evento.codigo}:reenvio-${anteriores}`,
    titulo: evento.titulo,
    descricao: evento.descricao,
    cidade: evento.cidade || (destinatario.cidade ?? ''),
    uf: evento.uf || (destinatario.uf ?? ''),
    urlRastreio: `${env.APP_URL}/r/${codigoRastreio}`,
  })

  // `false` aqui é conta sem Resend conectado, não falha de entrega: a falha
  // de entrega fica registrada em `EmailDelivery` e não volta por este
  // caminho.
  return enviado ? 'enviada' : 'sem-canal'
}

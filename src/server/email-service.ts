import { Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import { cifrar, decifrar, dicaDaChave } from '@/infra/crypto/segredo'
import { emailProvider } from '@/infra/email'

/**
 * Envio de atualizações de status por e-mail, pelo Resend da própria conta.
 *
 * O e-mail sai do domínio do cliente, com a chave e a reputação de envio
 * dele. Nós não intermediamos remetente: além de ser o que ele pediu, evita
 * que a entregabilidade de uma conta afete a de outra.
 */

const REMETENTE_VALIDO = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$|^.+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/

export type ConfigEmailVisivel = {
  provedor: string
  dicaChave: string
  remetente: string
  ativo: boolean
}

/**
 * Devolve a configuração **sem a chave**. Este é o único formato que sai do
 * servidor: a chave entra uma vez e nunca volta, nem para o dono dela.
 */
export async function obterConfigEmail(userId: string): Promise<ConfigEmailVisivel | null> {
  const config = await prisma.emailConfig.findUnique({ where: { userId } })
  if (!config) return null

  return {
    provedor: config.provedor,
    dicaChave: config.dicaChave,
    remetente: config.remetente,
    ativo: config.ativo,
  }
}

/**
 * Conecta ou atualiza a conta Resend.
 *
 * A chave é cifrada antes de tocar o banco, e o que fica legível é apenas a
 * dica — prefixo e quatro últimos caracteres. Se a cifragem falhar (chave
 * mestra ausente), nada é gravado: guardar em texto puro por falta de
 * configuração seria o pior dos dois mundos.
 */
export async function conectarEmail(
  userId: string,
  entrada: { apiKey: string; remetente: string },
) {
  const apiKey = entrada.apiKey.trim()
  const remetente = entrada.remetente.trim()

  if (!apiKey) {
    throw new ValorInvalidoError('Informe a chave de API do Resend.')
  }

  if (!REMETENTE_VALIDO.test(remetente)) {
    throw new ValorInvalidoError(
      'Remetente inválido. Use um e-mail do seu domínio verificado, como "Loja <pedidos@sualoja.com.br>".',
    )
  }

  const dados = {
    provedor: 'RESEND',
    apiKeyCifrada: cifrar(apiKey),
    dicaChave: dicaDaChave(apiKey),
    remetente,
    ativo: true,
  }

  const existente = await prisma.emailConfig.findUnique({ where: { userId } })
  const salvo = existente
    ? await prisma.emailConfig.update({ where: { userId }, data: dados })
    : await prisma.emailConfig.create({ data: { userId, ...dados } })

  return {
    provedor: salvo.provedor,
    dicaChave: salvo.dicaChave,
    remetente: salvo.remetente,
    ativo: salvo.ativo,
  }
}

/** Desconecta e apaga a chave. Desligar sem apagar deixaria o segredo parado no banco. */
export async function desconectarEmail(userId: string): Promise<void> {
  await prisma.emailConfig.deleteMany({ where: { userId } })
}

function montarEmail(dados: {
  codigoRastreio: string
  titulo: string
  descricao: string
  cidade: string
  uf: string
  urlRastreio: string
}) {
  const assunto = `${dados.titulo} — ${dados.codigoRastreio}`

  const texto = [
    dados.titulo,
    '',
    dados.descricao,
    `${dados.cidade}/${dados.uf}`,
    '',
    `Código de rastreio: ${dados.codigoRastreio}`,
    `Acompanhe: ${dados.urlRastreio}`,
  ].join('\n')

  // HTML deliberadamente simples: cliente de e-mail engole pouco CSS, e o
  // que importa aqui é o texto chegar legível em qualquer um deles.
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #222;">
      <h2 style="margin: 0 0 8px; font-size: 18px;">${escapar(dados.titulo)}</h2>
      <p style="margin: 0 0 4px;">${escapar(dados.descricao)}</p>
      <p style="margin: 0 0 16px; color: #666;">${escapar(dados.cidade)}/${escapar(dados.uf)}</p>
      <p style="margin: 0 0 4px;">Código de rastreio: <strong>${escapar(dados.codigoRastreio)}</strong></p>
      <p style="margin: 0;"><a href="${escapar(dados.urlRastreio)}">Acompanhar o envio</a></p>
    </div>
  `.trim()

  return { assunto, texto, html }
}

/**
 * Escapa o que vai para o HTML.
 *
 * Título e descrição são escritos pelo dono da conta no construtor de fluxo,
 * e o e-mail é lido por terceiros: sem escapar, quem configura o fluxo
 * injetaria marcação no e-mail de quem recebe.
 */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type AtualizacaoParaEnviar = {
  userId: string
  shipmentId: string
  destinatarioEmail: string
  codigoRastreio: string
  evento: string
  titulo: string
  descricao: string
  cidade: string
  uf: string
  urlRastreio: string
}

/**
 * Envia uma atualização de status ao destinatário.
 *
 * Idempotente por `(shipmentId, evento)`: a sincronização roda a cada leitura
 * do rastreio, e sem essa trava o destinatário receberia o mesmo aviso a cada
 * vez que alguém abrisse a página. O registro é gravado **antes** do envio,
 * de propósito — se gravássemos depois, duas execuções concorrentes
 * enviariam duas vezes antes de qualquer uma registrar.
 *
 * Nunca lança: e-mail é um extra do envio, e uma falha aqui não pode derrubar
 * a operação que o disparou. A falha fica registrada em `EmailDelivery` para
 * o cliente investigar.
 */
export async function enviarAtualizacao(dados: AtualizacaoParaEnviar): Promise<boolean> {
  const config = await prisma.emailConfig.findUnique({ where: { userId: dados.userId } })
  if (!config || !config.ativo) return false
  if (!dados.destinatarioEmail) return false

  const { assunto, texto, html } = montarEmail(dados)

  let registro
  try {
    registro = await prisma.emailDelivery.create({
      data: {
        userId: dados.userId,
        shipmentId: dados.shipmentId,
        para: dados.destinatarioEmail,
        assunto,
        evento: dados.evento,
        status: 'ENVIANDO',
      },
    })
  } catch (error) {
    // Violação do índice único: outra execução já cuidou deste evento.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false
    }
    throw error
  }

  try {
    const resultado = await emailProvider.enviar(decifrar(config.apiKeyCifrada), config.remetente, {
      para: dados.destinatarioEmail,
      assunto,
      html,
      texto,
    })

    await prisma.emailDelivery.update({
      where: { id: registro.id },
      data: { status: 'ENVIADO', idExterno: resultado.id },
    })
    return true
  } catch (error) {
    await prisma.emailDelivery.update({
      where: { id: registro.id },
      data: {
        status: 'FALHOU',
        erro: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido',
      },
    })
    return false
  }
}

/** Últimos envios da conta, para a tela mostrar o que saiu e o que falhou. */
export async function listarEnvios(userId: string, limite = 20) {
  return prisma.emailDelivery.findMany({
    where: { userId },
    orderBy: { criadoEm: 'desc' },
    take: limite,
  })
}

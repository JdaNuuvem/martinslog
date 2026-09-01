import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { StatusShipment } from '@/domain/shipment/estados'
import type { RastreioResposta } from '@/lib/rastreio-schema'
import { sincronizarEnvio } from './sincronizar-envio-service'
import { obterTemplate } from './template-rastreio-service'
import { templatePadrao } from '@/domain/rastreio/template-rastreio'

/**
 * Consulta pública de um envio pelo código de rastreio
 * (docs/superpowers/specs/2026-08-31-simulacao-transporte.md, seção 7): quem
 * tem o código consulta sem login, como em qualquer transportadora.
 *
 * O que sustenta isso é o que a função NÃO devolve: nome, documento e
 * endereço de remetente e destinatário nunca saem daqui — apenas serviço,
 * prazo, status e a cidade/UF de cada evento. Quem descobre um código não
 * descobre quem mora onde.
 *
 * A timeline é gerada inteira na emissão da etiqueta, com eventos já datados
 * no futuro. A consulta corta em `agora`: evento futuro não aparece nem
 * esmaecido.
 */
/**
 * Status a exibir para o último evento visível, com queda para o status
 * persistido quando o código não é reconhecido.
 *
 * Um status criado pela conta cujo código este caminho não sabe traduzir não
 * pode derrubar a consulta: a página do cliente mostra o status persistido,
 * que está atrasado mas é verdadeiro, em vez de um erro.
 */
function statusVisivel(codigo: string | undefined, persistido: StatusShipment): StatusShipment {
  if (!codigo) {
    return persistido
  }

  try {
    return statusDoEvento(codigo)
  } catch {
    return persistido
  }
}

export async function rastrearEnvio(
  codigoRastreio: string,
  agora: Date = new Date(),
): Promise<RastreioResposta> {
  // A consulta sincroniza o status persistido antes de ler. Sem isto, o
  // `Shipment.status` no banco fica congelado no valor da emissão para
  // sempre: nada mais no sistema percebe a passagem do tempo, e listagens,
  // filtros e relatórios que leem o campo mostram um envio entregue como
  // recém-emitido.
  //
  // Seguro numa rota anônima: a sincronização move status e datas, e nada
  // mais — nenhum caminho dela toca em carteira.
  const envioParaSincronizar = await prisma.shipment.findFirst({
    where: { codigoRastreio },
    select: { id: true },
  })

  if (envioParaSincronizar) {
    // A sincronização é benefício, não requisito da consulta: se ela falhar,
    // a leitura ainda tem de responder. Um erro aqui deixa o status
    // persistido atrasado, o que a derivação do último evento visível
    // compensa na resposta.
    try {
      await sincronizarEnvio(envioParaSincronizar.id, agora)
    } catch (error) {
      console.error('Falha ao sincronizar envio durante a consulta de rastreio', {
        cause: error,
      })
    }
  }

  const envio = await prisma.shipment.findFirst({
    where: { codigoRastreio },
    include: {
      user: { select: { id: true } },
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: {
        where: { ocorridoEm: { lte: agora } },
        orderBy: [{ ocorridoEm: 'desc' }, { sequencia: 'desc' }],
      },
    },
  })

  if (!envio || !envio.codigoRastreio) {
    throw new EnvioNaoEncontradoError(`Envio não encontrado: ${codigoRastreio}`)
  }

  const ultimoVisivel = envio.trackingEvents[0]
  const fluxo = await montarFluxoPublico(envio.userId)

  return {
    fluxo,
    codigoRastreio: envio.codigoRastreio,
    // O status persistido pode estar atrás do relógio até a próxima
    // sincronização; o último evento visível é a fonte da verdade do que o
    // cliente pode ver agora.
    status: statusVisivel(ultimoVisivel?.codigo, envio.status),
    servico: envio.service.nome,
    prazoDias: envio.service.prazoBase,
    criadoEm: envio.criadoEm.toISOString(),
    eventos: envio.trackingEvents.map((evento) => ({
      sequencia: evento.sequencia,
      codigo: evento.codigo,
      titulo: evento.titulo,
      descricao: evento.descricao,
      unidadeOrigem: evento.unidadeOrigem,
      unidadeDestino: evento.unidadeDestino,
      cidade: evento.cidade,
      uf: evento.uf,
      ocorridoEm: evento.ocorridoEm.toISOString(),
    })),
  }
}

/**
 * Percurso configurado pela conta, para o rastreio público desenhar o fluxo.
 *
 * Devolve **apenas a forma do percurso**: código, título e posição no canvas.
 * Nunca o dia de cada etapa. É a mesma linha que a seção 7 da spec traça —
 * dizer por onde a encomenda passa descreve o serviço; dizer quando ela
 * passa é prometer uma data que a simulação ainda pode mudar.
 *
 * Sem template configurado, devolve o percurso padrão, que é o que os envios
 * dessa conta de fato seguem.
 */
export async function montarFluxoPublico(userId: string): Promise<{
  nos: { id: string; codigo: string; titulo: string; x: number | null; y: number | null }[]
  conexoes: { de: string; para: string }[]
}> {
  const template = await obterTemplate(userId)

  const passos = template?.ativo ? template.passos : templatePadrao()
  const conexoes = template?.ativo ? template.conexoes : []

  return {
    nos: passos.map((passo) => ({
      // O id de instância também vai, para as conexões terem a que se
      // referir — ele não diz nada sobre o envio, é só uma chave de desenho.
      id: passo.id ?? passo.codigo,
      codigo: passo.codigo,
      titulo: passo.titulo,
      x: passo.x ?? null,
      y: passo.y ?? null,
    })),
    conexoes,
  }
}

import type { PapelUser } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { DomainError } from '@/domain/errors'
import { avancarEtapa } from './avancar-etapa-service'

/**
 * Avançar a etapa de vários envios de uma vez.
 *
 * Com novecentas etiquetas na tela, um clique por linha não é uma operação —
 * é um castigo. Quem opera precisa mover o lote do dia, não uma encomenda.
 *
 * O que este serviço acrescenta ao `avancarEtapa` de um só, e por quê:
 *
 *  - **Resultado por envio, nunca "tudo ou nada".** Um envio cancelado no meio
 *    da seleção não pode derrubar os outros quarenta e nove. É a mesma lição
 *    do `/checkout` em lote: quem recebe um erro seco não sabe o que foi feito
 *    e o que não foi, e a segunda tentativa vira aposta.
 *  - **Um de cada vez, em série.** Cada avanço abre transação e desloca a
 *    linha do tempo inteira do envio; cinquenta em paralelo disputariam
 *    conexão com o tráfego real da plataforma, que é quem paga a conta.
 *  - **O administrador age em nome do dono, e a auditoria diz quem foi.**
 *    Sem isso, o admin que enxerga todas as lojas veria um botão que responde
 *    "envio não encontrado" para tudo que não é dele.
 */

/** Teto por chamada. Ver o comentário em `avancarEtapaEmLote`. */
export const MAXIMO_POR_LOTE = 200

export type ResultadoDeUmEnvio = {
  id: string
  ok: boolean
  /** A etapa que passou a valer, quando deu certo. */
  etapa?: string
  /** O motivo, quando não deu. */
  erro?: string
  codigo?: string
}

export type ResultadoDoLote = {
  avancados: number
  falhas: number
  itens: ResultadoDeUmEnvio[]
}

export async function avancarEtapaEmLote(
  sessao: { userId: string; papel: PapelUser },
  ids: string[],
): Promise<ResultadoDoLote> {
  /*
    Duplicata na lista é acidente de interface — um clique que registrou duas
    vezes, uma seleção somada à outra. Avançar duas vezes o mesmo envio
    puxaria DUAS etapas, e o comprador veria o pacote saltar do "postado" para
    o "saiu para entrega" sem passar pelo meio.
  */
  const unicos = [...new Set(ids)].slice(0, MAXIMO_POR_LOTE)

  const itens: ResultadoDeUmEnvio[] = []

  for (const id of unicos) {
    try {
      /*
        Quem "assina" o avanço é o DONO do envio, porque é a linha do tempo
        dele que anda. Quem PEDIU vai para a auditoria logo abaixo — os dois
        são diferentes quando um administrador opera pela loja, e guardar só um
        deles apagaria a resposta à única pergunta que aparece depois: quem
        mexeu nisto?
      */
      const dono =
        sessao.papel === 'ADMIN'
          ? ((
              await prisma.shipment.findUnique({
                where: { id },
                select: { userId: true },
              })
            )?.userId ?? sessao.userId)
          : sessao.userId

      const etapa = await avancarEtapa(dono, id)

      if (dono !== sessao.userId) {
        await prisma.auditLog.create({
          data: {
            actorUserId: sessao.userId,
            acao: 'ENVIO_AVANCAR_ETAPA_PELO_ADMIN',
            entidade: 'Shipment',
            entidadeId: id,
            antes: { dono },
            depois: { etapa: etapa.codigo, status: etapa.status },
          },
        })
      }

      itens.push({ id, ok: true, etapa: etapa.titulo })
    } catch (erro) {
      itens.push({
        id,
        ok: false,
        codigo: erro instanceof DomainError ? erro.codigo : 'ERRO_INTERNO',
        erro:
          erro instanceof DomainError
            ? erro.message
            : 'Não foi possível avançar a etapa deste envio.',
      })
    }
  }

  const avancados = itens.filter((i) => i.ok).length

  return { avancados, falhas: itens.length - avancados, itens }
}

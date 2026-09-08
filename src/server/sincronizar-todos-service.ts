import { prisma } from '@/infra/db/client'
import { sincronizarEnviosPendentesDoUsuario } from './sincronizar-envio-service'

/**
 * Faz o relógio alcançar os envios de TODAS as contas.
 *
 * Sem isto, o único caminho de produção que move um envio é
 * `rastreio-service.ts`, chamado quando alguém abre a página pública daquele
 * código. Quem tem a linha do tempo inteira materializada e ninguém abrindo o
 * link fica parado em `GENERATED` para sempre: o painel mostra "etiqueta
 * emitida" para um pacote entregue, `entregueEm` nunca é preenchido e — o que
 * mais dói — `order.posted` e `order.delivered` nunca são enfileirados, então
 * a loja que espelha o rastreio nunca fica sabendo.
 *
 * O comprador que acompanha resolve o próprio envio ao abrir a página. O que
 * não acompanha condena o dele ao silêncio, e é justamente esse que gera
 * reclamação — porque ele vai perguntar à loja, e a loja também não sabe.
 *
 * Roda conta a conta, e não numa varredura global, para reusar exatamente a
 * função que a listagem do painel usa: uma consulta traz os candidatos, o
 * status é derivado em memória e só quem divergiu de fato abre transação.
 * Duplicar essa lógica aqui criaria uma segunda regra de "está atrasado?" para
 * divergir da primeira na próxima mudança.
 */
export type ResultadoSincronizacao = {
  contas: number
  envios: number
  erros: number
}

export async function sincronizarTodosOsEnvios(
  agora: Date = new Date(),
): Promise<ResultadoSincronizacao> {
  const contas = await prisma.user.findMany({ select: { id: true } })

  let envios = 0
  let erros = 0

  for (const conta of contas) {
    try {
      envios += await sincronizarEnviosPendentesDoUsuario(conta.id, agora)
    } catch (error) {
      /*
        Uma conta que falha não pode levar as outras junto. O disparo é
        periódico: o que não andou agora anda na próxima chamada, e derrubar a
        varredura inteira por causa de um envio com dado estranho deixaria
        todas as contas seguintes paradas até alguém perceber.
      */
      erros += 1
      console.error('Falha ao sincronizar envios da conta', { conta: conta.id, cause: error })
    }
  }

  return { contas: contas.length, envios, erros }
}

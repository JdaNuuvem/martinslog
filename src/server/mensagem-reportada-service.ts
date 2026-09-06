import { createHash } from 'crypto'
import type { CanalMensagem, StatusMensagem } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'

/**
 * Mensagens que a LOJA enviou, reportadas à plataforma.
 *
 * A plataforma envia SMS e WhatsApp; o e-mail quem manda é a loja, que já tem
 * provedor e domínio verificados. O resultado era um painel que dizia "nenhum
 * e-mail" com três mil e seiscentos enviados do outro lado — e a pergunta que
 * se faz naquela tela ("o comprador foi avisado?") não distingue canal.
 *
 * Então a loja reporta, e a mensagem entra na MESMA lista dos outros canais,
 * com o mesmo filtro e a mesma contagem de falhas.
 *
 * Duas diferenças em relação ao que a plataforma envia, e as duas importam:
 *
 *  - **Nasce com o desfecho já conhecido.** Não há fila daqui para uma
 *    mensagem que já saiu; `PENDENTE` seria mentira e faria o disparador tentar
 *    reenviar algo que não é dele.
 *  - **Não tem template.** O texto vive na loja. Guardar uma cópia aqui criaria
 *    uma segunda versão do mesmo texto, para divergir na primeira edição.
 */

export type MensagemReportada = {
  /** `EMAIL`, `SMS` ou `WHATSAPP` — o que a loja usou. */
  canal: CanalMensagem
  /** O momento do envio: `PEDIDO_PAGO`, `PEDIDO_POSTADO`, o que a loja chamar. */
  evento: string
  /** Destinatário: e-mail ou telefone, conforme o canal. */
  para: string
  /** Chegou ou não. Sem meio-termo: quem reporta já sabe o desfecho. */
  entregue: boolean
  /** Motivo, quando não chegou. */
  erro?: string | null
  /** O pedido na loja (`external_id`), quando a mensagem é sobre um pedido. */
  externalId?: string | null
  /** Identificador da mensagem no provedor da loja, para conferência. */
  idExterno?: string | null
  /** Quando saiu. Padrão: agora. */
  enviadaEm?: Date | null
  /** Assunto, quando é e-mail. Vai junto do evento, para a lista ser legível. */
  assunto?: string | null
}

export type ResultadoReporte = 'registrada' | 'repetida' | 'destinatario-invalido'

/**
 * Registra uma mensagem que a loja já enviou.
 *
 * Repetir o reporte da mesma mensagem não duplica: o índice único de
 * `MensagemEnvio` cobre `(perfil, evento, canal, pedido, envio, regra)`, e a
 * segunda chamada esbarra nele. A trava é do banco, não do código — uma
 * sincronização que roda duas vezes ao mesmo tempo leria a mesma lista antes de
 * qualquer uma gravar, e a checagem em código perderia a corrida exatamente no
 * caso que ela existiria para cobrir.
 */
export async function registrarMensagemEnviada(
  perfilId: string,
  entrada: MensagemReportada,
): Promise<ResultadoReporte> {
  const para = normalizarDestinatario(entrada.canal, entrada.para)
  if (!para) return 'destinatario-invalido'

  const pedido = entrada.externalId
    ? await prisma.pedido.findUnique({
        where: { perfilId_externalId: { perfilId, externalId: entrada.externalId } },
        select: { id: true },
      })
    : null

  const quando = entrada.enviadaEm ?? new Date()

  try {
    await prisma.mensagemEnvio.create({
      data: {
        perfilId,
        canal: entrada.canal,
        // Quem mandou foi a loja. Gravar o provedor dela seria adivinhação;
        // gravar "loja" diz a verdade e explica por que não há template.
        provedor: 'loja',
        pedidoId: pedido?.id ?? null,
        /*
          O assunto entra junto do evento porque a lista mostra o evento, e
          "PEDIDO_PAGO" sozinho não diz ao operador qual e-mail o comprador
          abriu. `MensagemEnvio` não tem campo de assunto, e criar um só para
          isto obrigaria os outros canais a conviver com uma coluna vazia.
        */
        evento: entrada.assunto
          ? `${entrada.evento} — ${entrada.assunto}`.slice(0, 200)
          : entrada.evento,
        para,
        status: (entrada.entregue ? 'ENVIADA' : 'DESISTIU') satisfies StatusMensagem,
        tentativas: 1,
        erro: entrada.entregue ? null : (entrada.erro?.slice(0, 500) ?? 'A loja não informou o motivo.'),
        idExterno: identidade(entrada),
        enviadaEm: entrada.entregue ? quando : null,
        criadoEm: quando,
        // Nunca há próxima tentativa: a mensagem não é nossa para reenviar.
        proximaTentativaEm: null,
      },
    })
    return 'registrada'
  } catch (erro) {
    if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') {
      return 'repetida'
    }
    throw erro
  }
}

/**
 * A identidade da mensagem reportada, que entra na trava contra repetição.
 *
 * O id do provedor é a resposta certa quando existe — é único por natureza e
 * permite conferir a mensagem lá na origem. Quando não existe (envio que
 * falhou antes de ganhar id, provedor que não devolve um), a identidade é
 * derivada do que a mensagem É: destinatário, evento e momento.
 *
 * Sem isso, duas mensagens diferentes com o mesmo evento e sem id colidiriam
 * na chave — e a segunda voltaria contada como "repetida", que é o número em
 * que o operador se apoia para decidir se a importação funcionou.
 *
 * O prefixo `reportado:` é deliberado: quem ler esta coluna depois precisa
 * saber, sem adivinhar, que este valor foi construído aqui e não veio de
 * provedor nenhum.
 */
function identidade(entrada: MensagemReportada): string {
  if (entrada.idExterno) return entrada.idExterno

  const semente = [
    entrada.canal,
    entrada.evento,
    entrada.para.trim().toLowerCase(),
    (entrada.enviadaEm ?? new Date()).toISOString(),
    entrada.assunto ?? '',
  ].join('|')

  return `reportado:${createHash('sha1').update(semente).digest('hex').slice(0, 24)}`
}

/**
 * Telefone vira E.164; e-mail passa como veio, em minúsculas.
 *
 * Normalizar o e-mail além disso seria arriscar mudar o endereço: a parte antes
 * do arroba pode ser sensível a maiúsculas em servidores antigos, e o que
 * importa aqui é bater com o que a loja enviou.
 */
function normalizarDestinatario(canal: CanalMensagem, bruto: string): string | null {
  const valor = bruto.trim()
  if (!valor) return null

  if (canal === 'EMAIL') {
    // Frouxo de propósito: o e-mail JÁ FOI ENVIADO. Recusar aqui apagaria do
    // histórico justamente a mensagem que a loja precisa investigar.
    return valor.length <= 320 ? valor.toLowerCase() : null
  }

  return normalizarTelefone(valor)
}

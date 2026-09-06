import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro } from '../_lib/erro'
import { autenticarRequisicao } from '@/server/api-publica-service'
import { registrarMensagemEnviada } from '@/server/mensagem-reportada-service'

/**
 * `POST /api/v0/mensagens` — a loja conta o que já enviou ao comprador.
 *
 * A plataforma manda SMS e WhatsApp; o e-mail quem manda é a loja, com
 * provedor e domínio próprios. O painel dizia "nenhum e-mail" enquanto milhares
 * saíam do outro lado, e a pergunta que se faz naquela tela — "o comprador foi
 * avisado?" — não distingue canal.
 *
 * Esta rota não envia nada. Ela registra o que já aconteceu, para a mensagem da
 * loja aparecer na mesma lista, com o mesmo filtro e a mesma contagem de
 * falhas.
 *
 * Aceita **lote**: a importação do histórico manda centenas por chamada, e uma
 * requisição por e-mail estouraria o limite de sessenta por minuto antes de
 * trazer o primeiro dia.
 */

const mensagemSchema = z.object({
  canal: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
  evento: z.string().trim().min(1, 'evento é obrigatório').max(120),
  para: z.string().trim().min(1, 'para é obrigatório').max(320),
  /** Chegou ou não. Quem reporta já sabe o desfecho; não há meio-termo. */
  entregue: z.boolean(),
  erro: z.string().trim().max(500).optional(),
  external_id: z.string().trim().max(200).optional(),
  id_externo: z.string().trim().max(200).optional(),
  enviada_em: z.string().datetime({ offset: true }).optional(),
  assunto: z.string().trim().max(200).optional(),
})

const corpoSchema = z.union([
  mensagemSchema,
  z.object({
    mensagens: z
      .array(mensagemSchema)
      .min(1, 'Informe ao menos uma mensagem')
      /*
        Teto de 500 por chamada. Sem ele, um lote de dez mil ficaria minutos
        segurando a conexão e estouraria o tempo limite do cliente no meio —
        deixando metade gravada e ninguém sabendo qual metade.
      */
      .max(500, 'No máximo 500 mensagens por chamada'),
  }),
])

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)

    if (!contexto.perfilId) {
      return NextResponse.json(
        {
          codigo: 'TOKEN_SEM_PERFIL',
          mensagem:
            'Este token não pertence a um perfil. Crie um token dentro do perfil da loja em Integrações.',
        },
        { status: 409 },
      )
    }

    const corpo = await request.json().catch(() => null)
    const analisado = corpoSchema.safeParse(corpo)
    if (!analisado.success) {
      return NextResponse.json(
        {
          codigo: 'CORPO_INVALIDO',
          mensagem: 'Dados da mensagem inválidos.',
          campos: analisado.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    const lote = 'mensagens' in analisado.data ? analisado.data.mensagens : [analisado.data]

    let registradas = 0
    let repetidas = 0
    let recusadas = 0

    for (const m of lote) {
      const resultado = await registrarMensagemEnviada(contexto.perfilId, {
        canal: m.canal,
        evento: m.evento,
        para: m.para,
        entregue: m.entregue,
        erro: m.erro ?? null,
        externalId: m.external_id ?? null,
        idExterno: m.id_externo ?? null,
        enviadaEm: m.enviada_em ? new Date(m.enviada_em) : null,
        assunto: m.assunto ?? null,
      })

      if (resultado === 'registrada') registradas++
      else if (resultado === 'repetida') repetidas++
      else recusadas++
    }

    /*
      Devolve os três números em vez de um "ok".
      `repetidas` é o que torna a importação segura de repetir: quem roda o
      mesmo lote duas vezes vê o segundo passar inteiro como repetido, em vez
      de ficar na dúvida sobre ter duplicado o histórico.
    */
    return NextResponse.json(
      { registradas, repetidas, recusadas, total: lote.length },
      { status: 200 },
    )
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/mensagens')
  }
}

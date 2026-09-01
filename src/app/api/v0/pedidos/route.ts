import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro } from '../_lib/erro'
import { autenticarRequisicao } from '@/server/api-publica-service'
import { registrarPedido } from '@/server/pedido-service'

/**
 * `POST /api/v0/pedidos` — a loja empurra o pedido assim que ele nasce.
 *
 * É o que permite falar com quem ainda não pagou. Envio só existe depois do
 * pagamento, então, sem esta rota, a venda pendente é invisível para a
 * plataforma e não há como recuperá-la.
 *
 * `external_id` é obrigatório e é a chave de idempotência: repetir a chamada
 * com o mesmo valor atualiza o pedido em vez de criar outro. A rota de envios
 * não tem essa trava e a deduplicação sobra para o integrador; aqui não.
 */
const corpoSchema = z.object({
  /** Identificador do pedido na loja. Repetir o mesmo atualiza, não duplica. */
  external_id: z.string().trim().min(1, 'external_id é obrigatório'),
  status: z.enum(['PENDENTE', 'PAGO', 'CANCELADO']).optional(),
  cliente: z.object({
    nome: z.string().trim().min(1, 'Nome do cliente é obrigatório'),
    /** Com ou sem máscara: normalizado para E.164 antes de gravar. */
    telefone: z.string().trim().min(8, 'Telefone é obrigatório'),
    email: z.string().trim().email('E-mail inválido').optional().or(z.literal('')),
  }),
  valor_centavos: z.number().int().nonnegative().optional(),
  produtos: z.array(z.unknown()).optional(),
  /** Para onde mandar quem quer terminar a compra. Base da recuperação. */
  checkout_url: z.string().trim().url('checkout_url precisa ser uma URL').optional(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)

    /*
      A loja é a do token, nunca um campo do corpo. Um `perfil_id` informado a
      cada requisição é um perfil que uma hora vem trocado — e o comprador
      receberia a mensagem pelo WhatsApp de outra marca sem nada acusar o erro.
    */
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
          mensagem: 'Dados do pedido inválidos.',
          campos: analisado.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    const d = analisado.data
    const salvo = await registrarPedido(contexto.perfilId, {
      externalId: d.external_id,
      status: d.status,
      clienteNome: d.cliente.nome,
      clienteFone: d.cliente.telefone,
      clienteEmail: d.cliente.email || null,
      valorCentavos: d.valor_centavos,
      produtos: d.produtos,
      checkoutUrl: d.checkout_url ?? null,
    })

    // 201 quando nasceu, 200 quando já existia: é o que diz ao integrador,
    // sem ambiguidade, se a idempotência entrou em ação.
    return NextResponse.json(salvo, { status: salvo.criado ? 201 : 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/pedidos')
  }
}

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
  /**
   * O comprovante que o comprador mandou.
   *
   * Aceita endereço http OU uma URI de dados (`data:image/...;base64,…`), que
   * é o que as lojas guardam hoje. Não é `z.string().url()` de propósito: essa
   * regra recusaria a URI de dados, que é justamente o formato existente — e o
   * campo passaria a ser um que ninguém consegue preencher.
   *
   * Teto de 250 KB: um comprovante real tem ~95 KB, e sem limite este campo
   * vira a porta por onde alguém empurra megabytes para dentro do banco.
   */
  comprovante: z
    .string()
    .trim()
    .max(250_000, 'comprovante grande demais (máximo 250 KB)')
    .refine(
      (v) => v === '' || /^(https?:\/\/|data:image\/)/i.test(v),
      'comprovante precisa ser um endereço http(s) ou uma URI de imagem',
    )
    .optional(),
  /** Quando o comprador anexou o comprovante. */
  comprovante_em: z.string().datetime({ offset: true }).optional(),
  /**
   * Manda ou não a mensagem de confirmação ao comprador. Padrão: manda.
   *
   * Existe para a IMPORTAÇÃO do histórico. Uma loja que integra hoje tem meses
   * de pedidos anteriores, e trazê-los para cá é o que faz o painel mostrar a
   * operação inteira em vez de só o que aconteceu desde ontem. Sem esta trava,
   * a importação avisaria "pagamento confirmado" a milhares de compradores de
   * semanas atrás — mensagem cobrada, sem sentido para quem recebe, e um envio
   * em massa não solicitado do ponto de vista da operadora.
   *
   * O padrão é `true` de propósito: esquecer o campo mantém o comportamento
   * que existe hoje. Quem importa histórico está fazendo algo deliberado e
   * escreve `false`.
   */
  notificar_cliente: z.boolean().optional(),
  /**
   * Quando o pedido nasceu na loja. Padrão: agora.
   *
   * Sem isto, todo pedido importado apareceria como criado no instante da
   * importação, e a lista do painel viraria uma parede de "hoje" — perdendo
   * exatamente a informação que faz o histórico valer.
   */
  criado_em: z.string().datetime({ offset: true }).optional(),
  /** Quando o pagamento entrou. Só faz sentido com `status: PAGO`. */
  pago_em: z.string().datetime({ offset: true }).optional(),
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
      comprovante: d.comprovante || null,
      comprovanteEm: d.comprovante_em ? new Date(d.comprovante_em) : null,
      criadoEm: d.criado_em ? new Date(d.criado_em) : null,
      pagoEm: d.pago_em ? new Date(d.pago_em) : null,
      notificarCliente: d.notificar_cliente ?? true,
    })

    // 201 quando nasceu, 200 quando já existia: é o que diz ao integrador,
    // sem ambiguidade, se a idempotência entrou em ação.
    return NextResponse.json(salvo, { status: salvo.criado ? 201 : 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/pedidos')
  }
}

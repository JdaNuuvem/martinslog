import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro } from '../_lib/erro'
import { autenticarRequisicao, criarCarrinho } from '@/server/api-publica-service'

/**
 * Mesmo schema de endereço/produto de `/api/envios` (ver
 * `src/app/api/envios/route.ts`), deliberadamente sem nenhum campo de
 * preço — o Zod descarta chaves desconhecidas, então um `price` mandado no
 * corpo nunca chega em `criarCarrinho`.
 */
const enderecoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  documento: z.string().trim().optional(),
  email: z.string().trim().email('E-mail inválido').optional().or(z.literal('')),
  telefone: z.string().trim().optional(),
  cep: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  logradouro: z.string().trim().min(1, 'Logradouro é obrigatório'),
  numero: z.string().trim().min(1, 'Número é obrigatório'),
  complemento: z.string().trim().optional(),
  bairro: z.string().trim().min(1, 'Bairro é obrigatório'),
  cidade: z.string().trim().min(1, 'Cidade é obrigatória'),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras'),
})

const produtoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do produto é obrigatório'),
  quantidade: z.number().int().positive(),
  valorUnitarioCentavos: z.number().int().positive(),
})

const corpoSchema = z.object({
  /** `id` devolvido por `/api/v0/calculator`, no formato `quoteId:servicoId`. */
  service: z.string().min(1, 'service é obrigatório'),
  remetente: enderecoSchema,
  destinatario: enderecoSchema,
  produtos: z.array(produtoSchema).min(1, 'Informe ao menos um produto'),
  /**
   * O código do pedido na loja, para o comprador ver um código só.
   *
   * Opcional: quem já integrou continua funcionando sem mandar nada. E não
   * é chave de idempotência — repetir não atualiza o envio, cria outro. A
   * deduplicação de envio segue sendo do integrador; a de pedido mora em
   * `POST /api/v0/pedidos`, onde `external_id` de fato trava.
   */
  external_id: z.string().trim().max(120).optional(),
})

/** `POST /api/v0/cart` — cria o envio → { id, price, status }. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)

    const corpo = await request.json().catch(() => null)
    const analisado = corpoSchema.safeParse(corpo)
    if (!analisado.success) {
      return NextResponse.json(
        {
          codigo: 'CORPO_INVALIDO',
          mensagem: 'Dados do carrinho inválidos.',
          campos: analisado.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    const item = await criarCarrinho(contexto, analisado.data)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/cart')
  }
}

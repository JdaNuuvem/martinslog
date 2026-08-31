import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError, SaldoInsuficienteError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { criarEnvio, obterPreviaEnvio, pagarEnvio } from '@/server/shipment-service'

/**
 * Schema do endereço copiado para dentro do envio. Deliberadamente sem
 * nenhum campo de preço — o Zod descarta chaves desconhecidas por padrão,
 * então mesmo que o cliente mande `precoCobradoCentavos` no corpo, ele
 * nunca chega em `criarEnvio` (requisito 3 do brief da Task 13).
 */
const enderecoEnvioSchema = z.object({
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
  quantidade: z.number().int().positive('Quantidade deve ser um inteiro positivo'),
  valorUnitarioCentavos: z.number().int().positive('Valor unitário deve ser um inteiro positivo em centavos'),
})

const criarEnvioSchema = z.object({
  quoteId: z.string().min(1, 'Cotação é obrigatória'),
  servicoId: z.string().min(1, 'Serviço é obrigatório'),
  remetente: enderecoEnvioSchema,
  destinatario: enderecoEnvioSchema,
  produtos: z.array(produtoSchema).min(1, 'Informe ao menos um produto na declaração de conteúdo'),
})

const pagarEnvioSchema = z.object({
  shipmentId: z.string().min(1, 'Envio é obrigatório'),
})

function statusParaErro(codigo: string): number {
  switch (codigo) {
    case 'ENVIO_NAO_ENCONTRADO':
      return 404
    case 'NAO_AUTORIZADO':
      return 403
    case 'SALDO_INSUFICIENTE':
      return 402
    case 'COTACAO_EXPIRADA':
    case 'TRANSICAO_INVALIDA':
    case 'CARTEIRA_NAO_ENCONTRADA':
      return 422
    default:
      return 422
  }
}

async function lerCorpo(request: NextRequest): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * `GET /api/envios?quoteId=&servicoId=` — prévia de preço para a etapa de
 * revisão, sem criar nada. Usa a mesma resolução de preço de `criarEnvio`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const quoteId = request.nextUrl.searchParams.get('quoteId')
  const servicoId = request.nextUrl.searchParams.get('servicoId')

  if (!quoteId || !servicoId) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Informe quoteId e servicoId.' },
      { status: 400 },
    )
  }

  try {
    const previa = await obterPreviaEnvio(sessao.userId, quoteId, servicoId)
    return NextResponse.json({ previa }, { status: 200 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: error.message },
        { status: statusParaErro(error.codigo) },
      )
    }
    console.error('Erro inesperado ao obter prévia do envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao calcular a prévia do envio.' },
      { status: 500 },
    )
  }
}

/**
 * `POST /api/envios` — cria o envio (`PENDING`) e tenta pagá-lo na
 * sequência. Se o pagamento falhar por saldo insuficiente, o envio
 * permanece `PENDING` (nada é revertido) e a resposta traz o `shipmentId`
 * para o cliente tentar pagar de novo depois de recarregar (via `PATCH`).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const corpo = await lerCorpo(request)
  if (corpo === null) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = criarEnvioSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do envio inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const entrada = analisado.data

  try {
    const envio = await criarEnvio(sessao.userId, {
      quoteId: entrada.quoteId,
      servicoId: entrada.servicoId,
      remetente: entrada.remetente,
      destinatario: entrada.destinatario,
      produtos: entrada.produtos,
    })

    try {
      await pagarEnvio(sessao.userId, envio.id)
    } catch (erroPagamento) {
      if (erroPagamento instanceof SaldoInsuficienteError) {
        return NextResponse.json(
          {
            codigo: 'SALDO_INSUFICIENTE',
            mensagem: erroPagamento.message,
            shipmentId: envio.id,
            precoCobradoCentavos: envio.precoCobradoCentavos,
          },
          { status: 402 },
        )
      }
      throw erroPagamento
    }

    return NextResponse.json({ id: envio.id, status: 'RELEASED' }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: error.message },
        { status: statusParaErro(error.codigo) },
      )
    }
    console.error('Erro inesperado ao criar envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao criar o envio.' },
      { status: 500 },
    )
  }
}

/**
 * `PATCH /api/envios` — tenta pagar um envio já criado (`PENDING`). Usado
 * para repetir o pagamento depois que o cliente recarrega a carteira, sem
 * recriar o envio.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const corpo = await lerCorpo(request)
  if (corpo === null) {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = pagarEnvioSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Identificador do envio inválido.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    await pagarEnvio(sessao.userId, analisado.data.shipmentId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: error.message },
        { status: statusParaErro(error.codigo) },
      )
    }
    console.error('Erro inesperado ao pagar envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao pagar o envio.' },
      { status: 500 },
    )
  }
}

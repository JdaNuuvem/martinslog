import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { env } from '@/env'

/**
 * Retorno de situação da SMS Dev (DLR).
 *
 * O envio devolve "na fila", não "entregue". Só este aviso diz que a mensagem
 * chegou ao aparelho — sem ele, o histórico para em "enviada" e não há como
 * distinguir uma entrega bem-sucedida de um número desligado.
 *
 * A conciliação usa o `refer` que mandamos no envio, que é o id da nossa linha
 * de histórico. O `id` do corpo é o da SMS Dev e serve de reserva, para o caso
 * de uma mensagem antiga ter saído sem referência.
 */

/** O que a SMS Dev chama de situação, e o que isso significa para nós. */
const ENTREGUE = 'RECEBIDA'
const FALHAS = new Set(['ERRO', 'CANCELADA', 'BLACK LIST'])

type CorpoRetorno = {
  key?: string
  id?: string
  refer?: string
  situacao?: string
  data_envio?: string
  operadora?: string
  qtd_credito?: string
}

/**
 * Lê o corpo em qualquer das formas que eles podem mandar.
 *
 * A documentação diz "POST, GET ou JSON" sem fixar uma. Aceitar as três custa
 * dez linhas e evita a falha mais chata de diagnosticar: o painel deles
 * marcando a URL como funcionando enquanto nada é atualizado aqui.
 */
async function lerCorpo(request: NextRequest): Promise<CorpoRetorno> {
  const daUrl = Object.fromEntries(request.nextUrl.searchParams) as CorpoRetorno
  if (request.method === 'GET') return daUrl

  const tipo = request.headers.get('content-type') ?? ''

  if (tipo.includes('application/json')) {
    return { ...daUrl, ...((await request.json().catch(() => ({}))) as CorpoRetorno) }
  }

  const formulario = await request.formData().catch(() => null)
  if (!formulario) return daUrl

  return { ...daUrl, ...(Object.fromEntries(formulario) as CorpoRetorno) }
}

async function tratar(request: NextRequest): Promise<NextResponse> {
  const corpo = await lerCorpo(request)

  /*
    A chave da conta é a única credencial que este aviso carrega, então é ela
    que autentica. Sem a conferência, qualquer um poderia marcar mensagens como
    entregues — e o histórico de entrega deixaria de valer como prova de que o
    comprador foi avisado.

    Sem `SMS_CHAVE` configurada não há o que conferir: a rota recusa, em vez de
    aceitar tudo. Porta fechada por falta de configuração é melhor que porta
    aberta.
  */
  if (!env.SMS_CHAVE || corpo.key !== env.SMS_CHAVE) {
    return NextResponse.json({ mensagem: 'Não autorizado.' }, { status: 401 })
  }

  const situacao = (corpo.situacao ?? '').toUpperCase().trim()

  const mensagem = corpo.refer
    ? await prisma.mensagemEnvio.findUnique({ where: { id: corpo.refer } })
    : corpo.id
      ? await prisma.mensagemEnvio.findFirst({ where: { canal: 'SMS', idExterno: String(corpo.id) } })
      : null

  /*
    Responde 200 mesmo sem achar. O aviso pode ser de uma mensagem que já foi
    apagada, e devolver erro faria a SMS Dev repetir a chamada indefinidamente
    por algo que nunca vai ser encontrado.
  */
  if (!mensagem) {
    return NextResponse.json({ recebido: true, conciliado: false })
  }

  if (situacao === ENTREGUE) {
    /*
      `entregueEm` é o que este aviso vem trazer, e é a única informação que
      ele acrescenta. Gravar só o status repetiria o estado que a mensagem já
      tinha — foi o que este código fazia antes, e tornava o recurso inteiro
      invisível: para saber se chegou era preciso consultar o provedor à mão.
    */
    await prisma.mensagemEnvio.update({
      where: { id: mensagem.id },
      data: {
        status: 'ENVIADA',
        enviadaEm: mensagem.enviadaEm ?? new Date(),
        entregueEm: mensagem.entregueEm ?? new Date(),
        erro: null,
      },
    })
    return NextResponse.json({ recebido: true, conciliado: true, situacao, entregue: true })
  }

  if (FALHAS.has(situacao)) {
    /*
      Recusa que chega por aqui é sempre definitiva: a operadora já processou e
      decidiu. Reagendar uma mensagem em lista negra a mandaria de novo para
      quem pediu para não receber.
    */
    await prisma.mensagemEnvio.update({
      where: { id: mensagem.id },
      data: {
        status: 'DESISTIU',
        erro: `Operadora devolveu: ${situacao}${corpo.operadora ? ` (${corpo.operadora})` : ''}`,
        proximaTentativaEm: null,
      },
    })
    return NextResponse.json({ recebido: true, conciliado: true, situacao })
  }

  // ENVIADA, FILA e APROVACAO são estados de passagem: não mudam nada aqui.
  return NextResponse.json({ recebido: true, conciliado: true, situacao })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return tratar(request)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return tratar(request)
}

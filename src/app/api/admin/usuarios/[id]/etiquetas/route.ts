import { NextRequest, NextResponse } from 'next/server'
import { DomainError, SaldoInsuficienteError } from '@/domain/errors'
import { criarEtiquetaAdminSchema } from '@/lib/admin-usuarios-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import { criarEtiquetaParaUsuario } from '@/server/admin/envios'
import { prisma } from '@/infra/db/client'

function statusParaErro(codigo: string): number {
  switch (codigo) {
    case 'ENVIO_NAO_ENCONTRADO':
    case 'COTACAO_NAO_ENCONTRADA':
      return 404
    case 'SALDO_INSUFICIENTE':
      return 402
    default:
      return 422
  }
}

/**
 * `POST /api/admin/usuarios/[id]/etiquetas` — cria uma etiqueta em nome do
 * cliente, cotando a rota no servidor.
 *
 * `cobrarSaldo: false` libera o envio sem debitar a carteira. É a única
 * diferença em relação ao fluxo do cliente, e fica registrada em `AuditLog`
 * com o motivo digitado.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id: userId } = await context.params

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = criarEtiquetaAdminSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados da etiqueta inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const existe = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!existe) {
    return NextResponse.json(
      { codigo: 'USUARIO_NAO_ENCONTRADO', mensagem: 'Usuário não encontrado.' },
      { status: 404 },
    )
  }

  const { motivo, ...entrada } = analisado.data

  try {
    const envio = await criarEtiquetaParaUsuario(guarda.sessao.userId, userId, entrada, motivo)
    return NextResponse.json(envio, { status: 201 })
  } catch (error) {
    if (error instanceof SaldoInsuficienteError) {
      // O envio ficou PENDING: dizer isso evita que o administrador recrie
      // outro achando que nada foi gravado.
      return NextResponse.json(
        {
          codigo: error.codigo,
          mensagem:
            'Saldo insuficiente na carteira do cliente. O envio ficou pendente — recarregue o saldo ou refaça sem cobrança.',
        },
        { status: 402 },
      )
    }
    if (error instanceof DomainError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: error.message },
        { status: statusParaErro(error.codigo) },
      )
    }

    console.error('Erro inesperado ao criar etiqueta pelo painel', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao criar a etiqueta.' },
      { status: 500 },
    )
  }
}

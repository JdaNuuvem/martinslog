import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { revelarCpf } from '@/server/admin/consulta-leads'

/**
 * `POST /api/admin/leads/[id]/cpf` — revela o CPF completo de um lead.
 *
 * É POST, e não GET, de propósito: a chamada tem efeito colateral — grava
 * `AuditLog`. Um GET seria pré-carregado por navegador e por robô de
 * indexação, enchendo o registro de leituras que ninguém pediu e afogando as
 * que importam.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id } = await context.params

  try {
    const cpf = await revelarCpf(id, guarda.sessao.userId)

    if (!cpf) {
      return NextResponse.json(
        { codigo: 'SEM_CPF', mensagem: 'Este lead não tem CPF registrado.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ cpf })
  } catch (error) {
    console.error('Erro inesperado ao revelar o CPF do lead', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao revelar o CPF.' },
      { status: 500 },
    )
  }
}

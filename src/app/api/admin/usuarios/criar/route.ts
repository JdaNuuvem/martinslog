import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { exigirAdmin } from '@/server/admin/guarda'
import { cadastrarUsuario } from '@/server/auth/cadastro'

/**
 * `POST /api/admin/usuarios/criar` — o administrador cria a conta.
 *
 * Existe porque o cadastro público foi fechado. Fechar sem abrir isto deixaria
 * a plataforma sem NENHUM caminho para uma conta nova — nem pelo painel, nem
 * pela tela pública — e a única saída seria escrever no banco à mão.
 *
 * Reúsa `cadastrarUsuario`, o mesmo serviço da tela pública. Reescrever a
 * criação aqui abriria espaço para um caminho paralelo com validação mais
 * fraca: documento não conferido, senha curta aceita, e-mail duplicado
 * passando. A conta criada pelo admin nasce com as mesmas regras da outra.
 */

const corpoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  documento: z.string().trim().min(1, 'CPF ou CNPJ é obrigatório'),
  email: z.string().trim().email('E-mail inválido'),
  telefone: z.string().trim().optional(),
  senha: z.string().min(8, 'A senha precisa de ao menos 8 caracteres'),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  // A guarda vem antes de tudo: quem não é admin recebe 404 e não descobre que
  // a rota existe.
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = corpoSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do usuário inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    /*
      Sem sessão anônima: o admin está criando a conta de outra pessoa, e
      herdar cotação feita na sessão DELE colaria o histórico de navegação do
      administrador na conta do cliente.
    */
    const resultado = await cadastrarUsuario(analisado.data, { anonSessionId: null })

    return NextResponse.json({ userId: resultado.userId }, { status: 201 })
  } catch (erro) {
    if (erro instanceof DomainError) {
      return NextResponse.json({ codigo: erro.codigo, mensagem: erro.message }, { status: 400 })
    }
    console.error('Erro inesperado ao criar usuário pelo painel', { cause: erro })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao criar o usuário.' },
      { status: 500 },
    )
  }
}

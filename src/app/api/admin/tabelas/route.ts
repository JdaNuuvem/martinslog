import { NextRequest, NextResponse } from 'next/server'
import { ArquivoInvalidoError } from '@/domain/errors'
import { exigirAdmin } from '@/server/admin/guarda'
import { importarTabela } from '@/server/admin/importar-tabela'

/** Tabela de preço é um arquivo pequeno; acima disto é engano ou abuso. */
const TAMANHO_MAXIMO_BYTES = 2 * 1024 * 1024

/**
 * Importa a tabela de preço a partir de um CSV enviado como `multipart/form-data`
 * no campo `arquivo`.
 *
 * A guarda vem antes de qualquer leitura do corpo: quem não é admin recebe
 * 404 sem que o servidor gaste tempo lendo o upload, e sem descobrir que a
 * rota existe.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  let arquivo: FormDataEntryValue | null
  try {
    const formulario = await request.formData()
    arquivo = formulario.get('arquivo')
  } catch {
    return NextResponse.json(
      { codigo: 'ARQUIVO_INVALIDO', mensagem: 'Envie o arquivo como multipart/form-data.' },
      { status: 422 },
    )
  }

  if (!(arquivo instanceof File)) {
    return NextResponse.json(
      { codigo: 'ARQUIVO_INVALIDO', mensagem: 'Nenhum arquivo enviado no campo "arquivo".' },
      { status: 422 },
    )
  }

  if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
    return NextResponse.json(
      { codigo: 'ARQUIVO_INVALIDO', mensagem: 'Arquivo maior que 2 MB.' },
      { status: 413 },
    )
  }

  try {
    const resultado = await importarTabela(guarda.sessao.userId, await arquivo.text())
    return NextResponse.json({ resultado })
  } catch (error) {
    if (error instanceof ArquivoInvalidoError) {
      // A mensagem carrega o número da linha e a coluna: é ela que permite
      // corrigir a planilha, então vai inteira para quem importou (que é
      // sempre um administrador autenticado).
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao importar tabela de preço', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao importar a tabela.' },
      { status: 500 },
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { midiaDaMensagem } from '@/server/whatsapp/midia-service'
import { respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

/**
 * O binário de uma mídia da conversa.
 *
 * O arquivo é de TERCEIRO e sai do nosso domínio, então é servido como coisa
 * não confiável: `nosniff` para o navegador não "descobrir" que um PDF é
 * HTML, `sandbox` para um HTML que chegue mesmo assim não rodar script com a
 * sessão do painel, e documento sempre como download.
 */

/** Mimetype vem do WhatsApp do cliente. Só passa o que tem forma de mimetype. */
const FORMA_DE_MIMETYPE = /^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.-]+=[\w.-]+)*$/

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  try {
    const midia = await midiaDaMensagem(guarda.sessao.userId, id)
    if (!midia) {
      return NextResponse.json({ codigo: 'NAO_ENCONTRADO', mensagem: 'Arquivo não encontrado.' }, { status: 404 })
    }

    const mimetype = FORMA_DE_MIMETYPE.test(midia.mimetype) ? midia.mimetype : 'application/octet-stream'
    const nome = encodeURIComponent(midia.nome ?? `arquivo-${id}`)

    return new NextResponse(new Uint8Array(midia.dados), {
      status: 200,
      headers: {
        'content-type': mimetype,
        'content-length': String(midia.dados.length),
        // Privado: é conteúdo de uma conversa, nunca de proxy compartilhado.
        // Um dia, porque mídia de mensagem não muda.
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'content-disposition':
          midia.tipo === 'DOCUMENTO'
            ? `attachment; filename*=UTF-8''${nome}`
            : `inline; filename*=UTF-8''${nome}`,
      },
    })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

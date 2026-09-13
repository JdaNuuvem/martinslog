import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirAdmin } from '@/server/admin/guarda'
import {
  conversaDaConta,
  listarMensagens,
  serializarMensagem,
} from '@/server/whatsapp/caixa-service'
import {
  enviarConteudo,
  LIMITE_ARQUIVO_BYTES,
  type ConteudoEnvio,
} from '@/server/whatsapp/envio-service'
import { corpoInvalido, respostaDeErro } from '@/server/whatsapp/resposta-http'

type Params = { params: Promise<{ id: string }> }

/**
 * Mensagens de uma conversa: ler (paginado) e responder.
 *
 * Responder aceita três formas, porque a tela tem três botões: texto em JSON,
 * arquivo em multipart (`arquivo` + `legenda`) e áudio gravado no navegador
 * (`audio`).
 */

const textoSchema = z.object({
  texto: z.string().trim().min(1, 'Escreva alguma coisa.').max(4096),
})

/**
 * Folga do multipart sobre o arquivo: cabeçalhos das partes e a legenda.
 * Recusar pelo `content-length` evita ler 200 MB para então dizer que não cabe.
 */
const FOLGA_MULTIPART = 256 * 1024

function arquivoGrande(): NextResponse {
  return NextResponse.json(
    {
      codigo: 'ARQUIVO_GRANDE_DEMAIS',
      mensagem: 'O arquivo passa de 16 MB, o limite do WhatsApp. Envie um arquivo menor.',
    },
    { status: 413 },
  )
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params
  const busca = request.nextUrl.searchParams
  try {
    return NextResponse.json(
      await listarMensagens(guarda.sessao.userId, id, {
        antesDe: busca.get('antesDe'),
        depoisDe: busca.get('depoisDe'),
        limite: Number(busca.get('limite')) || null,
      }),
    )
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

async function lerConteudo(request: NextRequest): Promise<ConteudoEnvio | NextResponse> {
  const tipo = request.headers.get('content-type') ?? ''

  if (!tipo.toLowerCase().startsWith('multipart/form-data')) {
    const analisado = textoSchema.safeParse(await request.json().catch(() => null))
    if (!analisado.success) return corpoInvalido('Escreva alguma coisa antes de enviar.')
    return { tipo: 'texto', texto: analisado.data.texto }
  }

  const tamanhoDeclarado = Number(request.headers.get('content-length') ?? 0)
  if (tamanhoDeclarado > LIMITE_ARQUIVO_BYTES + FOLGA_MULTIPART) return arquivoGrande()

  const formulario = await request.formData().catch(() => null)
  if (!formulario) return corpoInvalido('Não foi possível ler o arquivo enviado.')

  const audio = formulario.get('audio')
  const arquivo = formulario.get('arquivo')
  const parte = audio instanceof File ? audio : arquivo instanceof File ? arquivo : null
  if (!parte) return corpoInvalido('Envie um arquivo no campo "arquivo" ou um áudio no campo "audio".')
  if (parte.size > LIMITE_ARQUIVO_BYTES) return arquivoGrande()

  const dados = Buffer.from(await parte.arrayBuffer())

  if (parte === audio) {
    const duracao = Number(formulario.get('duracao'))
    return {
      tipo: 'audio',
      dados,
      mimetype: parte.type || 'audio/webm',
      duracao: Number.isFinite(duracao) && duracao > 0 ? Math.round(duracao) : null,
    }
  }

  const legenda = formulario.get('legenda')
  return {
    tipo: 'arquivo',
    dados,
    mimetype: parte.type || 'application/octet-stream',
    nome: (parte.name || 'arquivo').slice(0, 200),
    legenda: typeof legenda === 'string' && legenda.trim() ? legenda.trim().slice(0, 1024) : null,
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) return guarda.resposta

  const { id } = await params

  try {
    // Posse antes de ler o corpo: arquivo de 16 MB para conversa de outra
    // conta não merece nem ser recebido.
    const conversa = await conversaDaConta(guarda.sessao.userId, id)

    const conteudo = await lerConteudo(request)
    if (conteudo instanceof NextResponse) return conteudo

    const resultado = await enviarConteudo({
      conversa,
      autor: 'ATENDENTE',
      conteudo,
      // Resposta de uma pessoa: basta o celular pareado, qualquer que seja o
      // provedor dos avisos automáticos da loja.
      exigirProvedorEvolution: false,
    })

    if (resultado.ok) {
      return NextResponse.json({ mensagem: serializarMensagem(resultado.mensagem) }, { status: 201 })
    }

    /*
      A mensagem já está gravada com o erro, então a tela a mostra como não
      entregue em vez de perder o que o atendente escreveu. 409 é "falta
      parear"; 502 é "quem recusou foi a Evolution, não nós".

      `registro` devolve a mensagem gravada: sem ele a tela ficava com o balão
      provisório E o gravado (que chega na consulta seguinte), dois balões de
      erro para uma tentativa só.
    */
    const registro = serializarMensagem(resultado.mensagem)
    return resultado.motivo === 'sem-conexao'
      ? NextResponse.json({ codigo: 'SEM_CONEXAO', mensagem: resultado.erro, registro }, { status: 409 })
      : NextResponse.json({ codigo: 'ENVIO_RECUSADO', mensagem: resultado.erro, registro }, { status: 502 })
  } catch (erro) {
    return respostaDeErro(erro)
  }
}

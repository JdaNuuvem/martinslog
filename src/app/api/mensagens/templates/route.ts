import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { listarPerfis } from '@/server/perfil-service'
import { acharPerfil } from '@/server/perfil-service'
import { TEXTOS_PADRAO_SMS } from '@/domain/mensagem/texto'
import { VARIAVEIS_DISPONIVEIS } from '@/server/valores-da-mensagem'

/**
 * Os textos que saem sozinhos a cada evento do pedido.
 *
 * Não é área de administrador: escrever como a própria loja fala com o
 * comprador é trabalho do lojista, e era justamente o que não dava para fazer
 * — os textos nasciam do código, iguais para todo mundo, e ficavam assim.
 *
 * Só o canal SMS é editável por aqui. No WhatsApp oficial o texto vive
 * aprovado na Meta e mudar o nosso não muda o que ela manda; editar ali daria
 * a impressão de ter mudado algo que continua igual.
 */

const salvarSchema = z.object({
  evento: z.string().min(1),
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(1000),
  ativo: z.boolean().optional(),
})

/** Os eventos que a plataforma sabe disparar, com o texto de fábrica. */
const EVENTOS = [
  { codigo: 'PEDIDO_PAGO', rotulo: 'Pagamento confirmado' },
  { codigo: 'ETIQUETA_EMITIDA', rotulo: 'Etiqueta emitida' },
  { codigo: 'POSTADO', rotulo: 'Pedido postado' },
  { codigo: 'SAIU_PARA_ENTREGA', rotulo: 'Saiu para entrega' },
  { codigo: 'TENTATIVA_FRUSTRADA', rotulo: 'Tentativa de entrega sem sucesso' },
  { codigo: 'AGUARDANDO_RETIRADA', rotulo: 'Aguardando retirada' },
  { codigo: 'ENTREGUE', rotulo: 'Entregue' },
] as const

async function perfilDaConta(userId: string) {
  const perfis = await listarPerfis(userId)
  return perfis[0] ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ templates: [] })

  const salvos = await prisma.mensagemTemplate.findMany({
    where: { perfilId: perfil.id, canal: 'SMS' },
  })
  const porEvento = new Map(salvos.map((t) => [t.evento, t]))

  /*
    Devolve o catálogo inteiro, e não só o que a loja já editou. Uma tela que
    mostra três eventos porque só três foram salvos esconde os outros quatro
    que estão mandando mensagem agora mesmo.
  */
  return NextResponse.json({
    /*
      O catálogo inteiro, e não a mão-cheia que a tela mostrava antes. Havia
      seis variáveis funcionando e três anunciadas — `valor`, `link_checkout`
      e `codigo_rastreio` existiam e ninguém sabia. Variável que funciona e
      não aparece é recurso que não existe na prática.
    */
    variaveis: VARIAVEIS_DISPONIVEIS,
    templates: EVENTOS.map((e) => {
      const salvo = porEvento.get(e.codigo)
      return {
        evento: e.codigo,
        rotulo: e.rotulo,
        texto: salvo?.previa ?? TEXTOS_PADRAO_SMS[e.codigo] ?? '',
        ativo: salvo?.ativo ?? true,
        personalizado: Boolean(salvo),
      }
    }),
  })
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  if (!(await acharPerfil(sessao.userId, perfil.id))) {
    return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })
  }

  const corpo = await request.json().catch(() => ({}))
  const analisado = salvarSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  if (!EVENTOS.some((e) => e.codigo === analisado.data.evento)) {
    return NextResponse.json(
      { codigo: 'EVENTO_DESCONHECIDO', mensagem: 'Esse evento não existe.' },
      { status: 400 },
    )
  }

  const dados = {
    previa: analisado.data.texto,
    ativo: analisado.data.ativo ?? true,
  }

  await prisma.mensagemTemplate.upsert({
    where: {
      perfilId_evento_canal: {
        perfilId: perfil.id,
        evento: analisado.data.evento,
        canal: 'SMS',
      },
    },
    create: {
      perfilId: perfil.id,
      canal: 'SMS',
      evento: analisado.data.evento,
      nome: `sms-${analisado.data.evento.toLowerCase()}`,
      variaveis: [],
      ...dados,
    },
    update: dados,
  })

  return NextResponse.json({ ok: true })
}

/** Volta ao texto de fábrica. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfil = await perfilDaConta(sessao.userId)
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const evento = request.nextUrl.searchParams.get('evento')
  if (!evento) return NextResponse.json({ codigo: 'EVENTO_AUSENTE' }, { status: 400 })

  await prisma.mensagemTemplate.deleteMany({
    where: { perfilId: perfil.id, evento, canal: 'SMS' },
  })

  return NextResponse.json({ ok: true })
}

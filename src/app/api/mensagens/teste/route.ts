import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/infra/db/client'
import { lerSessao } from '@/server/auth/sessao'
import { listarPerfis } from '@/server/perfil-service'
import { compor, custoDoTexto, TEXTOS_PADRAO_SMS } from '@/domain/mensagem/texto'
import { normalizarTelefone } from '@/infra/whatsapp/cloud-api'
import { resolverCredencial } from '@/server/sms-service'
import { smsProvider } from '@/infra/sms'

/**
 * Manda o texto para um número escolhido, agora, sem passar pela fila.
 *
 * Existe porque o primeiro a ver um texto novo era um comprador de verdade:
 * um `{{codigo_rastreio}}` digitado com um sublinhado a menos só aparecia lá,
 * e não havia como voltar atrás.
 *
 * Não passa pela fila nem pelo `MensagemEnvio` de propósito. Isto não é uma
 * mensagem da operação — é um teste, e contaminar o histórico com ele faria a
 * loja contar como aviso ao cliente o que foi conferência interna.
 */

const testeSchema = z.object({
  para: z.string().min(1, 'Informe o número que vai receber.'),
  texto: z.string().trim().min(1, 'Escreva a mensagem.').max(1000),
})

/**
 * Valores de exemplo do teste.
 *
 * Os mesmos da prévia da tela: o que se quer conferir é o formato e o
 * tamanho da frase, e trocar os exemplos aqui faria o teste mostrar uma coisa
 * e a prévia outra.
 */
const EXEMPLOS: Record<string, string> = {
  loja: 'Sua Loja',
  cliente: 'Maria',
  pedido: 'PED-10482',
  produtos: 'Tênis branco, Meia kit 3',
  status: 'a caminho',
  codigo_rastreio: 'EC000123456BR',
  link_rastreio: 'https://app.martinslog.net/r/EC000123456BR',
  valor: 'R$ 189,90',
  prazo: '5',
  servico: 'Econômico',
  cidade: 'Campinas',
  uf: 'SP',
  link_checkout: 'https://sualoja.com/checkout/abc',
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })

  const perfis = await listarPerfis(sessao.userId)
  const perfil = perfis[0]
  if (!perfil) return NextResponse.json({ mensagem: 'Loja não encontrada.' }, { status: 404 })

  const corpo = await request.json().catch(() => ({}))
  const analisado = testeSchema.safeParse(corpo)
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

  const para = normalizarTelefone(analisado.data.para)
  if (!para) {
    return NextResponse.json(
      { codigo: 'TELEFONE_INVALIDO', mensagem: 'Esse número não parece válido.' },
      { status: 400 },
    )
  }

  const loja = await prisma.perfil.findUnique({
    where: { id: perfil.id },
    select: { nome: true, nomeExibicao: true },
  })

  const texto = compor(analisado.data.texto, {
    ...EXEMPLOS,
    loja: loja?.nomeExibicao?.trim() || loja?.nome || EXEMPLOS.loja,
  })

  const credencial = await resolverCredencial(perfil.id)
  if (!credencial.credenciais) {
    return NextResponse.json(
      {
        codigo: 'SEM_CANAL',
        mensagem: 'Conecte um provedor de SMS antes de testar.',
      },
      { status: 409 },
    )
  }

  const resultado = await smsProvider.enviar(credencial.credenciais, { para, texto })

  if (!resultado.ok) {
    /*
      502, e não 500: quem recusou foi o provedor. E a mensagem dele vai junto
      — "saldo insuficiente" e "número inválido" pedem coisas diferentes de
      quem está testando.
    */
    return NextResponse.json(
      { codigo: 'ENVIO_RECUSADO', mensagem: resultado.mensagem },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, texto, custo: custoDoTexto(texto) })
}

/** Os textos de fábrica, para a tela oferecer "testar o padrão". */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ padroes: TEXTOS_PADRAO_SMS })
}

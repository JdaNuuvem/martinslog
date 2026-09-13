import { NextResponse } from 'next/server'
import { DomainError, NaoAutorizadoError } from '@/domain/errors'
import { ArquivoGrandeDemaisError, ConteudoVazioError } from './envio-service'
import { AtalhoRepetidoError } from './template-whatsapp-service'
import { SemInstanciaConectadaError, SincronizacaoEmAndamentoError } from './importacao-service'
import { MidiaIndisponivelError } from './midia-service'

/**
 * Erro de domínio → resposta HTTP, igual para toda rota da caixa de entrada.
 *
 * Um lugar só porque o frontend está sendo feito contra o contrato: a mesma
 * falha respondendo 404 numa rota e 400 na vizinha é bug de tela que ninguém
 * consegue reproduzir.
 *
 * `NaoAutorizadoError` vira 404, e não 403: "não é seu" e "não existe" nunca
 * se distinguem para quem está do outro lado.
 */
export function respostaDeErro(erro: unknown): NextResponse {
  const corpo = (e: DomainError, codigo = e.codigo) => ({ codigo, mensagem: e.message })

  if (erro instanceof NaoAutorizadoError) {
    return NextResponse.json(corpo(erro, 'NAO_ENCONTRADO'), { status: 404 })
  }
  if (erro instanceof ArquivoGrandeDemaisError) return NextResponse.json(corpo(erro), { status: 413 })
  if (erro instanceof ConteudoVazioError) return NextResponse.json(corpo(erro), { status: 400 })
  if (
    erro instanceof AtalhoRepetidoError ||
    erro instanceof SincronizacaoEmAndamentoError ||
    erro instanceof SemInstanciaConectadaError
  ) {
    return NextResponse.json(corpo(erro), { status: 409 })
  }
  if (erro instanceof MidiaIndisponivelError) return NextResponse.json(corpo(erro), { status: 502 })
  if (erro instanceof DomainError) return NextResponse.json(corpo(erro), { status: 400 })

  console.error('Erro inesperado na caixa de entrada do WhatsApp', { cause: erro })
  return NextResponse.json(
    { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado. Tente de novo.' },
    { status: 500 },
  )
}

export function corpoInvalido(mensagem: string): NextResponse {
  return NextResponse.json({ codigo: 'CORPO_INVALIDO', mensagem }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { ehCodigoSandbox } from '@/domain/shipment/codigo-rastreio'
import { codigoRastreioSchema } from '@/lib/rastreio-schema'
import { obterIp } from '@/server/http/ip'
import { consumirCota, type PoliticaCota } from '@/server/rate-limit'
import { rastrearEnvio } from '@/server/rastreio-service'

type Params = { params: Promise<{ codigo: string }> }

/**
 * Contrapeso da consulta pública. O código tem 9 dígitos, então varrer o
 * espaço é viável para quem tiver banda — o dígito verificador descarta
 * cerca de 90% das tentativas antes de chegar ao banco, e este limite corta
 * o resto. Sem `TRUST_PROXY_HEADERS` o IP não é identificável e todas as
 * requisições compartilham o mesmo contador: em produção a aplicação
 * precisa estar atrás de um proxy que fixe `x-real-ip`.
 */
const COTA_RASTREIO: PoliticaCota = {
  escopo: 'rastreio',
  limite: 30,
  janelaMs: 5 * 60 * 1000,
}

/**
 * Consulta pública (spec 2026-08-31, seção 7): quem tem o código rastreia
 * sem login, e a resposta não carrega nome, documento nem endereço de
 * ninguém — só serviço, status e cidade/UF dos eventos.
 *
 * Código malformado ou com dígito verificador errado devolve 422 (dá para
 * corrigir digitando); código bem formado sem envio devolve 404. As duas
 * respostas custam a mesma cota, para que a varredura não saia de graça.
 */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const cota = consumirCota(COTA_RASTREIO, obterIp(request))
  if (!cota.permitido) {
    return NextResponse.json(
      {
        codigo: 'LIMITE_CONSULTAS_EXCEDIDO',
        mensagem: 'Muitas consultas em pouco tempo. Tente novamente em alguns minutos.',
      },
      { status: 429, headers: { 'Retry-After': String(cota.reabreEmSegundos) } },
    )
  }

  const { codigo } = await params
  const bruto = decodeURIComponent(codigo)
  const analise = codigoRastreioSchema.safeParse(bruto)
  if (!analise.success) {
    /*
      Código de teste ganha resposta própria. Ele é nosso, foi gerado pelo
      ambiente sandbox e simplesmente não tem rastreio público — devolver
      `CODIGO_INVALIDO` fazia o integrador procurar erro de digitação onde só
      faltava trocar a credencial de teste pela de produção.
    */
    if (ehCodigoSandbox(bruto)) {
      return NextResponse.json(
        {
          codigo: 'CODIGO_SANDBOX',
          mensagem:
            'Este é um código do ambiente de teste e não tem rastreio público. Use um token de produção para gerar códigos rastreáveis.',
        },
        { status: 422 },
      )
    }

    return NextResponse.json(
      { codigo: 'CODIGO_INVALIDO', mensagem: 'Código de rastreio inválido.' },
      { status: 422 },
    )
  }

  try {
    const rastreio = await rastrearEnvio(analise.data)
    return NextResponse.json({ rastreio })
  } catch (error) {
    if (error instanceof EnvioNaoEncontradoError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: 'Nenhum envio encontrado para este código.' },
        { status: 404 },
      )
    }

    console.error('Erro inesperado ao rastrear envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao consultar o rastreio.' },
      { status: 500 },
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { evolutionFalsa } from '@/test/evolution-falsa'

/**
 * As rotas que a tela chama para ler e responder, e para baixar mídia.
 *
 * Cobre o contrato com o frontend (201 + Mensagem, 413, 404) e a posse: um
 * administrador de outra conta não lê nem escreve na conversa desta.
 */

vi.mock('@/infra/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infra/whatsapp')>()),
  credenciaisDoServidor: () => ({ baseUrl: 'http://evolution.teste', apiKey: 'chave-teste' }),
}))

const { GET, POST } = await import('./route')
const midiaRota = await import('../../../mensagens/[id]/midia/route')
const { limparCacheDeMidia } = await import('@/server/whatsapp/midia-service')

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoDono = ''
let sessaoEstranho = ''
let conversaId = ''
let mensagemImagemId = ''
let falsa = evolutionFalsa()

async function admin(indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'ADMIN',
      documento: `7${indice}${sufixo}`.padEnd(11, '3').slice(0, 11),
      nome: `Admin caixa ${indice}`,
      email: `caixa-whatsapp-${indice}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return { id: user.id, sessao: await criarSessao(user.id, NextResponse.json({})) }
}

beforeAll(async () => {
  const dono = await admin(1)
  sessaoDono = dono.sessao
  sessaoEstranho = (await admin(2)).sessao

  // META de propósito: é a loja real que não conseguia responder.
  const perfil = await prisma.perfil.create({
    data: { userId: dono.id, nome: `caixa-rota-${sufixo}`, whatsappProvedor: 'META' },
  })
  await prisma.evolutionConfig.create({
    data: { perfilId: perfil.id, instancia: `loja-${perfil.id}`, conectadoEm: new Date(), sincronizadoEm: new Date() },
  })
  const conversa = await prisma.conversa.create({ data: { perfilId: perfil.id, jid: '501@lid' } })
  conversaId = conversa.id
  const imagem = await prisma.conversaMensagem.create({
    data: {
      conversaId,
      autor: 'CLIENTE',
      tipo: 'IMAGEM',
      midiaMimetype: 'image/jpeg',
      idExterno: `IMG-${sufixo}-${Date.now()}`,
    },
  })
  mensagemImagemId = imagem.id
})

beforeEach(() => {
  falsa = evolutionFalsa({ midia: { base64: Buffer.from('jpeg-falso').toString('base64'), mimetype: 'image/jpeg' } })
  vi.stubGlobal('fetch', falsa.fetch)
  limparCacheDeMidia()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

function requisicao(sessao: string, init?: { method?: string; body?: BodyInit; headers?: Record<string, string> }) {
  const headers = new Headers(init?.headers)
  headers.set('cookie', `${SESSION_COOKIE}=${sessao}`)
  return new NextRequest(`http://localhost/api/whatsapp/conversas/${conversaId}/mensagens`, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers,
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/whatsapp/conversas/[id]/mensagens', () => {
  it('responde em loja META com Evolution conectada: 201 e a Mensagem do contrato', async () => {
    const resposta = await POST(
      requisicao(sessaoDono, {
        method: 'POST',
        body: JSON.stringify({ texto: 'Oi! Posso ajudar?' }),
        headers: { 'content-type': 'application/json' },
      }),
      params(conversaId),
    )

    expect(resposta.status).toBe(201)
    const { mensagem } = await resposta.json()
    expect(mensagem).toMatchObject({
      autor: 'ATENDENTE',
      tipo: 'TEXTO',
      texto: 'Oi! Posso ajudar?',
      midia: null,
      status: 'ENVIADA',
      erro: null,
    })
    expect(typeof mensagem.ocorridoEm).toBe('string')
    expect(falsa.enviadas()[0]?.corpo.number).toBe('501@lid')
  })

  it('arquivo acima de 16 MB responde 413 e não envia', async () => {
    const formulario = new FormData()
    formulario.append('arquivo', new File([new Uint8Array(16 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' }))

    const resposta = await POST(requisicao(sessaoDono, { method: 'POST', body: formulario }), params(conversaId))

    expect(resposta.status).toBe(413)
    expect((await resposta.json()).codigo).toBe('ARQUIVO_GRANDE_DEMAIS')
    expect(falsa.enviadas()).toHaveLength(0)
  })

  it('áudio em multipart vai como áudio de voz', async () => {
    const formulario = new FormData()
    formulario.append('audio', new File([Buffer.from('webm-falso')], 'gravacao.webm', { type: 'audio/webm' }))

    const resposta = await POST(requisicao(sessaoDono, { method: 'POST', body: formulario }), params(conversaId))

    expect(resposta.status).toBe(201)
    expect((await resposta.json()).mensagem).toMatchObject({ tipo: 'AUDIO', midia: { mimetype: 'audio/webm' } })
    expect(falsa.enviadas()[0]?.rota).toBe('sendWhatsAppAudio')
  })

  it('administrador de outra conta recebe 404', async () => {
    const resposta = await POST(
      requisicao(sessaoEstranho, {
        method: 'POST',
        body: JSON.stringify({ texto: 'invasão' }),
        headers: { 'content-type': 'application/json' },
      }),
      params(conversaId),
    )
    expect(resposta.status).toBe(404)
    expect(falsa.enviadas()).toHaveLength(0)
  })
})

describe('GET mensagens e mídia', () => {
  it('lê as mensagens da própria conversa e nega a de outra conta', async () => {
    const dono = await GET(requisicao(sessaoDono), params(conversaId))
    expect(dono.status).toBe(200)
    const corpo = await dono.json()
    expect(Array.isArray(corpo.mensagens)).toBe(true)
    expect(typeof corpo.temMais).toBe('boolean')

    expect((await GET(requisicao(sessaoEstranho), params(conversaId))).status).toBe(404)
  })

  it('baixa a mídia com Content-Type e cache privado; outra conta recebe 404', async () => {
    const pedir = (sessao: string) =>
      midiaRota.GET(
        new NextRequest(`http://localhost/api/whatsapp/mensagens/${mensagemImagemId}/midia`, {
          headers: { cookie: `${SESSION_COOKIE}=${sessao}` },
        }),
        params(mensagemImagemId),
      )

    const resposta = await pedir(sessaoDono)
    expect(resposta.status).toBe(200)
    expect(resposta.headers.get('content-type')).toBe('image/jpeg')
    expect(resposta.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(Buffer.from(await resposta.arrayBuffer()).toString()).toBe('jpeg-falso')
    expect(falsa.chamadas.find((c) => c.rota === 'getBase64FromMediaMessage')?.corpo).toMatchObject({
      message: { key: { id: expect.stringMatching(/^IMG-/) } },
    })

    expect((await pedir(sessaoEstranho)).status).toBe(404)
  })
})

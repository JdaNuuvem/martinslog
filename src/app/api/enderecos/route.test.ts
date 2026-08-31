import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { GET, POST } from './route'
import { PUT } from './[id]/route'

async function criarUsuarioDeTeste(sufixo: string) {
  return prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `9${sufixo}`.padEnd(11, '1').slice(0, 11),
      nome: 'Usuário Teste Endereços',
      email: `enderecos-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
}

async function criarSessionId(userId: string): Promise<string> {
  return criarSessao(userId, NextResponse.json({}))
}

function criarRequest(method: string, sessionId: string | null, body?: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return new NextRequest('http://localhost/api/enderecos', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const corpoRemetenteValido = {
  tipo: 'REMETENTE' as const,
  apelido: 'Depósito',
  cep: '01001-000',
  logradouro: 'Praça da Sé',
  numero: '100',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
  padrao: true,
}

const usuariosCriados: string[] = []

afterAll(async () => {
  await prisma.address.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/enderecos', () => {
  it('devolve 401 sem sessão', async () => {
    const resposta = await POST(criarRequest('POST', null, corpoRemetenteValido))
    expect(resposta.status).toBe(401)
  })

  it('cria endereço para o usuário autenticado', async () => {
    const usuario = await criarUsuarioDeTeste('cria')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const resposta = await POST(criarRequest('POST', sessionId, corpoRemetenteValido))
    expect(resposta.status).toBe(201)

    const json = await resposta.json()
    expect(json.endereco.cidade).toBe('São Paulo')
    expect(json.endereco.uf).toBe('SP')
    expect(json.endereco.padrao).toBe(true)
  })

  it('devolve 400 com corpo inválido', async () => {
    const usuario = await criarUsuarioDeTeste('invalido')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const resposta = await POST(criarRequest('POST', sessionId, { tipo: 'REMETENTE' }))
    expect(resposta.status).toBe(400)
  })

  it('devolve 422 quando o documento do destinatário é inválido', async () => {
    const usuario = await criarUsuarioDeTeste('docinv')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const resposta = await POST(
      criarRequest('POST', sessionId, {
        ...corpoRemetenteValido,
        tipo: 'DESTINATARIO',
        documento: '11111111111',
      }),
    )
    expect(resposta.status).toBe(422)
    const json = await resposta.json()
    expect(json.codigo).toBe('DOCUMENTO_INVALIDO')
  })

  it('aceita documento válido do destinatário e normaliza', async () => {
    const usuario = await criarUsuarioDeTeste('docval')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const resposta = await POST(
      criarRequest('POST', sessionId, {
        ...corpoRemetenteValido,
        tipo: 'DESTINATARIO',
        documento: '529.982.247-25',
        nome: 'Cliente Final',
      }),
    )
    expect(resposta.status).toBe(201)
    const json = await resposta.json()
    expect(json.endereco.documento).toBe('52998224725')
  })

  it('marcar um endereço como padrão desmarca o padrão anterior do mesmo tipo, na mesma transação', async () => {
    const usuario = await criarUsuarioDeTeste('padrao')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const primeiro = await POST(criarRequest('POST', sessionId, corpoRemetenteValido))
    const primeiroJson = await primeiro.json()
    expect(primeiroJson.endereco.padrao).toBe(true)

    const segundo = await POST(
      criarRequest('POST', sessionId, { ...corpoRemetenteValido, apelido: 'Filial' }),
    )
    const segundoJson = await segundo.json()
    expect(segundoJson.endereco.padrao).toBe(true)

    const primeiroAtualizado = await prisma.address.findUnique({
      where: { id: primeiroJson.endereco.id },
    })
    expect(primeiroAtualizado?.padrao).toBe(false)
  })

  it('remetente padrão e destinatário padrão são independentes', async () => {
    const usuario = await criarUsuarioDeTeste('indep')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const remetente = await POST(criarRequest('POST', sessionId, corpoRemetenteValido))
    const remetenteJson = await remetente.json()

    const destinatario = await POST(
      criarRequest('POST', sessionId, {
        ...corpoRemetenteValido,
        tipo: 'DESTINATARIO',
        documento: '52998224725',
        nome: 'Cliente Final',
      }),
    )
    const destinatarioJson = await destinatario.json()

    const remetenteAtualizado = await prisma.address.findUnique({
      where: { id: remetenteJson.endereco.id },
    })
    expect(remetenteAtualizado?.padrao).toBe(true)
    expect(destinatarioJson.endereco.padrao).toBe(true)
  })
})

describe('corrida por endereço padrão (rodada de correção 1)', () => {
  it('criações concorrentes com padrao:true terminam com exatamente um endereço padrão', async () => {
    const usuario = await criarUsuarioDeTeste('corridaCria')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    // Quatro, não duas. Com apenas duas criações concorrentes este teste
    // passava mesmo com o lock consultivo removido — a primeira transação
    // costuma commitar antes de a segunda rodar seu `updateMany`, e a
    // corrida não se manifesta. Verificado: com duas, verde em três rodadas
    // sem o lock; com quatro, vermelho de forma consistente. Não reduza.
    const respostas = await Promise.all(
      ['A', 'B', 'C', 'D'].map((apelido) =>
        POST(criarRequest('POST', sessionId, { ...corpoRemetenteValido, apelido })),
      ),
    )

    for (const resposta of respostas) {
      // Nenhuma pode falhar: o lock faz as seguintes esperarem e enxergarem
      // o padrão já commitado, em vez de esbarrarem no índice único parcial.
      expect(resposta.status).toBe(201)
    }

    const padroes = await prisma.address.findMany({
      where: { userId: usuario.id, tipo: 'REMETENTE', padrao: true, arquivadoEm: null },
    })
    expect(padroes.length).toBe(1)
  })

  it('duas atualizações concorrentes marcando padrao:true terminam com exatamente um endereço padrão', async () => {
    const usuario = await criarUsuarioDeTeste('corridaEdita')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const respostaExistenteA = await POST(
      criarRequest('POST', sessionId, { ...corpoRemetenteValido, apelido: 'Existente A', padrao: false }),
    )
    const existenteA = (await respostaExistenteA.json()).endereco.id as string

    const respostaExistenteB = await POST(
      criarRequest('POST', sessionId, { ...corpoRemetenteValido, apelido: 'Existente B', padrao: false }),
    )
    const existenteB = (await respostaExistenteB.json()).endereco.id as string

    function chamarPut(id: string, apelido: string) {
      return PUT(criarRequest('PUT', sessionId, { ...corpoRemetenteValido, apelido, padrao: true }), {
        params: Promise.resolve({ id }),
      })
    }

    const [respostaA, respostaB] = await Promise.all([
      chamarPut(existenteA, 'Atualizado A'),
      chamarPut(existenteB, 'Atualizado B'),
    ])

    expect(respostaA.status).toBe(200)
    expect(respostaB.status).toBe(200)

    const padroes = await prisma.address.findMany({
      where: { userId: usuario.id, tipo: 'REMETENTE', padrao: true, arquivadoEm: null },
    })
    expect(padroes.length).toBe(1)
  })
})

describe('GET /api/enderecos', () => {
  it('devolve 401 sem sessão', async () => {
    const resposta = await GET(criarRequest('GET', null))
    expect(resposta.status).toBe(401)
  })

  it('lista apenas os endereços do próprio usuário', async () => {
    const usuarioA = await criarUsuarioDeTeste('listaA')
    const usuarioB = await criarUsuarioDeTeste('listaB')
    usuariosCriados.push(usuarioA.id, usuarioB.id)

    const sessionA = await criarSessionId(usuarioA.id)
    const sessionB = await criarSessionId(usuarioB.id)

    await POST(criarRequest('POST', sessionA, corpoRemetenteValido))
    await POST(criarRequest('POST', sessionB, corpoRemetenteValido))

    const resposta = await GET(criarRequest('GET', sessionA))
    const json = await resposta.json()

    expect(json.enderecos.length).toBe(1)
    expect(json.enderecos[0].userId).toBe(usuarioA.id)
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { POST as criarEnderecoRoute } from '../route'
import { DELETE, GET, PUT } from './route'

async function criarUsuarioDeTeste(sufixo: string) {
  return prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `8${sufixo}`.padEnd(11, '2').slice(0, 11),
      nome: 'Usuário Teste Endereço Dono',
      email: `endereco-dono-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
}

async function criarSessionId(userId: string): Promise<string> {
  return criarSessao(userId, NextResponse.json({}))
}

function requestCom(method: string, sessionId: string | null, body?: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  return new NextRequest('http://localhost/api/enderecos/x', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function chamar(
  fn: typeof GET,
  method: string,
  sessionId: string | null,
  id: string,
  body?: unknown,
) {
  return fn(requestCom(method, sessionId, body), { params: Promise.resolve({ id }) })
}

const corpoValido = {
  tipo: 'REMETENTE' as const,
  apelido: 'Depósito',
  cep: '01001-000',
  logradouro: 'Praça da Sé',
  numero: '100',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
}

const usuariosCriados: string[] = []

afterAll(async () => {
  await prisma.address.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function criarEnderecoDoUsuario(sessionId: string) {
  const resposta = await criarEnderecoRoute(requestCom('POST', sessionId, corpoValido))
  const json = await resposta.json()
  return json.endereco.id as string
}

describe('autorização por dono em /api/enderecos/[id]', () => {
  it('usuário A recebe 404 ao tentar LER endereço de usuário B', async () => {
    const usuarioA = await criarUsuarioDeTeste('A-ler')
    const usuarioB = await criarUsuarioDeTeste('B-ler')
    usuariosCriados.push(usuarioA.id, usuarioB.id)

    const sessionA = await criarSessionId(usuarioA.id)
    const sessionB = await criarSessionId(usuarioB.id)

    const idDoBId = await criarEnderecoDoUsuario(sessionB)

    const resposta = await chamar(GET, 'GET', sessionA, idDoBId)
    expect(resposta.status).toBe(404)
    const json = await resposta.json()
    expect(json.codigo).toBe('ENDERECO_NAO_ENCONTRADO')
    expect(json.endereco).toBeUndefined()
  })

  it('usuário A recebe 404 ao tentar EDITAR endereço de usuário B, e o registro não muda', async () => {
    const usuarioA = await criarUsuarioDeTeste('A-editar')
    const usuarioB = await criarUsuarioDeTeste('B-editar')
    usuariosCriados.push(usuarioA.id, usuarioB.id)

    const sessionA = await criarSessionId(usuarioA.id)
    const sessionB = await criarSessionId(usuarioB.id)

    const idDoBId = await criarEnderecoDoUsuario(sessionB)

    const resposta = await chamar(PUT, 'PUT', sessionA, idDoBId, {
      ...corpoValido,
      apelido: 'Invadido',
    })
    expect(resposta.status).toBe(404)

    const enderecoNoBanco = await prisma.address.findUnique({ where: { id: idDoBId } })
    expect(enderecoNoBanco?.apelido).toBe('Depósito')
  })

  it('usuário A recebe 404 ao tentar APAGAR endereço de usuário B, e o registro permanece', async () => {
    const usuarioA = await criarUsuarioDeTeste('A-apagar')
    const usuarioB = await criarUsuarioDeTeste('B-apagar')
    usuariosCriados.push(usuarioA.id, usuarioB.id)

    const sessionA = await criarSessionId(usuarioA.id)
    const sessionB = await criarSessionId(usuarioB.id)

    const idDoBId = await criarEnderecoDoUsuario(sessionB)

    const resposta = await chamar(DELETE, 'DELETE', sessionA, idDoBId)
    expect(resposta.status).toBe(404)

    const enderecoNoBanco = await prisma.address.findUnique({ where: { id: idDoBId } })
    expect(enderecoNoBanco?.arquivadoEm).toBeNull()
  })

  it('devolve 401 sem sessão', async () => {
    const resposta = await chamar(GET, 'GET', null, 'qualquer-id')
    expect(resposta.status).toBe(401)
  })
})

describe('CRUD do próprio dono em /api/enderecos/[id]', () => {
  it('dono consegue ler, editar e apagar (exclusão lógica) o próprio endereço', async () => {
    const usuario = await criarUsuarioDeTeste('dono')
    usuariosCriados.push(usuario.id)
    const sessionId = await criarSessionId(usuario.id)

    const id = await criarEnderecoDoUsuario(sessionId)

    const leitura = await chamar(GET, 'GET', sessionId, id)
    expect(leitura.status).toBe(200)

    const edicao = await chamar(PUT, 'PUT', sessionId, id, { ...corpoValido, apelido: 'Atualizado' })
    expect(edicao.status).toBe(200)
    const edicaoJson = await edicao.json()
    expect(edicaoJson.endereco.apelido).toBe('Atualizado')

    const exclusao = await chamar(DELETE, 'DELETE', sessionId, id)
    expect(exclusao.status).toBe(204)

    const enderecoNoBanco = await prisma.address.findUnique({ where: { id } })
    expect(enderecoNoBanco?.arquivadoEm).not.toBeNull()

    // Endereço arquivado não aparece mais para leitura via API (some da lista/consulta).
    const leituraDepois = await chamar(GET, 'GET', sessionId, id)
    expect(leituraDepois.status).toBe(404)
  })
})

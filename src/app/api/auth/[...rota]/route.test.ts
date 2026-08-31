import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { limparRateLimit } from '@/server/auth/rate-limit'
import { POST } from './route'

function criarRequest(rota: string[], body: unknown, opts?: { ip?: string; cookie?: string }): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts?.ip) headers.set('x-forwarded-for', opts.ip)
  if (opts?.cookie) headers.set('cookie', opts.cookie)

  return new NextRequest(`http://localhost/api/auth/${rota.join('/')}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

function chamarRota(
  rota: string[],
  body: unknown,
  opts?: { ip?: string; cookie?: string },
): Promise<Response> {
  return POST(criarRequest(rota, body, opts), { params: Promise.resolve({ rota }) })
}

const emailsCriados: string[] = []

afterAll(async () => {
  await prisma.session.deleteMany({}).catch(() => {})
  await prisma.wallet.deleteMany({ where: { user: { email: { in: emailsCriados } } } })
  await prisma.quote.deleteMany({ where: { user: { email: { in: emailsCriados } } } })
  await prisma.user.deleteMany({ where: { email: { in: emailsCriados } } })
})

describe('POST /api/auth/cadastro', () => {
  beforeEach(() => {
    limparRateLimit()
  })

  it('cria usuário com carteira de saldo zero, verificado no banco', async () => {
    const email = `cadastro-${Date.now()}@teste.com`
    emailsCriados.push(email)

    const resposta = await chamarRota(['cadastro'], {
      nome: 'Fulano da Silva',
      documento: '52998224725',
      email,
      telefone: '11999999999',
      senha: 'SenhaForte123!',
    })

    expect(resposta.status).toBe(201)
    const json = await resposta.json()
    expect(typeof json.userId).toBe('string')

    const wallet = await prisma.wallet.findUnique({ where: { userId: json.userId } })
    expect(wallet).not.toBeNull()
    expect(wallet!.saldoCentavos).toBe(0)

    const cookie = resposta.headers.get('set-cookie')
    expect(cookie).toContain('session_id=')
    expect(cookie).toContain('HttpOnly')
  })

  it('devolve 409 quando o e-mail já está cadastrado', async () => {
    const email = `duplicado-${Date.now()}@teste.com`
    emailsCriados.push(email)

    const dados = {
      nome: 'Duplicado Um',
      documento: '11144477735',
      email,
      senha: 'SenhaForte123!',
    }

    const primeira = await chamarRota(['cadastro'], dados)
    expect(primeira.status).toBe(201)

    const segunda = await chamarRota(['cadastro'], { ...dados, documento: '83703692600' })
    expect(segunda.status).toBe(409)
  })

  it('migra as Quote de uma AnonSession para o usuário recém-criado', async () => {
    const anonSession = await prisma.anonSession.create({ data: {} })
    const quote = await prisma.quote.create({
      data: {
        anonSessionId: anonSession.id,
        cepOrigem: '01001000',
        cepDestino: '20040002',
        formato: 'CAIXA',
        pesoG: 300,
        altura: 4,
        largura: 12,
        comprimento: 18,
        pesoCubadoG: 300,
        pesoTaxavelG: 300,
        opcionais: {},
        opcoes: [],
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    const email = `migracao-${Date.now()}@teste.com`
    emailsCriados.push(email)

    const resposta = await chamarRota(
      ['cadastro'],
      {
        nome: 'Migração Teste',
        documento: '25386230140',
        email,
        senha: 'SenhaForte123!',
      },
      { cookie: `anon_session_id=${anonSession.id}` },
    )

    expect(resposta.status).toBe(201)
    const json = await resposta.json()
    const quoteAtualizada = await prisma.quote.findUnique({ where: { id: quote.id } })
    expect(quoteAtualizada?.userId).toBe(json.userId)
  })

  it('IMP-1: cadastrar com o anon_session_id de uma AnonSession já consumida não rouba a Quote da vítima', async () => {
    const anonSession = await prisma.anonSession.create({ data: {} })
    const quoteDaVitima = await prisma.quote.create({
      data: {
        anonSessionId: anonSession.id,
        cepOrigem: '01001000',
        cepDestino: '20040002',
        formato: 'CAIXA',
        pesoG: 300,
        altura: 4,
        largura: 12,
        comprimento: 18,
        pesoCubadoG: 300,
        pesoTaxavelG: 300,
        opcionais: {},
        opcoes: [],
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    // A vítima se cadastra normalmente com o cookie da própria AnonSession:
    // isto consome a sessão (marca `consumidaEm`) e migra a cotação para ela.
    const emailVitima = `vitima-${Date.now()}@teste.com`
    emailsCriados.push(emailVitima)
    const respostaVitima = await chamarRota(
      ['cadastro'],
      {
        nome: 'Vítima Legítima',
        documento: '56543092696',
        email: emailVitima,
        senha: 'SenhaForte123!',
      },
      { cookie: `anon_session_id=${anonSession.id}` },
    )
    expect(respostaVitima.status).toBe(201)
    const jsonVitima = await respostaVitima.json()

    const quoteAposVitima = await prisma.quote.findUnique({ where: { id: quoteDaVitima.id } })
    expect(quoteAposVitima?.userId).toBe(jsonVitima.userId)

    const anonSessionApos = await prisma.anonSession.findUnique({ where: { id: anonSession.id } })
    expect(anonSessionApos?.consumidaEm).not.toBeNull()

    // O atacante captura (ou enumera) o mesmo anon_session_id — já usado —
    // e tenta se cadastrar mandando o mesmo cookie, esperando herdar a
    // cotação da vítima.
    const emailAtacante = `atacante-${Date.now()}@teste.com`
    emailsCriados.push(emailAtacante)
    const respostaAtacante = await chamarRota(
      ['cadastro'],
      {
        nome: 'Atacante',
        documento: '04030222404',
        email: emailAtacante,
        senha: 'SenhaForte123!',
      },
      { cookie: `anon_session_id=${anonSession.id}` },
    )
    expect(respostaAtacante.status).toBe(201)
    const jsonAtacante = await respostaAtacante.json()

    // A cotação da vítima continua com a vítima — o ataque falha.
    const quoteAposAtaque = await prisma.quote.findUnique({ where: { id: quoteDaVitima.id } })
    expect(quoteAposAtaque?.userId).toBe(jsonVitima.userId)
    expect(quoteAposAtaque?.userId).not.toBe(jsonAtacante.userId)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    limparRateLimit()
  })

  it('login correto devolve cookie de sessão', async () => {
    const email = `login-ok-${Date.now()}@teste.com`
    emailsCriados.push(email)
    const senha = 'SenhaForte123!'

    await chamarRota(['cadastro'], {
      nome: 'Login Ok',
      documento: '14570440991',
      email,
      senha,
    })

    const resposta = await chamarRota(['login'], { email, senha })
    expect(resposta.status).toBe(200)
    const cookie = resposta.headers.get('set-cookie')
    expect(cookie).toContain('session_id=')
  })

  it('senha errada devolve 401', async () => {
    const email = `login-senha-errada-${Date.now()}@teste.com`
    emailsCriados.push(email)

    await chamarRota(['cadastro'], {
      nome: 'Senha Errada',
      documento: '94872215060',
      email,
      senha: 'SenhaCorreta123!',
    })

    const resposta = await chamarRota(['login'], { email, senha: 'SenhaErrada999!' })
    expect(resposta.status).toBe(401)
  })

  it('e-mail inexistente devolve 401 com a mesma mensagem da senha errada', async () => {
    const emailExistente = `login-existe-${Date.now()}@teste.com`
    emailsCriados.push(emailExistente)

    await chamarRota(['cadastro'], {
      nome: 'Existe',
      documento: '61957301813',
      email: emailExistente,
      senha: 'SenhaCorreta123!',
    })

    const respostaSenhaErrada = await chamarRota(['login'], {
      email: emailExistente,
      senha: 'SenhaErradaAqui1!',
    })
    const jsonSenhaErrada = await respostaSenhaErrada.json()

    const respostaEmailInexistente = await chamarRota(['login'], {
      email: `nao-existe-${Date.now()}@teste.com`,
      senha: 'QualquerSenha123!',
    })
    const jsonEmailInexistente = await respostaEmailInexistente.json()

    expect(respostaSenhaErrada.status).toBe(401)
    expect(respostaEmailInexistente.status).toBe(401)
    expect(jsonEmailInexistente.mensagem).toBe(jsonSenhaErrada.mensagem)
  })

  it('a 6ª tentativa de login devolve 429', async () => {
    const email = `login-rate-limit-${Date.now()}@teste.com`

    for (let i = 0; i < 5; i += 1) {
      const resposta = await chamarRota(['login'], { email, senha: 'senha-errada' }, { ip: '10.0.0.9' })
      expect(resposta.status).toBe(401)
    }

    const sexta = await chamarRota(['login'], { email, senha: 'senha-errada' }, { ip: '10.0.0.9' })
    expect(sexta.status).toBe(429)
  })

  it('IMP-2: trocar o X-Forwarded-For a cada tentativa não escapa do rate limit (sem proxy confiável)', async () => {
    const email = `login-rate-limit-spoof-${Date.now()}@teste.com`

    for (let i = 0; i < 5; i += 1) {
      // Cada tentativa chega com um IP "de origem" diferente, forjado pelo
      // próprio chamador. Sem TRUST_PROXY_HEADERS=true, esse cabeçalho é
      // ignorado, então o eixo por e-mail ainda barra a 6ª tentativa.
      const resposta = await chamarRota(['login'], { email, senha: 'senha-errada' }, { ip: `10.0.0.${i}` })
      expect(resposta.status).toBe(401)
    }

    const sexta = await chamarRota(['login'], { email, senha: 'senha-errada' }, { ip: '10.0.0.99' })
    expect(sexta.status).toBe(429)
  })

  it('IMP-3: seis logins corretos seguidos continuam funcionando (sucesso não consome cota)', async () => {
    const email = `login-sucesso-repetido-${Date.now()}@teste.com`
    emailsCriados.push(email)
    const senha = 'SenhaForte123!'

    await chamarRota(['cadastro'], {
      nome: 'Sucesso Repetido',
      documento: '24967451926',
      email,
      senha,
    })

    for (let i = 0; i < 6; i += 1) {
      const resposta = await chamarRota(['login'], { email, senha })
      expect(resposta.status).toBe(200)
    }
  })

  it('IMP-3: cinco falhas seguidas de um acerto — o acerto não é barrado pelo rate limit', async () => {
    const email = `login-zera-apos-sucesso-${Date.now()}@teste.com`
    emailsCriados.push(email)
    const senha = 'SenhaForte123!'

    await chamarRota(['cadastro'], {
      nome: 'Zera Após Sucesso',
      documento: '32647126798',
      email,
      senha,
    })

    for (let i = 0; i < 5; i += 1) {
      const resposta = await chamarRota(['login'], { email, senha: 'senha-errada' })
      expect(resposta.status).toBe(401)
    }

    // A cota só é verificada/consumida no caminho de falha: mesmo depois
    // de 5 senhas erradas seguidas para este e-mail, a senha certa ainda
    // autentica — não é pré-bloqueada pelo rate limit. A prova detalhada
    // de que o contador de e-mail é zerado no sucesso (permitindo uma
    // nova sequência de falhas do zero) está em `rate-limit.test.ts`.
    const acerto = await chamarRota(['login'], { email, senha })
    expect(acerto.status).toBe(200)
  })
})

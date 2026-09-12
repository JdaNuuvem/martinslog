import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { limparRateLimit } from '@/server/auth/rate-limit'
import { cadastrarUsuario, type DadosCadastro } from '@/server/auth/cadastro'
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

/**
 * Cria a conta pelo SERVIÇO, e não pela rota pública.
 *
 * A rota de cadastro está fechada — conta nasce pelo painel de administração,
 * que chama esta mesma função. Os testes de login precisam de um usuário, não
 * da porta por onde ele entrou: usar a rota fechada como fixture faria falhas
 * de login que na verdade são "o usuário nunca existiu".
 */
async function criarConta(dados: DadosCadastro, anonSessionId: string | null = null) {
  emailsCriados.push(dados.email)
  return cadastrarUsuario(dados, { anonSessionId })
}

afterAll(async () => {
  await prisma.session.deleteMany({}).catch(() => {})
  await prisma.wallet.deleteMany({ where: { user: { email: { in: emailsCriados } } } })
  await prisma.quote.deleteMany({ where: { user: { email: { in: emailsCriados } } } })
  await prisma.user.deleteMany({ where: { email: { in: emailsCriados } } })
})

describe('POST /api/auth/cadastro — fechado', () => {
  beforeEach(() => {
    limparRateLimit()
  })

  it('recusa qualquer cadastro pela rota pública', async () => {
    /*
      A trava está no SERVIDOR, não na tela. Esconder o formulário não fecharia
      nada: esta rota aceita requisição direta de qualquer cliente, e o
      formulário é só a porta mais visível.
    */
    const resposta = await chamarRota(['cadastro'], {
      nome: 'Quem Tentou',
      documento: '52998224725',
      email: `tentativa-${Date.now()}@teste.com`,
      senha: 'SenhaForte123!',
    })

    expect(resposta.status).toBe(403)
    expect((await resposta.json()).codigo).toBe('CADASTRO_FECHADO')
  })

  it('recusa ANTES de olhar o corpo, então corpo inválido também é 403', async () => {
    // Se a validação viesse primeiro, um corpo malformado devolveria 400 e
    // revelaria que a rota ainda processa cadastro.
    const resposta = await chamarRota(['cadastro'], { nada: 'disso' })
    expect(resposta.status).toBe(403)
  })
})

/**
 * O que a criação de conta faz, testado onde ela VIVE.
 *
 * Estes casos rodavam pela rota pública, que fechou. A lógica não sumiu — o
 * painel de administração chama exatamente esta função —, então os testes
 * seguiram a lógica em vez de morrer com a porta.
 */
describe('cadastrarUsuario', () => {
  it('cria a carteira zerada junto com o usuário', async () => {
    const { userId } = await criarConta({
      nome: 'Fulano da Silva',
      documento: '52998224725',
      email: `cadastro-${Date.now()}@teste.com`,
      telefone: '11999999999',
      senha: 'SenhaForte123!',
    })

    const wallet = await prisma.wallet.findUnique({ where: { userId } })
    expect(wallet).not.toBeNull()
    expect(wallet!.saldoCentavos).toBe(0)
  })

  it('recusa e-mail já cadastrado', async () => {
    const email = `duplicado-${Date.now()}@teste.com`
    const dados = {
      nome: 'Duplicado Um',
      documento: '11144477735',
      email,
      senha: 'SenhaForte123!',
    }

    await criarConta(dados)
    // Duas contas com o mesmo e-mail deixariam o login ambíguo.
    await expect(criarConta({ ...dados, documento: '83703692600' })).rejects.toThrow()
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

    const { userId } = await criarConta(
      {
        nome: 'Migração Teste',
        documento: '25386230140',
        email: `migracao-${Date.now()}@teste.com`,
        senha: 'SenhaForte123!',
      },
      anonSession.id,
    )

    const quoteAtualizada = await prisma.quote.findUnique({ where: { id: quote.id } })
    expect(quoteAtualizada?.userId).toBe(userId)
  })

  it('IMP-1: uma AnonSession já consumida não entrega a Quote da vítima a mais ninguém', async () => {
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

    // A vítima cria a conta com a própria sessão: isto a CONSOME e migra a
    // cotação.
    const vitima = await criarConta(
      {
        nome: 'Vítima Legítima',
        documento: '56543092696',
        email: `vitima-${Date.now()}@teste.com`,
        senha: 'SenhaForte123!',
      },
      anonSession.id,
    )

    expect((await prisma.quote.findUnique({ where: { id: quoteDaVitima.id } }))?.userId).toBe(
      vitima.userId,
    )
    expect(
      (await prisma.anonSession.findUnique({ where: { id: anonSession.id } }))?.consumidaEm,
    ).not.toBeNull()

    // O atacante captura o mesmo id de sessão — já usado — e cria conta com
    // ele, esperando herdar a cotação.
    const atacante = await criarConta(
      {
        nome: 'Atacante',
        documento: '04030222404',
        email: `atacante-${Date.now()}@teste.com`,
        senha: 'SenhaForte123!',
      },
      anonSession.id,
    )

    const apos = await prisma.quote.findUnique({ where: { id: quoteDaVitima.id } })
    expect(apos?.userId).toBe(vitima.userId)
    expect(apos?.userId).not.toBe(atacante.userId)
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

    await criarConta({
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

    await criarConta({
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

    await criarConta({
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

    await criarConta({
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

    await criarConta({
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

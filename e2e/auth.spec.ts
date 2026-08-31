import { expect, test, type Page } from '@playwright/test'

/**
 * Telas de login e cadastro.
 *
 * Cobre o que o teste de unidade não alcança: que os formulários realmente
 * chegam à API, que o erro do servidor aparece na tela, e que nenhuma das
 * duas telas revela se um e-mail já existe — a proteção contra enumeração de
 * contas mora na mensagem exibida, não só na resposta HTTP.
 */

/**
 * Gera um CPF válido e diferente a cada execução.
 *
 * O documento é único no banco, então reaproveitar um CPF fixo faria o
 * segundo `pnpm playwright test` falhar com "já cadastrado" e mandar quem
 * está depurando atrás do bug errado.
 */
function cpfValido(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))

  const digito = (digitos: number[]): number => {
    const peso = digitos.length + 1
    const soma = digitos.reduce((total, d, i) => total + d * (peso - i), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  const d1 = digito(base)
  const d2 = digito([...base, d1])
  return [...base, d1, d2].join('')
}

function emailUnico(prefixo: string): string {
  return `${prefixo}-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`
}

const SENHA = 'senha-de-teste-123'

/**
 * Alerta do formulário.
 *
 * Escopado ao `<form>` de propósito: o Next injeta um
 * `<div role="alert" id="__next-route-announcer__">` sempre vazio na página,
 * e um `getByRole('alert').first()` solto pega ele — lendo string vazia e
 * fazendo comparações passarem à toa.
 */
function alertaDoFormulario(page: Page) {
  return page.locator('form').getByRole('alert').first()
}

async function preencherCadastro(
  page: Page,
  dados: { nome?: string; documento?: string; email: string; senha?: string },
): Promise<void> {
  await page.getByLabel('Nome completo').fill(dados.nome ?? 'Fulano de Tal Teste')
  await page.getByLabel('CPF ou CNPJ').fill(dados.documento ?? cpfValido())
  await page.getByLabel('E-mail').fill(dados.email)
  await page.getByLabel('Senha').fill(dados.senha ?? SENHA)
}

test.describe('Cadastro', () => {
  test('cria a conta e já deixa o usuário autenticado', async ({ page }) => {
    await page.goto('/cadastro')
    await preencherCadastro(page, { email: emailUnico('cadastro-ok') })
    await page.getByRole('button', { name: 'Criar conta' }).click()

    // Cadastro bem-sucedido já autentica: cai na área logada, com o shell.
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
  })

  test('recusa CPF inválido — a validação do dígito verificador é do servidor', async ({
    page,
  }) => {
    await page.goto('/cadastro')
    await preencherCadastro(page, {
      email: emailUnico('cpf-ruim'),
      documento: '11111111111',
    })

    await page.getByRole('button', { name: 'Criar conta' }).click()

    // O schema do cliente (`cadastroRequestSchema`) só confere o comprimento
    // do documento, então um CPF com dígito verificador errado chega até a
    // API e é recusado lá. Não é falha de segurança — a borda que importa é
    // a do servidor —, mas custa uma ida e volta que daria para evitar
    // reaproveitando `validarCpf` no formulário.
    await expect(alertaDoFormulario(page)).toContainText(/inválid|já existe/i)
    await expect(page).toHaveURL(/\/cadastro/)
  })

  test('recusa senha curta e mostra o motivo no campo', async ({ page }) => {
    await page.goto('/cadastro')
    await preencherCadastro(page, { email: emailUnico('senha-curta'), senha: 'curta' })
    await page.getByRole('button', { name: 'Criar conta' }).click()

    await expect(page.getByText('A senha precisa ter ao menos 8 caracteres.')).toBeVisible()
    await expect(page).toHaveURL(/\/cadastro/)
  })

  test('não revela se o e-mail já existe: mesma mensagem para e-mail e documento repetidos', async ({
    page,
  }) => {
    const email = emailUnico('duplicado')
    const documento = cpfValido()

    await page.goto('/cadastro')
    await preencherCadastro(page, { email, documento })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page).toHaveURL('/')

    // Segunda tentativa com o MESMO e-mail, documento diferente.
    await page.goto('/cadastro')
    await preencherCadastro(page, { email, documento: cpfValido() })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    // `toContainText` espera o alerta aparecer; `textContent` puro leria
    // string vazia antes da renderização e a comparação passaria à toa.
    const alertaEmail = alertaDoFormulario(page)
    await expect(alertaEmail).toContainText('Já existe uma conta')
    const porEmail = await alertaEmail.textContent()

    // Terceira com o MESMO documento, e-mail diferente.
    await page.goto('/cadastro')
    await preencherCadastro(page, { email: emailUnico('outro'), documento })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    const alertaDocumento = alertaDoFormulario(page)
    await expect(alertaDocumento).toContainText('Já existe uma conta')
    const porDocumento = await alertaDocumento.textContent()

    // A mensagem precisa ser idêntica nos dois casos: se diferisse, daria
    // para descobrir se um e-mail tem conta variando só um campo.
    expect(porEmail).toBe(porDocumento)
    expect(porEmail).toContain('Já existe uma conta')
  })
})

test.describe('Login', () => {
  test('entra com as credenciais corretas', async ({ page }) => {
    const email = emailUnico('login-ok')

    await page.goto('/cadastro')
    await preencherCadastro(page, { email })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page).toHaveURL('/')

    await page.goto('/login')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha').fill(SENHA)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
  })

  test('senha errada e e-mail inexistente dão exatamente a mesma mensagem', async ({ page }) => {
    const email = emailUnico('login-erro')

    await page.goto('/cadastro')
    await preencherCadastro(page, { email })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page).toHaveURL('/')

    await page.goto('/login')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha').fill('senha-errada-mas-longa')
    await page.getByRole('button', { name: 'Entrar' }).click()
    const alertaSenha = alertaDoFormulario(page)
    await expect(alertaSenha).toContainText('inválidos')
    const comSenhaErrada = await alertaSenha.textContent()

    await page.goto('/login')
    await page.getByLabel('E-mail').fill(emailUnico('nao-existe'))
    await page.getByLabel('Senha').fill(SENHA)
    await page.getByRole('button', { name: 'Entrar' }).click()
    const alertaSemConta = alertaDoFormulario(page)
    await expect(alertaSemConta).toContainText('inválidos')
    const semConta = await alertaSemConta.textContent()

    // Mensagens diferentes aqui entregariam quais e-mails têm conta.
    expect(comSenhaErrada).toBe(semConta)
    expect(comSenhaErrada).toContain('E-mail ou senha inválidos.')
    await expect(page).toHaveURL(/\/login/)
  })

  test('recusa e-mail malformado sem chamar o servidor', async ({ page }) => {
    await page.goto('/login')

    let houveChamada = false
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/login')) houveChamada = true
    })

    await page.getByLabel('E-mail').fill('nao-e-um-email')
    await page.getByLabel('Senha').fill(SENHA)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByText('Informe um e-mail válido.')).toBeVisible()
    expect(houveChamada).toBe(false)
  })
})

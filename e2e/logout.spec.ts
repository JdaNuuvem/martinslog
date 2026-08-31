import { expect, test } from '@playwright/test'

/**
 * Botão de sair na topbar.
 *
 * A API de logout já tinha cobertura própria — este arquivo cobre só o que
 * só existe do lado da interface: o clique leva ao login, a sessão morre de
 * verdade no servidor (não é só uma navegação de fachada), e o botão não
 * vaza para quem não está autenticado.
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
  return [...base, d1, digito([...base, d1])].join('')
}

function emailUnico(): string {
  return `logout-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`
}

async function cadastrarECair(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cadastro')
  await page.getByLabel('Nome completo').fill('Fulano que Sai')
  await page.getByLabel('CPF ou CNPJ').fill(cpfValido())
  await page.getByLabel('E-mail').fill(emailUnico())
  await page.getByLabel('Senha').fill('senha-de-teste-123')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page).toHaveURL('/')
}

test('clicar em "Sair" leva ao login', async ({ page }) => {
  await cadastrarECair(page)

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login/)
})

test('depois de sair, a sessão morreu de verdade — não é só navegação', async ({ page }) => {
  await cadastrarECair(page)

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Se o cookie de sessão ainda fosse válido, esta navegação renderizaria a
  // área logada em vez de mandar de volta ao login.
  await page.goto('/carteira')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0)
})

test('o botão "Sair" não aparece para quem não está autenticado', async ({ page }) => {
  await page.context().clearCookies()
  await page.goto('/login')

  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0)
})

import { expect, test } from '@playwright/test'
import { entrarComContaNova } from './apoio/sessao'

/**
 * Guarda das rotas autenticadas.
 *
 * Antes desta guarda, `/etiquetas` desenhava o shell inteiro para um
 * visitante — abas, busca, navegação — e só falhava na chamada da API, com
 * uma mensagem que descrevia mal o problema real.
 */

const ROTAS_PROTEGIDAS = [
  '/etiquetas',
  '/rastreio',
  '/rastreio/status',
  '/enderecos',
  '/carteira',
  '/perfil',
]

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

test.describe('visitante sem sessão', () => {
  for (const rota of ROTAS_PROTEGIDAS) {
    test(`${rota} manda para o login em vez de desenhar a área logada`, async ({ page }) => {
      await page.context().clearCookies()
      await page.goto(rota)

      await expect(page).toHaveURL(/\/login/)

      // O ponto não é só a URL: a navegação da área logada não pode ter sido
      // renderizada no caminho.
      await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0)
    })
  }
})

test.describe('conta autenticada', () => {
  test('entra na área logada e vê o próprio nome na topbar', async ({ page }) => {
    const email = `guarda-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`

    await page.goto('/cadastro')
    await page.getByLabel('Nome completo').fill('Fulano da Guarda')
    await page.getByLabel('CPF ou CNPJ').fill(cpfValido())
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha').fill('senha-de-teste-123')
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page).toHaveURL('/')

    await page.goto('/etiquetas')
    await expect(page).toHaveURL('/etiquetas')
    await expect(page.getByRole('heading', { name: 'Etiquetas' })).toBeVisible()

    // A topbar mostrava "VISITANTE" fixo mesmo para quem estava logado.
    await expect(page.getByText('Fulano da Guarda', { exact: false }).first()).toBeVisible()
  })

  test('perde o acesso quando a sessão é descartada', async ({ page }) => {
    const email = `guarda-saida-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`

    await page.goto('/cadastro')
    await page.getByLabel('Nome completo').fill('Fulano que Sai')
    await page.getByLabel('CPF ou CNPJ').fill(cpfValido())
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha').fill('senha-de-teste-123')
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page).toHaveURL('/')

    await page.context().clearCookies()
    await page.goto('/etiquetas')

    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('fronteira entre vendedor e destinatário', () => {
  test('a calculadora exige cadastro: visitante vai para o login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/')

    // A raiz era aberta, e com ela vinha a navegação inteira do produto.
    // Quem só recebeu um código de rastreio via a área de trabalho de um
    // lojista, com telas que o recusariam ao primeiro clique.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0)
  })

  test('o rastreio é público e não mostra a navegação do vendedor', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/rastrear')

    await expect(page).toHaveURL(/\/rastrear/)
    await expect(page.getByRole('heading', { name: 'Rastrear pedido' })).toBeVisible()

    // O destinatário não é vendedor: nada de etiquetas, carteira ou
    // integrações na tela dele.
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Etiquetas' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Integrações' })).toHaveCount(0)
  })

  test('cadastrar leva à área logada, e não de volta ao formulário', async ({ page }) => {
    // Regressão: quando a raiz passou a exigir sessão, o roteador do cliente
    // servia o redirecionamento em cache e o recém-cadastrado voltava ao
    // formulário sem explicação.
    await entrarComContaNova(page, 'pos-cadastro')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
  })
})

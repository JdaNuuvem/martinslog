import { expect, test } from '@playwright/test'

test('topbar mostra saldo em verde, sublinhado e clicável para /carteira', async ({ page }) => {
  await page.goto('/')
  const saldo = page.getByRole('link', { name: 'R$ 0,00' })
  await expect(saldo).toBeVisible()
  await saldo.click()
  await expect(page).toHaveURL('/carteira')
  await expect(page.getByRole('heading', { name: 'Carteira' })).toBeVisible()
})

test('sidebar mostra os sete itens na ordem e destaca o item ativo', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  const itens = nav.getByRole('link')
  await expect(itens).toHaveText([
    'Calcular',
    'Etiquetas',
    'Rastreio',
    'Ajuda',
    'Integrações',
    'Convide e ganhe',
    'Perfil',
  ])
  await expect(nav.getByRole('link', { name: 'Calcular' })).toHaveAttribute('aria-current', 'page')
})

test('rotas ainda não implementadas mostram página "Em breve" em vez de 404', async ({ page }) => {
  await page.goto('/integracoes')
  await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible()
})

test('abaixo de 1024px o menu retrátil abre pelo botão e fecha com Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')

  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden()

  await page.getByRole('button', { name: 'Abrir menu de navegação' }).click()
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(nav).toBeHidden()
})

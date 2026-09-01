import { expect, test } from '@playwright/test'
import { entrarComContaNova } from './apoio/sessao'

test('topbar mostra o saldo da conta, clicável para /carteira', async ({ page }) => {
  // O atalho de saldo é da área logada: a topbar deixou de exibir um
  // "R$ 0,00" fixo para visitante quando passou a buscar o saldo real.
  await entrarComContaNova(page, 'saldo')
  await page.waitForLoadState('networkidle')

  const saldo = page.getByRole('link', { name: 'R$ 0,00' })
  await expect(saldo).toBeVisible()
  await saldo.click()
  await expect(page).toHaveURL('/carteira')
  await expect(page.getByRole('heading', { name: 'Carteira' })).toBeVisible()
})

test('visitante sem sessão não vê atalho de saldo na topbar', async ({ page }) => {
  // Guarda do comportamento novo: mostrar "R$ 0,00" a quem não entrou seria
  // afirmar um saldo que não existe.
  await page.context().clearCookies()
  // A raiz deixou de ser pública: a única tela aberta a quem não tem conta é
  // o rastreio, e é lá que a ausência do atalho de saldo precisa valer.
  await page.goto('/rastrear')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('link', { name: /R\$/ })).toHaveCount(0)
})

test('sidebar mostra os itens na ordem e destaca o item ativo', async ({ page }) => {
  // A navegação do vendedor é da área logada: a raiz deixou de ser pública
  // quando a calculadora passou a exigir cadastro.
  await entrarComContaNova(page, 'sidebar')
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  const itens = nav.getByRole('link')
  await expect(itens).toHaveText([
    'Calcular',
    'Etiquetas',
    'Rastreio',
    // Atalho para o construtor de fluxo, acrescentado depois: a tela existia
    // e não tinha caminho até ela na navegação.
    'Fluxo do rastreio',
    'Ajuda',
    'Integrações',
    'Convide e ganhe',
    'Perfil',
  ])
  await expect(nav.getByRole('link', { name: 'Calcular' })).toHaveAttribute('aria-current', 'page')
})

test('rotas da área logada respondem com a tela, e não com 404', async ({ page }) => {
  // Precisa de sessão desde que a área logada passou a redirecionar quem não
  // entrou: sem isso o teste cai no login e falha por não achar a tela, não
  // porque a tela esteja quebrada.
  await entrarComContaNova(page, 'shell')

  await page.goto('/integracoes')
  await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible()
})

test('abaixo de 1024px o menu retrátil abre pelo botão e fecha com Escape', async ({ page }) => {
  await entrarComContaNova(page, 'menu-mobile')
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')

  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden()

  await page.getByRole('button', { name: 'Abrir menu de navegação' }).click()
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(nav).toBeHidden()
})

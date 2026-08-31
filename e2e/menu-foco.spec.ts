import { expect, test } from '@playwright/test'

/**
 * Foco do menu retrátil em mobile.
 *
 * Arquivo separado de `shell.spec.ts` de propósito: aquele cobre a estrutura
 * visual do shell, este cobre só o percurso do foco pelo teclado — que é
 * invisível numa captura de tela e por isso escapa da revisão a olho.
 */

const MOBILE = { width: 390, height: 844 }

test.use({ viewport: MOBILE })

test('devolve o foco ao botão de menu ao fechar com Escape', async ({ page }) => {
  await page.goto('/')

  const botao = page.getByRole('button', { name: 'Abrir menu de navegação' })
  await botao.click()

  // Ao abrir, o foco entra na sidebar — senão o teclado continuaria na página
  // por baixo do menu.
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav.getByRole('link', { name: 'Calcular' })).toBeFocused()

  await page.keyboard.press('Escape')

  await expect(nav).toBeHidden()
  await expect(page.getByRole('button', { name: 'Abrir menu de navegação' })).toBeFocused()
})

test('devolve o foco ao botão de menu ao fechar pelo botão Fechar', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Abrir menu de navegação' }).click()

  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await nav.getByRole('button', { name: 'Fechar menu de navegação' }).click()

  await expect(page.getByRole('button', { name: 'Abrir menu de navegação' })).toBeFocused()
})

test('não rouba o foco quando o menu fecha por navegação em um link', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Abrir menu de navegação' }).click()
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await nav.getByRole('link', { name: 'Ajuda' }).click()

  await expect(page).toHaveURL('/ajuda')
  // Quem clicou num link quer ir para a página nova; puxar o foco de volta
  // para o botão de menu jogaria o leitor de tela para trás.
  await expect(page.getByRole('button', { name: 'Abrir menu de navegação' })).not.toBeFocused()
})

test('mantém aria-expanded sincronizado com o estado do menu', async ({ page }) => {
  await page.goto('/')

  const botao = page.getByRole('button', { name: 'Abrir menu de navegação' })
  await expect(botao).toHaveAttribute('aria-expanded', 'false')
  await expect(botao).toHaveAttribute('aria-controls', 'menu-navegacao')

  await botao.click()
  await expect(page.getByRole('button', { name: 'Fechar menu de navegação' }).first()).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Abrir menu de navegação' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

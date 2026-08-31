import { expect, test } from '@playwright/test'

test('calcula o frete e mostra ao menos uma opção com desconto', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('CEP de origem').fill('01001-000')
  await page.getByLabel('CEP de destino').fill('20040-002')

  await page.getByLabel('Peso').selectOption('300')

  await page.getByLabel('Altura (cm)').fill('4')
  await page.getByLabel('Largura (cm)').fill('12')
  await page.getByLabel('Comprimento (cm)').fill('18')

  await page.getByRole('button', { name: 'Calcular frete com desconto' }).click()

  const opcoes = page.getByTestId('opcao-frete')
  await expect(opcoes.first()).toBeVisible()

  const quantidade = await opcoes.count()
  let encontrouDesconto = false

  for (let i = 0; i < quantidade; i += 1) {
    const opcao = opcoes.nth(i)
    if ((await opcao.getAttribute('data-disponivel')) !== 'true') continue

    const precoBalcaoTexto = await opcao.locator('span.line-through').textContent()
    const precoFinalTexto = await opcao.locator('span.text-brand-texto').last().textContent()
    if (!precoBalcaoTexto || !precoFinalTexto) continue

    const precoBalcao = Number(precoBalcaoTexto.replace(/[^\d,]/g, '').replace(',', '.'))
    const precoFinal = Number(precoFinalTexto.replace(/[^\d,]/g, '').replace(',', '.'))

    if (precoFinal < precoBalcao) {
      encontrouDesconto = true
      break
    }
  }

  expect(encontrouDesconto).toBe(true)
})

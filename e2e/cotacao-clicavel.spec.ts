import { expect, test } from '@playwright/test'
import { entrarComContaNova } from './apoio/sessao'

/**
 * O cartão de cotação da home é o começo do caminho de compra: clicar nele
 * leva ao fluxo de envio já com a cotação escolhida, e o fluxo termina no
 * pagamento em créditos e na etiqueta gerada.
 *
 * Os dois testes cobrem as duas portas — visitante e autenticado — porque a
 * diferença entre elas é justamente o que se perde quando dá errado: um
 * visitante mandado para o login sem o destino recalcula tudo de novo.
 */

async function calcularNaHome(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')

  await page.getByLabel('CEP de origem').fill('01001-000')
  await page.getByLabel('CEP de destino').fill('20040-002')
  await page.getByLabel('Peso').selectOption('300')
  await page.getByLabel('Altura (cm)').fill('4')
  await page.getByLabel('Largura (cm)').fill('12')
  await page.getByLabel('Comprimento (cm)').fill('18')

  await page.getByRole('button', { name: 'Calcular frete com desconto' }).click()
  // Timeout folgado de propósito: a primeira cotação de cada execução paga a
  // compilação da rota, e o padrão de 5 s transforma isso em vermelho
  // intermitente que não corresponde a bug nenhum.
  await expect(page.getByTestId('opcao-frete').first()).toBeVisible({ timeout: 20_000 })
}

test('visitante clica na opção, entra e volta para o fluxo com a cotação escolhida', async ({ page }) => {
  await calcularNaHome(page)

  const link = page.getByTestId('opcao-frete-link').first()
  const href = await link.getAttribute('href')
  expect(href).toContain('/login?destino=')
  expect(decodeURIComponent(href ?? '')).toContain('/envios/novo?quoteId=')
})

test('autenticado clica na opção e cai no fluxo de envio já cotado', async ({ page }) => {
  await entrarComContaNova(page, 'cotacao-clique')
  await calcularNaHome(page)

  await page.getByTestId('opcao-frete-link').first().click()

  await page.waitForURL('**/envios/novo?quoteId=*servicoId=*', { timeout: 20_000 })

  // Chegar direto no remetente é o ganho: a etapa de cotação foi pulada
  // porque a cotação veio pronta da home.
  await expect(page.getByRole('group', { name: 'Remetente' })).toBeVisible()
})

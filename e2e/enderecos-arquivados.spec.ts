import { expect, test } from '@playwright/test'

/**
 * Reativação de endereço arquivado.
 *
 * Antes desta tela, arquivar era um caminho sem volta pela interface: a
 * exclusão sempre foi lógica no banco, mas o endereço sumia para sempre aos
 * olhos do usuário.
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

test('arquiva um endereço e o recupera pela seção de arquivados', async ({ page }) => {
  const email = `arquivados-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`

  await page.goto('/cadastro')
  await page.getByLabel('Nome completo').fill('Fulano dos Arquivados')
  await page.getByLabel('CPF ou CNPJ').fill(cpfValido())
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill('senha-de-teste-123')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page).toHaveURL('/')

  await page.goto('/enderecos')

  const remetentes = page.locator('section').filter({ hasText: 'Remetentes' }).first()
  await remetentes.getByRole('button', { name: /Novo remetente/ }).click()

  await page.getByLabel('Apelido').fill('Casa velha')
  await page.getByLabel('CEP').fill('01001-000')
  await page.getByLabel('Logradouro').fill('Praça da Sé')
  await page.getByLabel('Número').fill('100')
  await page.getByLabel('Bairro').fill('Sé')
  await page.getByLabel('Cidade').fill('São Paulo')
  await page.getByLabel('UF').fill('SP')
  await page.getByRole('button', { name: /Salvar|Cadastrar/ }).click()

  await expect(page.getByText('Casa velha')).toBeVisible()

  // Arquiva.
  await page.getByRole('button', { name: 'Apagar' }).first().click()
  await expect(page.getByText('Casa velha')).toBeHidden()

  // Recupera.
  const arquivados = page.locator('section').filter({ hasText: 'Endereços arquivados' }).first()
  await arquivados.getByRole('button', { name: 'Mostrar' }).click()
  await expect(arquivados.getByText('Casa velha')).toBeVisible()

  await arquivados.getByRole('button', { name: 'Reativar' }).click()

  // Volta para a lista ativa e some dos arquivados.
  await expect(arquivados.getByText('Nenhum endereço arquivado.')).toBeVisible()
  await expect(remetentes.getByText('Casa velha')).toBeVisible()
})

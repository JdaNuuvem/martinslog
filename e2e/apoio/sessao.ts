import type { Page } from '@playwright/test'

/**
 * Cria uma conta nova e entra com ela.
 *
 * Existe porque a área logada passou a redirecionar quem não tem sessão: um
 * teste que navega para `/ajuda` ou `/integracoes` sem entrar cai no login e
 * falha por não achar a tela — não porque a tela esteja quebrada.
 *
 * Cria conta em vez de reaproveitar uma fixa para os testes não disputarem o
 * mesmo usuário: eles rodam contra o mesmo banco e uma conta compartilhada
 * faria um teste enxergar o estado deixado por outro.
 */
export async function entrarComContaNova(page: Page, prefixo = 'e2e'): Promise<string> {
  const email = `${prefixo}-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`

  await page.goto('/cadastro')
  await page.getByLabel('Nome completo').fill('Conta de Teste E2E')
  await page.getByLabel('CPF ou CNPJ').fill(cpfValido())
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill('senha-de-teste-123')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.waitForURL('**/', { timeout: 20_000 })

  return email
}

/**
 * CPF válido e diferente a cada chamada. O documento é único no banco, então
 * um valor fixo faria a segunda execução falhar com "já cadastrado" e mandar
 * quem depura atrás do bug errado.
 */
export function cpfValido(): string {
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

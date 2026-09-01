import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'
import { entrarComContaNova } from './apoio/sessao'

const ADMIN_EMAIL = 'admin@frete.teste'
const ADMIN_SENHA = 'AdminTeste123!'

const CEP_ORIGEM = '01001-000'
const CEP_DESTINO = '20040-002'

/**
 * O fim do caminho de compra: confirmar o pagamento em créditos leva direto à
 * página da etiqueta recém-gerada, dentro da aba Etiquetas.
 *
 * Antes o wizard parava numa tela dizendo que a etiqueta "será gerada em
 * seguida" e deixava o cliente procurá-la sozinho — apesar de ela já existir,
 * com código de rastreio, no instante em que o pagamento voltou. Este teste
 * existe para essa ponte não sumir de novo numa refatoração.
 */

/** Sessão de API do admin, único caminho que confirma uma recarga. */
async function contextoAdmin(): Promise<APIRequestContext> {
  // Mesma porta configurável do resto da suíte (`PLAYWRIGHT_PORT`): fixar
  // 3100 aqui faria o teste falar com o servidor de outra sessão.
  const porta = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
  const contexto = await request.newContext({ baseURL: `http://localhost:${porta}` })
  const login = await contexto.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, senha: ADMIN_SENHA },
  })
  expect(login.ok(), await login.text()).toBe(true)
  return contexto
}

async function creditarSaldo(page: Page, admin: APIRequestContext, valorCentavos: number): Promise<void> {
  const recarga = await page.request.post('/api/carteira/recarga', { data: { valorCentavos } })
  expect(recarga.ok(), await recarga.text()).toBe(true)
  const { recarga: dados } = (await recarga.json()) as { recarga: { paymentIntentId: string } }
  const confirmado = await admin.post('/api/carteira/confirmar', {
    data: { paymentIntentId: dados.paymentIntentId },
  })
  expect(confirmado.ok(), await confirmado.text()).toBe(true)
}

async function criarEndereco(page: Page, tipo: 'REMETENTE' | 'DESTINATARIO'): Promise<void> {
  const resposta = await page.request.post('/api/enderecos', {
    data: {
      tipo,
      apelido: tipo === 'REMETENTE' ? 'Origem do teste' : 'Destino do teste',
      nome: tipo === 'REMETENTE' ? 'Remetente do Teste' : 'Destinatário do Teste',
      cep: tipo === 'REMETENTE' ? CEP_ORIGEM : CEP_DESTINO,
      logradouro: tipo === 'REMETENTE' ? 'Praça da Sé' : 'Avenida Rio Branco',
      numero: '100',
      bairro: 'Centro',
      cidade: tipo === 'REMETENTE' ? 'São Paulo' : 'Rio de Janeiro',
      uf: tipo === 'REMETENTE' ? 'SP' : 'RJ',
    },
  })
  expect(resposta.ok(), await resposta.text()).toBe(true)
}

test('pagar em créditos abre a página da etiqueta gerada', async ({ page }) => {
  const admin = await contextoAdmin()
  await entrarComContaNova(page, 'etiqueta-redirect')
  await creditarSaldo(page, admin, 50_00)
  await criarEndereco(page, 'REMETENTE')
  await criarEndereco(page, 'DESTINATARIO')

  // Cotação pela home, e clique no cartão — o mesmo caminho do cliente.
  await page.goto('/')
  await page.getByLabel('CEP de origem').fill(CEP_ORIGEM)
  await page.getByLabel('CEP de destino').fill(CEP_DESTINO)
  await page.getByLabel('Peso').selectOption('300')
  await page.getByLabel('Altura (cm)').fill('4')
  await page.getByLabel('Largura (cm)').fill('12')
  await page.getByLabel('Comprimento (cm)').fill('18')
  await page.getByRole('button', { name: 'Calcular frete com desconto' }).click()

  await expect(page.getByTestId('opcao-frete').first()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('opcao-frete-link').first().click()
  await page.waitForURL('**/envios/novo?quoteId=*', { timeout: 20_000 })

  // Remetente → destinatário → produtos → revisão.
  await page.getByRole('group', { name: 'Remetente' }).getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Continuar' }).click()

  await page.getByRole('group', { name: 'Destinatário' }).getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Continuar' }).click()

  // Por id, e não por rótulo: "Produto" também casa com o botão "Remover
  // produto 1" da mesma linha.
  await page.locator('#produto-nome-0').fill('Caneca de teste')
  await page.locator('#produto-qtd-0').fill('1')
  await page.locator('#produto-valor-0').fill('39,90')
  await page.getByRole('button', { name: 'Continuar' }).click()

  await page.getByRole('button', { name: 'Confirmar' }).click()

  // O ponto do teste: a etiqueta abre sozinha, e é a do envio que acabou de
  // ser pago — não a listagem, não uma tela de "aguarde".
  await page.waitForURL(/\/etiquetas\/[^/]+$/, { timeout: 30_000 })
  await expect(page.getByText('Aguardando postagem').first()).toBeVisible({ timeout: 20_000 })

  await admin.dispose()
})

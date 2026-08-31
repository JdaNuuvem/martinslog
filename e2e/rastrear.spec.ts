import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'

/**
 * Cobre a porta de entrada pública `/rastrear` (spec 2026-08-30, task
 * página rastrear): o campo aceita o código como a pessoa vai digitar
 * (espaços, minúsculas), a mensagem de "não encontrado" não usa jargão
 * técnico, a página não exige login, e nenhum dado pessoal do destinatário
 * aparece na tela — mesmo com um envio real.
 *
 * Um único envio é criado em `beforeAll` e reaproveitado pelos casos que
 * precisam de um código válido: a API de rastreio tem cota de 30 consultas
 * por 5 minutos por IP, e todo o Playwright roda do mesmo IP. Criar um
 * envio por teste (cotação + cadastro + envio) multiplicaria chamadas sem
 * necessidade.
 */

const CEP_ORIGEM = '01001-000'
const CEP_DESTINO = '20040-002'

function cpfValido(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const digito = (digitos: number[]): number => {
    const peso = digitos.length + 1
    const soma = digitos.reduce((total, d, i) => total + d * (peso - i), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const d1 = digito(base)
  const d2 = digito([...base, d1])
  return [...base, d1, d2].join('')
}

function emailUnico(prefixo: string): string {
  return `${prefixo}-${Date.now()}-${Math.floor(Math.random() * 100000)}@teste.com`
}

function enderecoBase(cep: string, cidade: string, uf: string, logradouro: string, nome: string) {
  return {
    nome,
    documento: cpfValido(),
    email: emailUnico('endereco'),
    telefone: '11999990000',
    cep,
    logradouro,
    numero: '100',
    complemento: '',
    bairro: 'Centro',
    cidade,
    uf,
  }
}

type RespostaCotacao = { quoteId: string; opcoes: { servicoId: string; disponivel: boolean }[] }

/** Cota, cadastra um cliente novo e emite um envio real. Devolve o código de rastreio, o nome e o logradouro do destinatário (para provar a ausência deles na tela). */
async function criarEnvioReal(
  request: APIRequestContext,
  browser: Browser,
): Promise<{ codigoRastreio: string; nomeDestinatario: string; logradouroDestinatario: string }> {
  const respostaCotacao = await request.post('/api/cotacao', {
    data: {
      cepOrigem: CEP_ORIGEM,
      cepDestino: CEP_DESTINO,
      pesoG: 300,
      alturaCm: 4,
      larguraCm: 12,
      comprimentoCm: 18,
      formato: 'CAIXA',
    },
  })
  expect(respostaCotacao.ok(), await respostaCotacao.text()).toBe(true)
  const { quoteId, opcoes } = (await respostaCotacao.json()) as RespostaCotacao
  const opcao = opcoes.find((o) => o.disponivel)
  expect(opcao, 'esperava ao menos um serviço disponível na cotação').toBeTruthy()

  const respostaCadastro = await request.post('/api/auth/cadastro', {
    data: {
      nome: 'Cliente Rastrear E2E',
      documento: cpfValido(),
      email: emailUnico('rastrear'),
      senha: 'senha-de-teste-123',
    },
  })
  expect(respostaCadastro.ok(), await respostaCadastro.text()).toBe(true)

  const contextoAdmin = await browser.newContext()
  const paginaAdmin = await contextoAdmin.newPage()
  await paginaAdmin.goto('/login')
  await paginaAdmin.getByLabel('E-mail').fill('admin@frete.teste')
  await paginaAdmin.getByLabel('Senha').fill('AdminTeste123!')
  await paginaAdmin.getByRole('button', { name: 'Entrar' }).click()
  await expect(paginaAdmin).toHaveURL('/')

  const recarga = await request.post('/api/carteira/recarga', { data: { valorCentavos: 20000 } })
  expect(recarga.ok(), await recarga.text()).toBe(true)
  const { recarga: dadosRecarga } = (await recarga.json()) as { recarga: { paymentIntentId: string } }
  const confirmacao = await paginaAdmin.request.post('/api/carteira/confirmar', {
    data: { paymentIntentId: dadosRecarga.paymentIntentId },
  })
  expect(confirmacao.status(), await confirmacao.text()).toBe(204)
  await contextoAdmin.close()

  const nomeDestinatario = 'Fulano Destinatário Rastrear E2E'
  const logradouroDestinatario = 'Avenida Rio Branco Exclusiva Rastrear'

  const respostaEnvio = await request.post('/api/envios', {
    data: {
      quoteId,
      servicoId: opcao!.servicoId,
      remetente: enderecoBase(CEP_ORIGEM, 'São Paulo', 'SP', 'Praça da Sé', 'Remetente Rastrear E2E'),
      destinatario: enderecoBase(CEP_DESTINO, 'Rio de Janeiro', 'RJ', logradouroDestinatario, nomeDestinatario),
      produtos: [{ nome: 'Produto teste', quantidade: 1, valorUnitarioCentavos: 4990 }],
    },
  })
  expect(respostaEnvio.status(), await respostaEnvio.text()).toBe(201)

  const meusEnvios = await request.get('/api/envios/meus')
  const { envios } = (await meusEnvios.json()) as { envios: { codigoRastreio: string | null }[] }
  const codigoRastreio = envios.find((e) => e.codigoRastreio)?.codigoRastreio
  expect(codigoRastreio).toBeTruthy()

  return { codigoRastreio: codigoRastreio!, nomeDestinatario, logradouroDestinatario }
}

test.describe('página pública /rastrear', () => {
  let codigoRastreio: string
  let nomeDestinatario: string
  let logradouroDestinatario: string

  test.beforeAll(async ({ request, browser }) => {
    const envio = await criarEnvioReal(request, browser)
    codigoRastreio = envio.codigoRastreio
    nomeDestinatario = envio.nomeDestinatario
    logradouroDestinatario = envio.logradouroDestinatario
  })

  test('não exige login: acessível sem cookie de sessão', async ({ browser }) => {
    const contexto = await browser.newContext()
    const pagina = await contexto.newPage()
    await pagina.goto('/rastrear')
    await expect(pagina.getByRole('heading', { name: 'Rastrear pedido' })).toBeVisible()
    await contexto.close()
  })

  test('código válido navega para a timeline do envio', async ({ page }) => {
    await page.goto('/rastrear')
    await page.getByLabel('Código de rastreio').fill(codigoRastreio)
    await page.getByRole('button', { name: 'Rastrear pedido' }).click()

    await expect(page).toHaveURL(`/r/${codigoRastreio}`)
    await expect(page.getByText(codigoRastreio)).toBeVisible()
  })

  test('código com espaços em volta e em minúsculas funciona igual', async ({ page }) => {
    await page.goto('/rastrear')
    const codigoSujo = `  ${codigoRastreio.toLowerCase()}  `
    await page.getByLabel('Código de rastreio').fill(codigoSujo)
    await page.getByRole('button', { name: 'Rastrear pedido' }).click()

    await expect(page).toHaveURL(`/r/${codigoRastreio}`)
    await expect(page.getByText(codigoRastreio)).toBeVisible()
  })

  test('código inexistente mostra mensagem amigável, sem jargão técnico', async ({ page }) => {
    await page.goto('/rastrear')
    // Código bem formado (dígito verificador módulo 11 correto), mas que
    // nenhum envio real usa — precisa passar pela validação de formato e
    // só então voltar "não encontrado" do servidor.
    await page.getByLabel('Código de rastreio').fill('FR999999995BR')
    await page.getByRole('button', { name: 'Rastrear pedido' }).click()

    const mensagem = page.locator('#erro-rastrear')
    await expect(mensagem).toBeVisible()
    const texto = (await mensagem.textContent()) ?? ''
    expect(texto.toLowerCase()).not.toContain('404')
    expect(texto.toLowerCase()).not.toContain('erro')
    expect(texto).toContain('Não encontramos')
    await expect(page).toHaveURL('/rastrear')
  })

  test('nenhum nome ou logradouro do destinatário aparece na página, mesmo com envio real', async ({
    page,
  }) => {
    await page.goto(`/r/${codigoRastreio}`)
    await expect(page.getByText(codigoRastreio)).toBeVisible()

    const corpo = (await page.locator('body').textContent()) ?? ''
    expect(corpo).not.toContain(nomeDestinatario)
    expect(corpo).not.toContain(logradouroDestinatario)
  })
})

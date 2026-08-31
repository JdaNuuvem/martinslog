import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Jornada completa do cliente, ponta a ponta: cotar sem login, cadastrar
 * (provando que a MESMA cotação sobrevive — a mesma `Quote` anônima passa a
 * pertencer ao usuário recém-criado), recarregar saldo (confirmado por um
 * admin em sessão separada), criar e pagar um envio com os mesmos CEPs da
 * cotação, avançar o rastreio via simulação administrativa até a entrega, e
 * por fim ver a página pública de rastreio sem PII do destinatário.
 *
 * Sem `waitForTimeout` nem relógio real: o avanço do rastreio usa
 * `POST /api/admin/envios/{id}/simulacao` até a API devolver 422 (sem mais
 * evento pendente) — essa é a condição de parada, não uma contagem fixa.
 */

const CEP_ORIGEM = '01001-000'
const CEP_DESTINO = '20040-002'

const ADMIN_EMAIL = 'admin@frete.teste'
const ADMIN_SENHA = 'AdminTeste123!'
const SENHA_CLIENTE = 'senha-de-teste-123'

type OpcaoCotacao = {
  servicoId: string
  disponivel: boolean
  precoBalcaoCentavos: number
  precoFinalCentavos: number
}

type RespostaCotacao = { quoteId: string; opcoes: OpcaoCotacao[] }

/** Gera um CPF matematicamente válido (dígitos verificadores corretos). */
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

function precoEmCentavos(texto: string): number {
  return Math.round(Number(texto.replace(/[^\d,]/g, '').replace(',', '.')) * 100)
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

const PRODUTOS_DECLARADOS = [
  { nome: 'Camiseta estampada', quantidade: 2, valorUnitarioCentavos: 4990 },
  { nome: 'Boné', quantidade: 1, valorUnitarioCentavos: 3990 },
]

/** Confirma o pagamento de um `PaymentIntent` via sessão de admin dedicada. */
async function confirmarPagamento(admin: APIRequestContext, paymentIntentId: string): Promise<void> {
  const resposta = await admin.post('/api/carteira/confirmar', { data: { paymentIntentId } })
  expect(resposta.status(), await resposta.text()).toBe(204)
}

/** Recarrega e confirma saldo para o `cliente` autenticado, via caminho administrativo. */
async function recarregarSaldo(
  cliente: APIRequestContext,
  admin: APIRequestContext,
  valorCentavos: number,
): Promise<void> {
  const recarga = await cliente.post('/api/carteira/recarga', { data: { valorCentavos } })
  expect(recarga.ok(), await recarga.text()).toBe(true)
  const { recarga: dados } = (await recarga.json()) as { recarga: { paymentIntentId: string } }
  await confirmarPagamento(admin, dados.paymentIntentId)
}

/** Loga como admin numa página/contexto de browser dedicado. */
async function logarComoAdmin(paginaAdmin: Page): Promise<void> {
  await paginaAdmin.goto('/login')
  await paginaAdmin.getByLabel('E-mail').fill(ADMIN_EMAIL)
  await paginaAdmin.getByLabel('Senha').fill(ADMIN_SENHA)
  await paginaAdmin.getByRole('button', { name: 'Entrar' }).click()
  await expect(paginaAdmin).toHaveURL('/')
}

/**
 * Avança a simulação de um envio até não haver mais evento pendente (422).
 * Devolve quantas iterações tiveram sucesso (200).
 */
async function avancarSimulacaoAteEsgotar(admin: APIRequestContext, shipmentId: string): Promise<number> {
  const LIMITE_ITERACOES = 30
  let iteracoes = 0
  let resposta = await admin.post(`/api/admin/envios/${shipmentId}/simulacao`, {
    data: { acao: 'FORCAR_EVENTO' },
  })
  while (resposta.status() === 200 && iteracoes < LIMITE_ITERACOES) {
    iteracoes += 1
    resposta = await admin.post(`/api/admin/envios/${shipmentId}/simulacao`, {
      data: { acao: 'FORCAR_EVENTO' },
    })
  }
  expect(resposta.status(), await resposta.text()).toBe(422)
  return iteracoes
}

/**
 * Cria uma cotação (mesmos CEPs/dimensões do roteiro), cadastra um cliente
 * novo no MESMO contexto de requisição (a `Quote` anônima migra para o
 * usuário no cadastro) e recarrega o saldo dele via admin. Devolve tudo que
 * os testes de rastreio precisam para criar e pagar um envio.
 */
async function prepararClienteComCotacaoESaldo(
  clienteRequest: APIRequestContext,
  adminRequest: APIRequestContext,
  prefixoEmail: string,
): Promise<{ quoteId: string; opcao: OpcaoCotacao }> {
  const respostaCotacao = await clienteRequest.post('/api/cotacao', {
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
  const corpoCotacao = (await respostaCotacao.json()) as RespostaCotacao
  const opcao = corpoCotacao.opcoes.find((o) => o.disponivel)
  expect(opcao, 'esperava ao menos um serviço disponível na cotação').toBeTruthy()

  const respostaCadastro = await clienteRequest.post('/api/auth/cadastro', {
    data: {
      nome: 'Cliente E2E',
      documento: cpfValido(),
      email: emailUnico(prefixoEmail),
      senha: SENHA_CLIENTE,
    },
  })
  expect(respostaCadastro.ok(), await respostaCadastro.text()).toBe(true)

  await recarregarSaldo(clienteRequest, adminRequest, 20000)

  return { quoteId: corpoCotacao.quoteId, opcao: opcao! }
}

async function criarEEmitirEnvio(
  clienteRequest: APIRequestContext,
  quoteId: string,
  servicoId: string,
): Promise<string> {
  const resposta = await clienteRequest.post('/api/envios', {
    data: {
      quoteId,
      servicoId,
      remetente: enderecoBase(CEP_ORIGEM, 'São Paulo', 'SP', 'Praça da Sé', 'Remetente E2E'),
      destinatario: enderecoBase(CEP_DESTINO, 'Rio de Janeiro', 'RJ', 'Avenida Rio Branco', 'Destinatário E2E'),
      produtos: PRODUTOS_DECLARADOS,
    },
  })
  expect(resposta.status(), await resposta.text()).toBe(201)
  const { id } = (await resposta.json()) as { id: string }
  return id
}

test('jornada completa: cotar, cadastrar, recarregar, enviar, pagar e rastrear', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)

  // 1. Cotar sem login -----------------------------------------------------
  await page.goto('/')

  await page.getByLabel('CEP de origem').fill(CEP_ORIGEM)
  await page.getByLabel('CEP de destino').fill(CEP_DESTINO)
  await page.getByLabel('Peso').selectOption('300')
  await page.getByLabel('Altura (cm)').fill('4')
  await page.getByLabel('Largura (cm)').fill('12')
  await page.getByLabel('Comprimento (cm)').fill('18')

  const respostaCotacaoPromise = page.waitForResponse(
    (resposta) => resposta.url().includes('/api/cotacao') && resposta.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Calcular frete com desconto' }).click()
  const respostaCotacao = await respostaCotacaoPromise
  const corpoCotacao = (await respostaCotacao.json()) as RespostaCotacao

  const opcoesNaTela = page.getByTestId('opcao-frete')
  await expect(opcoesNaTela.first()).toBeVisible()

  // Confirma visualmente que ao menos uma opção custa menos que o balcão...
  let encontrouDescontoNaTela = false
  const quantidadeOpcoes = await opcoesNaTela.count()
  for (let i = 0; i < quantidadeOpcoes; i += 1) {
    const opcao = opcoesNaTela.nth(i)
    if ((await opcao.getAttribute('data-disponivel')) !== 'true') continue

    const precoBalcaoTexto = await opcao.locator('span.line-through').textContent()
    const precoFinalTexto = await opcao.locator('span.text-brand-texto').last().textContent()
    if (!precoBalcaoTexto || !precoFinalTexto) continue

    if (precoEmCentavos(precoFinalTexto) < precoEmCentavos(precoBalcaoTexto)) {
      encontrouDescontoNaTela = true
      break
    }
  }
  expect(encontrouDescontoNaTela, 'esperava ao menos uma opção com preço final menor que o de balcão').toBe(true)

  // ...e usa a mesma informação, vinda da API, como fonte de verdade para o
  // serviço que será comprado adiante — sem reanalisar o DOM.
  const quoteId = corpoCotacao.quoteId
  const opcaoComDesconto = corpoCotacao.opcoes.find(
    (o) => o.disponivel && o.precoFinalCentavos < o.precoBalcaoCentavos,
  )
  expect(opcaoComDesconto, 'esperava opção com desconto também na resposta da API').toBeTruthy()
  const servicoId = opcaoComDesconto!.servicoId

  // 2. Cadastrar — e provar que a cotação sobrevive ao cadastro -----------
  const email = emailUnico('jornada')
  const documento = cpfValido()

  await page.goto('/cadastro')
  await page.getByLabel('Nome completo').fill('Cliente da Jornada E2E')
  await page.getByLabel('CPF ou CNPJ').fill(documento)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(SENHA_CLIENTE)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()

  // Prova direta: a MESMA cotação feita como visitante, sem nenhuma nova
  // cotação, já responde 200 na prévia de preço do envio autenticado — só é
  // possível porque `POST /api/auth/cadastro` migrou `Quote.userId` de
  // `null` para o usuário recém-criado dentro da mesma transação.
  const previa = await page.request.get(
    `/api/envios?quoteId=${encodeURIComponent(quoteId)}&servicoId=${encodeURIComponent(servicoId)}`,
  )
  expect(previa.ok(), await previa.text()).toBe(true)

  // 3. Recarregar saldo — confirmação é ação administrativa ---------------
  const saldoAntes = await page.request.get('/api/carteira')
  expect(saldoAntes.ok(), await saldoAntes.text()).toBe(true)
  const { saldoCentavos: saldoInicial } = (await saldoAntes.json()) as { saldoCentavos: number }
  expect(saldoInicial).toBe(0)

  const VALOR_RECARGA_CENTAVOS = 20000

  const contextoAdmin = await browser.newContext()
  const paginaAdmin = await contextoAdmin.newPage()
  await logarComoAdmin(paginaAdmin)

  await recarregarSaldo(page.request, paginaAdmin.request, VALOR_RECARGA_CENTAVOS)

  const saldoDepois = await page.request.get('/api/carteira')
  const { saldoCentavos: saldoAposRecarga } = (await saldoDepois.json()) as { saldoCentavos: number }
  expect(saldoAposRecarga).toBe(saldoInicial + VALOR_RECARGA_CENTAVOS)

  // 4. Criar envio — mesmos CEPs da cotação, com produtos declarados ------
  const respostaEnvio = await page.request.post('/api/envios', {
    data: {
      quoteId,
      servicoId,
      remetente: enderecoBase(CEP_ORIGEM, 'São Paulo', 'SP', 'Praça da Sé', 'Remetente da Jornada E2E'),
      destinatario: enderecoBase(
        CEP_DESTINO,
        'Rio de Janeiro',
        'RJ',
        'Avenida Rio Branco',
        'Destinatário da Jornada E2E',
      ),
      produtos: PRODUTOS_DECLARADOS,
    },
  })
  expect(respostaEnvio.status(), await respostaEnvio.text()).toBe(201)
  const { id: shipmentId } = (await respostaEnvio.json()) as { id: string }

  // 5. Pagar — saldo debitado, GENERATED, código de rastreio, timeline ----
  const saldoAposEnvio = await page.request.get('/api/carteira')
  const { saldoCentavos: saldoFinal } = (await saldoAposEnvio.json()) as { saldoCentavos: number }
  expect(saldoFinal).toBe(saldoAposRecarga - opcaoComDesconto!.precoFinalCentavos)

  const meusEnvios = await page.request.get('/api/envios/meus')
  expect(meusEnvios.ok(), await meusEnvios.text()).toBe(true)
  const { envios } = (await meusEnvios.json()) as {
    envios: { id: string; status: string; codigoRastreio: string | null }[]
  }
  const envioCriado = envios.find((e) => e.id === shipmentId)
  expect(envioCriado, 'envio recém-criado não apareceu em /api/envios/meus').toBeTruthy()
  expect(envioCriado!.status).toBe('GENERATED')
  expect(envioCriado!.codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)

  const codigoRastreio = envioCriado!.codigoRastreio!

  const rastreioLogoAposEmissao = await page.request.get(`/api/rastreio/${codigoRastreio}`)
  expect(rastreioLogoAposEmissao.ok(), await rastreioLogoAposEmissao.text()).toBe(true)
  const { rastreio: rastreioInicial } = (await rastreioLogoAposEmissao.json()) as {
    rastreio: { eventos: unknown[] }
  }
  expect(rastreioInicial.eventos).toHaveLength(1)

  // 6. Avançar o rastreio até a entrega — sem espera nem relógio ----------
  const iteracoes = await avancarSimulacaoAteEsgotar(paginaAdmin.request, shipmentId)
  expect(iteracoes, 'esperava mais de um evento forçado antes de esgotar a simulação').toBeGreaterThan(1)

  const rastreioFinal = await page.request.get(`/api/rastreio/${codigoRastreio}`)
  const { rastreio: rastreioAposSimulacao } = (await rastreioFinal.json()) as {
    rastreio: { status: string; eventos: unknown[] }
  }
  expect(rastreioAposSimulacao.status).toBe('DELIVERED')
  expect(rastreioAposSimulacao.eventos.length).toBeGreaterThan(1)

  // 7. Página pública `/r/[codigo]` — sem login, sem PII do destinatário --
  const paginaPublica = await browser.newPage()
  await paginaPublica.goto(`/r/${codigoRastreio}`)

  // O texto aparece duas vezes (faixa superior + último item da timeline);
  // `.first()` escopa à faixa, que é o que importa aqui.
  await expect(paginaPublica.getByText('Objeto entregue ao destinatário').first()).toBeVisible()

  const conteudoHtml = await paginaPublica.content()
  expect(conteudoHtml).not.toContain('Destinatário da Jornada E2E')
  expect(conteudoHtml).not.toContain('Avenida Rio Branco')

  const jsonPublico = await (await paginaPublica.request.get(`/api/rastreio/${codigoRastreio}`)).text()
  expect(jsonPublico).not.toContain('Destinatário da Jornada E2E')
  expect(jsonPublico).not.toContain('Avenida Rio Branco')

  await paginaPublica.close()
  await paginaAdmin.close()
  await contextoAdmin.close()
})

test('página pública logo após a emissão: um único evento, faixa de aguardando postagem', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(60_000)

  const contextoAdmin = await browser.newContext()
  const paginaAdmin = await contextoAdmin.newPage()
  await logarComoAdmin(paginaAdmin)

  const { quoteId, opcao } = await prepararClienteComCotacaoESaldo(request, paginaAdmin.request, 'emissao')
  const shipmentId = await criarEEmitirEnvio(request, quoteId, opcao.servicoId)

  const meusEnvios = await request.get('/api/envios/meus')
  const { envios } = (await meusEnvios.json()) as {
    envios: { id: string; codigoRastreio: string | null; status: string }[]
  }
  const envio = envios.find((e) => e.id === shipmentId)!
  expect(envio.status).toBe('GENERATED')
  const codigo = envio.codigoRastreio!

  await page.goto(`/r/${codigo}`)

  // O texto aparece na faixa superior e no único item da timeline; `.first()`
  // escopa à faixa.
  await expect(page.getByText('Aguardando postagem pelo remetente').first()).toBeVisible()
  // O resumo em três colunas usa `<dt>`; "Código de rastreio" também rotula
  // o campo de busca do formulário, daí escopar por `role="term"`.
  await expect(page.getByRole('term').filter({ hasText: 'Serviço' })).toBeVisible()
  await expect(page.getByRole('term').filter({ hasText: 'Código de rastreio' })).toBeVisible()
  await expect(page.getByRole('term').filter({ hasText: 'Prazo' })).toBeVisible()

  const itensTimeline = page.locator('ol > li')
  await expect(itensTimeline).toHaveCount(1)

  const jsonResposta = (await (await page.request.get(`/api/rastreio/${codigo}`)).json()) as {
    rastreio: { status: string }
  }
  expect(jsonResposta.rastreio.status).toBe('GENERATED')

  await paginaAdmin.close()
  await contextoAdmin.close()
})

test('fator de velocidade acelera a simulação: eventos separados por minutos, não dias', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(60_000)

  const contextoAdmin = await browser.newContext()
  const paginaAdmin = await contextoAdmin.newPage()
  await logarComoAdmin(paginaAdmin)

  const respostaFator = await paginaAdmin.request.post('/api/admin/simulacao', {
    data: { fatorVelocidade: 1440 },
  })
  expect(respostaFator.ok(), await respostaFator.text()).toBe(true)

  const { quoteId, opcao } = await prepararClienteComCotacaoESaldo(request, paginaAdmin.request, 'velocidade')
  const shipmentId = await criarEEmitirEnvio(request, quoteId, opcao.servicoId)

  const meusEnvios = await request.get('/api/envios/meus')
  const { envios } = (await meusEnvios.json()) as {
    envios: { id: string; codigoRastreio: string | null }[]
  }
  const codigo = envios.find((e) => e.id === shipmentId)!.codigoRastreio!

  await avancarSimulacaoAteEsgotar(paginaAdmin.request, shipmentId)

  const jsonRastreio = (await (await page.request.get(`/api/rastreio/${codigo}`)).json()) as {
    rastreio: { eventos: { ocorridoEm: string }[] }
  }

  const ocorridos = jsonRastreio.rastreio.eventos
    .map((e) => new Date(e.ocorridoEm).getTime())
    .sort((a, b) => a - b)
  const primeiro = ocorridos[0]
  const ultimo = ocorridos[ocorridos.length - 1]
  expect(primeiro).toBeDefined()
  expect(ultimo).toBeDefined()
  const diferencaMinutos = (ultimo! - primeiro!) / 60_000

  // Um prazo de dias corridos, acelerado 1440x (1 dia = 1 minuto), some no
  // fator: a diferença entre o primeiro e o último evento fica na casa dos
  // minutos, nunca de dias inteiros.
  expect(diferencaMinutos).toBeGreaterThan(0)
  expect(diferencaMinutos).toBeLessThan(60 * 24)

  await paginaAdmin.close()
  await contextoAdmin.close()
})

test('extravio: chega a LOST e o saldo do cliente não muda — não há mais estorno', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000)

  const contextoAdmin = await browser.newContext()
  const paginaAdmin = await contextoAdmin.newPage()
  await logarComoAdmin(paginaAdmin)

  const { quoteId, opcao } = await prepararClienteComCotacaoESaldo(request, paginaAdmin.request, 'extravio')
  const shipmentId = await criarEEmitirEnvio(request, quoteId, opcao.servicoId)

  const saldoAposEnvio = await request.get('/api/carteira')
  const { saldoCentavos: saldoLogoAposPagar } = (await saldoAposEnvio.json()) as { saldoCentavos: number }

  const trocaCenario = await paginaAdmin.request.post(`/api/admin/envios/${shipmentId}/simulacao`, {
    data: { acao: 'TROCAR_CENARIO', cenario: 'EXTRAVIO' },
  })
  expect(trocaCenario.ok(), await trocaCenario.text()).toBe(true)

  await avancarSimulacaoAteEsgotar(paginaAdmin.request, shipmentId)

  const meusEnvios = await request.get('/api/envios/meus')
  const { envios } = (await meusEnvios.json()) as {
    envios: { id: string; codigoRastreio: string | null }[]
  }
  const codigo = envios.find((e) => e.id === shipmentId)!.codigoRastreio!

  const rastreio = (await (await request.get(`/api/rastreio/${codigo}`)).json()) as {
    rastreio: { status: string }
  }
  expect(rastreio.rastreio.status).toBe('LOST')

  // Regra de produto: nenhum caminho além da recarga confirmada por admin
  // credita a carteira. Extravio não devolve nada — o saldo depois do
  // extravio é exatamente o mesmo de logo após o pagamento do envio.
  const saldoAposExtravio = await request.get('/api/carteira')
  const { saldoCentavos: saldoFinal } = (await saldoAposExtravio.json()) as { saldoCentavos: number }
  expect(saldoFinal).toBe(saldoLogoAposPagar)

  await paginaAdmin.close()
  await contextoAdmin.close()
})

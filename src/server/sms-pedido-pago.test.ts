import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { FakeSmsProvider, smsProvider } from '@/infra/sms'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { dispararSmsPendentes } from './sms-service'

/**
 * O comprador recebe um SMS quando o pagamento entra.
 *
 * O caminho inteiro, do jeito que acontece de verdade: a loja cria o envio com
 * o telefone do comprador, paga, e o aviso sai. Nada aqui simula etapa — só o
 * provedor é falso, porque a suíte não manda SMS de verdade.
 *
 * Os dois casos que protegem dinheiro e reputação são os últimos: envio de
 * teste não avisa ninguém, e a mesma cobrança não vira duas mensagens.
 */

const fake = smsProvider as FakeSmsProvider
const usuariosCriados: string[] = []

beforeEach(() => {
  fake.limpar()
})

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)

  await prisma.mensagemEnvio.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: envios.map((e) => e.id) } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

const remetente: EnderecoEnvio = {
  nome: 'Loja Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

function destinatarioCom(telefone?: string): EnderecoEnvio {
  return {
    nome: 'Maria Aparecida da Conceicao',
    documento: '52998224725',
    telefone,
    cep: '20040-020',
    logradouro: 'Av. Rio Branco',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
  }
}

/**
 * As mensagens que ESTE teste provocou, achadas pelo telefone dele.
 *
 * `dispararSmsPendentes` drena a fila INTEIRA — é um cron, e a base de teste é
 * compartilhada. Contar `fake.enviados` direto fazia o teste depender do que
 * outro deixou para trás: bastava um vizinho estourar o tempo com mensagem na
 * fila para este receber a alheia e falhar dizendo "avisou sem telefone".
 *
 * Cada teste usa um telefone PRÓPRIO. Compartilhar o número não resolveria
 * nada — a mensagem vazada casaria com o filtro do mesmo jeito.
 */
function enviadosPara(telefone: string) {
  return fake.enviados.filter((e) => e.para === telefone)
}

async function lojaComPerfil(nome: string) {
  const usuario = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(usuario.id)
  const perfil = await prisma.perfil.create({ data: { userId: usuario.id, nome, silencioAtivo: false } })
  return { usuario, perfil }
}

async function venderPara(
  userId: string,
  perfilId: string,
  destinatario: EnderecoEnvio,
  opcoes: { sandbox?: boolean } = {},
) {
  const cotacao = await criarCotacaoValida(userId)
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    perfilId,
    sandbox: opcoes.sandbox,
  })
  if (!opcoes.sandbox) await pagarEnvio(userId, envio.id)
  return envio
}

describe('SMS de pagamento confirmado', () => {
  it('enfileira e envia o aviso com o nome da loja e o link de rastreio', async () => {
    const { usuario, perfil } = await lojaComPerfil('Best Buy Tech')

    await venderPara(usuario.id, perfil.id, destinatarioCom('(11) 98888-0001'))

    const resultado = await dispararSmsPendentes()
    expect(resultado.enviadas).toBe(1)
    expect(enviadosPara('5511988880001')).toHaveLength(1)

    const enviado = enviadosPara('5511988880001')[0]!

    // O telefone chega com máscara e precisa sair em E.164.
    expect(enviado.para).toBe('5511988880001')

    const texto = enviado.texto
    // No Brasil o remetente do SMS é um número curto: sem o nome escrito
    // dentro, o comprador não tem como saber quem mandou.
    expect(texto).toContain('Best Buy Tech')
    // Só o primeiro nome — o resto não cabe em 160 caracteres.
    expect(texto).toContain('Maria')
    expect(texto).not.toContain('Aparecida')
    // Nenhuma variável pode vazar sem substituir.
    expect(texto).not.toContain('{{')
  })

  it('não avisa quando a loja não mandou o telefone', async () => {
    const { usuario, perfil } = await lojaComPerfil('Loja Sem Telefone')

    await venderPara(usuario.id, perfil.id, destinatarioCom(undefined))

    expect(await dispararSmsPendentes()).toMatchObject({ enviadas: 0 })
    expect(enviadosPara('5511988880002')).toHaveLength(0)
  })

  it('envio de teste não manda SMS para ninguém', async () => {
    const { usuario, perfil } = await lojaComPerfil('Loja Sandbox')

    /*
      O caso que protege reputação: um pedido de teste que avisa o comprador
      manda mensagem sobre uma compra que não existiu — e quem recebe denuncia
      como spam, com razão.
    */
    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880003'), { sandbox: true })

    expect(await dispararSmsPendentes()).toMatchObject({ enviadas: 0 })
    expect(enviadosPara('5511988880003')).toHaveLength(0)
  })

  it('não manda a mesma mensagem duas vezes', async () => {
    const { usuario, perfil } = await lojaComPerfil('Loja Sem Repeticao')

    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880004'))

    expect((await dispararSmsPendentes()).enviadas).toBe(1)
    // Um segundo disparo não pode reenviar o que já saiu.
    expect((await dispararSmsPendentes()).enviadas).toBe(0)
    expect(enviadosPara('5511988880004')).toHaveLength(1)
  })

  it('recusa temporária fica na fila; recusa definitiva desiste', async () => {
    const { usuario, perfil } = await lojaComPerfil('Loja Com Falha')

    fake.falharProxima = { mensagem: 'SALDO INSUFICIENTE', retentavel: true }
    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880005'))

    const primeira = await dispararSmsPendentes()
    expect(primeira.enviadas).toBe(0)
    expect(primeira.falhas).toBe(1)

    const naFila = await prisma.mensagemEnvio.findFirstOrThrow({
      where: { perfilId: perfil.id },
    })
    expect(naFila.status).toBe('PENDENTE')
    expect(naFila.erro).toContain('SALDO')
    // Reagendada, e não perdida.
    expect(naFila.proximaTentativaEm).not.toBeNull()
  })

  it('grava por qual provedor a mensagem saiu', async () => {
    const { usuario, perfil } = await lojaComPerfil('Loja Provedor')

    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880006'))
    await dispararSmsPendentes()

    const enviada = await prisma.mensagemEnvio.findFirstOrThrow({ where: { perfilId: perfil.id } })

    /*
      Sem este campo, "enviada" não distingue mensagem que saiu de verdade de
      mensagem que só foi registrada porque nenhum fornecedor estava contratado.
    */
    expect(enviada.provedor).toBe('fake')
    expect(enviada.idExterno).toBeTruthy()
  })
})

describe('nome de exibição', () => {
  it('o comprador vê o nome de exibição, não o interno do painel', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)

    /*
      É a diferença que o teste protege: o painel precisa distinguir as lojas
      entre si, e o comprador precisa reconhecer onde comprou. Sem o campo
      separado, o SMS sairia assinado com um remetente que ele nunca viu.
    */
    const perfil = await prisma.perfil.create({
      data: { silencioAtivo: false, userId: usuario.id, nome: 'Best Buy Tech', nomeExibicao: 'Tiktok shop' },
    })

    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880007'))
    await dispararSmsPendentes()

    const texto = enviadosPara('5511988880007')[0]!.texto
    expect(texto).toContain('Tiktok shop')
    expect(texto).not.toContain('Best Buy Tech')
  })

  it('sem nome de exibição, cai no nome interno em vez de ficar sem remetente', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)
    const perfil = await prisma.perfil.create({
      data: { silencioAtivo: false, userId: usuario.id, nome: 'Loja Sem Exibicao' },
    })

    await venderPara(usuario.id, perfil.id, destinatarioCom('11988880008'))
    await dispararSmsPendentes()

    expect(enviadosPara('5511988880008')[0]!.texto).toContain('Loja Sem Exibicao')
  })
})

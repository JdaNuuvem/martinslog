import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { responder } from './robo-atendimento'

/**
 * O robô de atendimento, caminho por caminho.
 *
 * O que se protege aqui é o silêncio: um robô que responde o que não sabe
 * inventa prazo e promete o que a loja não cumpre. Cada caso abaixo existe
 * para garantir que ele responde com dado real ou passa para um humano —
 * nunca um terceiro caminho.
 */

const usuariosCriados: string[] = []

async function lojaComEnvio(opcoes: {
  telefone: string
  status?: 'GENERATED' | 'POSTED' | 'DELIVERED'
  rastreio?: string
}) {
  const user = await criarUsuarioComSaldo(10_000)
  const userId = user.id
  usuariosCriados.push(userId)

  const perfil = await prisma.perfil.create({
    data: { userId, nome: `loja-robo-${Date.now()}-${Math.random()}` },
  })

  const service = await prisma.service.findFirstOrThrow()

  if (opcoes.rastreio) {
    await prisma.shipment.create({
      data: {
        userId,
        perfilId: perfil.id,
        serviceId: service.id,
        codigoRastreio: opcoes.rastreio,
        status: opcoes.status ?? 'POSTED',
        referenciaExterna: 'PED-123',
        remetente: { nome: 'Loja', cep: '01310100' },
        destinatario: { nome: 'Comprador', telefone: opcoes.telefone, cep: '09280000' },
        produtos: [],
        opcionais: {},
        valorDeclaradoCentavos: 1000,
        precoBalcaoCentavos: 0,
        precoCobradoCentavos: 100,
        descontoCentavos: 0,
      },
    })
  }

  return perfil.id
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  await prisma.respostaAutomatica.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.shipment.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfilIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('robô de atendimento', () => {
  it('responde com o rastreio real quando o comprador pergunta pelo pedido', async () => {
    const telefone = '5511988887777'
    const perfilId = await lojaComEnvio({ telefone, rastreio: 'EC000999001BR', status: 'POSTED' })

    const resposta = await responder({
      perfilId,
      contato: telefone,
      texto: 'oi, cadê meu pedido?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.tipo).toBe('responder')
    expect(resposta.texto).toContain('EC000999001BR')
    expect(resposta.texto).toContain('a caminho')
  })

  it('explica o status em português, não em código do sistema', async () => {
    const telefone = '5511977776666'
    const perfilId = await lojaComEnvio({ telefone, rastreio: 'EC000999002BR', status: 'DELIVERED' })

    const resposta = await responder({
      perfilId,
      contato: telefone,
      texto: 'já chegou?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.texto).toContain('entregue')
    expect(resposta.texto).not.toContain('DELIVERED')
  })

  /**
   * O caso que evita a mentira mais cara: dizer "você não tem pedido" para
   * quem comprou com outro telefone.
   */
  it('chama um humano quando não acha envio, em vez de negar que exista', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900000000' })

    const resposta = await responder({
      perfilId,
      contato: '5511911112222',
      texto: 'cadê minha encomenda?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia chamar humano')
    expect(resposta.tipo).toBe('chamar-humano')
    expect(resposta.texto).not.toMatch(/não (existe|há) (nenhum )?pedido/i)
  })

  it('chama um humano quando o comprador pede atendente', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900000001' })

    const resposta = await responder({
      perfilId,
      contato: '5511900000001',
      texto: 'quero falar com um atendente',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia chamar humano')
    expect(resposta.tipo).toBe('chamar-humano')
  })

  it('chama um humano diante de pergunta que não sabe responder', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900000002' })

    const resposta = await responder({
      perfilId,
      contato: '5511900000002',
      texto: 'vocês fazem nota fiscal com CNPJ de outro estado?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia chamar humano')
    expect(resposta.tipo).toBe('chamar-humano')
  })

  it('acha o envio mesmo com o telefone gravado em outro formato', async () => {
    // A loja cadastrou sem o 55; o WhatsApp entrega com.
    const perfilId = await lojaComEnvio({ telefone: '11955554444', rastreio: 'EC000999003BR' })

    const resposta = await responder({
      perfilId,
      contato: '5511955554444',
      texto: 'rastreio por favor',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.tipo).toBe('responder')
    expect(resposta.texto).toContain('EC000999003BR')
  })

  it('cumprimenta sem prometer nada que não sabe fazer', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900000003' })

    const resposta = await responder({
      perfilId,
      contato: '5511900000003',
      texto: 'bom dia',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.tipo).toBe('responder')
    expect(resposta.texto).toContain('Loja Teste')
  })
})

describe('respostas escritas pela loja', () => {
  async function comResposta(
    perfilId: string,
    dados: { nome: string; gatilhos: string[]; resposta: string; ordem?: number },
  ) {
    await prisma.respostaAutomatica.create({
      data: {
        perfilId,
        nome: dados.nome,
        gatilhos: dados.gatilhos,
        resposta: dados.resposta,
        ordem: dados.ordem ?? 0,
      },
    })
  }

  it('usa a resposta da loja e troca a variável da marca', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900001000' })
    await comResposta(perfilId, {
      nome: 'Sábado',
      gatilhos: ['sabado'],
      resposta: 'A {{loja}} entrega de segunda a sexta.',
    })

    const resposta = await responder({
      perfilId,
      contato: '5511900001000',
      texto: 'vocês entregam no SÁBADO?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.texto).toBe('A Loja Teste entrega de segunda a sexta.')
  })

  /**
   * A regra da loja tem que ganhar da embutida. Se a de fábrica respondesse
   * primeiro, o campo na tela seria decoração: a loja escreveria a própria
   * resposta para "prazo" e continuaria vendo a genérica.
   */
  it('a resposta da loja vence a regra de fábrica sobre rastreio', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900001001', rastreio: 'EC000999900BR' })
    await comResposta(perfilId, {
      nome: 'Prazo',
      gatilhos: ['prazo'],
      resposta: 'Nosso prazo é de 5 a 8 dias úteis.',
    })

    const resposta = await responder({
      perfilId,
      contato: '5511900001001',
      texto: 'qual o prazo?',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.texto).toContain('5 a 8 dias')
    expect(resposta.texto).not.toContain('EC000999900BR')
  })

  it('quando duas regras pegam a frase, a de menor ordem responde', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900001002' })
    await comResposta(perfilId, {
      nome: 'Genérica',
      gatilhos: ['troca'],
      resposta: 'Resposta genérica.',
      ordem: 10,
    })
    await comResposta(perfilId, {
      nome: 'Específica',
      gatilhos: ['troca de tamanho'],
      resposta: 'Resposta específica.',
      ordem: 1,
    })

    const resposta = await responder({
      perfilId,
      contato: '5511900001002',
      texto: 'quero troca de tamanho',
      nomeLoja: 'Loja Teste',
    })

    if (resposta.tipo === 'calar') throw new Error('robô calou quando devia responder')
    expect(resposta.texto).toBe('Resposta específica.')
  })

  it('ignora regra desligada', async () => {
    const perfilId = await lojaComEnvio({ telefone: '5511900001003' })
    await prisma.respostaAutomatica.create({
      data: {
        perfilId,
        nome: 'Desligada',
        gatilhos: ['cupom'],
        resposta: 'Não deveria sair.',
        ativo: false,
      },
    })

    const resposta = await responder({
      perfilId,
      contato: '5511900001003',
      texto: 'tem cupom?',
      nomeLoja: 'Loja Teste',
    })

    expect(resposta.tipo).toBe('chamar-humano')
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { compor } from '@/domain/mensagem/texto'
import { montarValores } from './valores-da-mensagem'

/**
 * Os valores que entram nas mensagens do comprador.
 *
 * O que se protege aqui é a mensagem chegar inteira. Variável que não
 * preenche vira buraco no texto — "seu pedido  foi postado" — e ninguém
 * descobre até um comprador receber assim.
 */

const usuariosCriados: string[] = []

async function envioDeTeste(opcoes: {
  rastreio?: string
  status?: 'GENERATED' | 'POSTED' | 'DELIVERED'
  referencia?: string | null
  produtos?: { nome: string; quantidade: number; valorUnitarioCentavos: number }[]
}) {
  const user = await criarUsuarioComSaldo(10_000)
  usuariosCriados.push(user.id)

  const perfil = await prisma.perfil.create({
    data: {
      userId: user.id,
      nome: `loja-valores-${Date.now()}-${Math.random()}`,
      nomeExibicao: 'Marca Bonita',
    },
  })
  const service = await prisma.service.findFirstOrThrow()

  const envio = await prisma.shipment.create({
    data: {
      userId: user.id,
      perfilId: perfil.id,
      serviceId: service.id,
      codigoRastreio: opcoes.rastreio ?? null,
      status: opcoes.status ?? 'POSTED',
      referenciaExterna: opcoes.referencia ?? null,
      remetente: { nome: 'Loja', cep: '01310100' },
      destinatario: {
        nome: 'Maria Aparecida da Silva',
        telefone: '5511999998888',
        cep: '13010000',
        cidade: 'Campinas',
        uf: 'SP',
      },
      produtos: opcoes.produtos ?? [],
      opcionais: {},
      valorDeclaradoCentavos: 1000,
      precoBalcaoCentavos: 0,
      precoCobradoCentavos: 100,
      descontoCentavos: 0,
    },
  })

  return { perfil, shipmentId: envio.id }
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfis.map((p) => p.id) } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('valores da mensagem', () => {
  it('preenche pedido, status, cidade e rastreio a partir do envio', async () => {
    const { perfil, shipmentId } = await envioDeTeste({
      rastreio: 'EC000777001BR',
      status: 'POSTED',
      referencia: 'PED-9911',
    })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: null,
    })

    expect(valores.pedido).toBe('PED-9911')
    expect(valores.status).toBe('a caminho')
    expect(valores.cidade).toBe('Campinas')
    expect(valores.uf).toBe('SP')
    expect(valores.codigo_rastreio).toBe('EC000777001BR')
    expect(valores.link_rastreio).toContain('EC000777001BR')
  })

  /** O comprador conhece a marca, não o nome interno do painel. */
  it('usa o nome de exibição da loja, não o interno', async () => {
    const { perfil, shipmentId } = await envioDeTeste({ rastreio: 'EC000777002BR' })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: null,
    })

    expect(valores.loja).toBe('Marca Bonita')
  })

  it('chama a pessoa pelo primeiro nome', async () => {
    const { perfil, shipmentId } = await envioDeTeste({ rastreio: 'EC000777003BR' })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: null,
    })

    expect(valores.cliente).toBe('Maria')
  })

  it('lista os produtos e resume quando são muitos', async () => {
    const { perfil, shipmentId } = await envioDeTeste({
      rastreio: 'EC000777004BR',
      produtos: [
        { nome: 'Tênis branco', quantidade: 1, valorUnitarioCentavos: 100 },
        { nome: 'Meia kit 3', quantidade: 1, valorUnitarioCentavos: 100 },
        { nome: 'Boné preto', quantidade: 1, valorUnitarioCentavos: 100 },
        { nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 100 },
        { nome: 'Short', quantidade: 1, valorUnitarioCentavos: 100 },
      ],
    })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: null,
    })

    expect(valores.produtos).toBe('Tênis branco, Meia kit 3, Boné preto e mais 2')
  })

  /**
   * O caso que motivou o módulo compartilhado: uma variável sem valor não
   * pode deixar buraco nem pontuação solta na frase.
   */
  it('não deixa buraco no texto quando o envio não tem referência', async () => {
    const { perfil, shipmentId } = await envioDeTeste({
      rastreio: 'EC000777005BR',
      referencia: null,
    })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: null,
    })

    const texto = compor('{{loja}}: pedido {{pedido}} postado! {{link_rastreio}}', valores)

    expect(texto).not.toContain('{{pedido}}')
    expect(texto).not.toMatch(/ {2,}/)
  })

  it('o pedido tem prioridade sobre a referência do envio', async () => {
    const { perfil, shipmentId } = await envioDeTeste({
      rastreio: 'EC000777006BR',
      referencia: 'REF-DO-ENVIO',
    })

    const valores = await montarValores({
      perfil: { nome: perfil.nome, nomeExibicao: perfil.nomeExibicao },
      shipmentId,
      pedido: {
        clienteNome: 'João Pedro',
        valorCentavos: 18990,
        checkoutUrl: null,
        externalId: 'PED-DO-PEDIDO',
      },
    })

    expect(valores.pedido).toBe('PED-DO-PEDIDO')
    expect(valores.valor).toContain('189,90')
    expect(valores.cliente).toBe('João')
  })
})

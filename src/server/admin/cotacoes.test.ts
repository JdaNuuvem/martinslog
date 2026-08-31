import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { listarCotacoes } from './cotacoes'

const usuariosCriados: string[] = []
const quotesCriadas: string[] = []
const anonSessionsCriadas: string[] = []

afterAll(async () => {
  await prisma.quote.deleteMany({ where: { id: { in: quotesCriadas } } })
  await prisma.anonSession.deleteMany({ where: { id: { in: anonSessionsCriadas } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function usuario(): Promise<string> {
  const criado = await criarUsuarioComSaldo(0)
  usuariosCriados.push(criado.id)
  return criado.id
}

describe('listarCotacoes', () => {
  it('inclui cotação de usuário autenticado com as opções congeladas', async () => {
    const userId = await usuario()
    const quote = await criarCotacaoValida(userId, {
      precoCentavos: 3200,
      cepOrigem: '01310-100',
      cepDestino: '20040-020',
    })
    quotesCriadas.push(quote.id)

    const lista = await listarCotacoes({ cep: '01310-100' })
    const encontrada = lista.itens.find((item) => item.id === quote.id)

    expect(encontrada).toBeDefined()
    expect(encontrada?.dono).toMatchObject({ tipo: 'USUARIO', id: userId })
    expect(encontrada?.opcoes[0]?.precoFinalCentavos).toBe(3200)
    expect(encontrada?.virouEnvio).toBe(false)
    expect(encontrada?.shipmentId).toBeNull()
  })

  it('inclui cotação anônima (AnonSession), sem exigir usuário logado', async () => {
    const anon = await prisma.anonSession.create({ data: {} })
    anonSessionsCriadas.push(anon.id)

    const quote = await prisma.quote.create({
      data: {
        anonSessionId: anon.id,
        cepOrigem: '01310-100',
        cepDestino: '30130-000',
        formato: 'CAIXA',
        pesoG: 500,
        altura: 5,
        largura: 5,
        comprimento: 5,
        pesoCubadoG: 500,
        pesoTaxavelG: 500,
        opcionais: {},
        opcoes: [
          {
            servicoId: 'eco',
            servicoNome: 'Econômico',
            carrierNome: 'Transportadora Teste',
            disponivel: true,
            observacao: null,
            precoBalcaoCentavos: 1000,
            precoFinalCentavos: 900,
            descontoCentavos: 100,
            descontoPercentual: 10,
            prazoDias: 5,
          },
        ],
        expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
    quotesCriadas.push(quote.id)

    const lista = await listarCotacoes({ cep: '30130-000' })
    const encontrada = lista.itens.find((item) => item.id === quote.id)

    expect(encontrada).toBeDefined()
    expect(encontrada?.dono).toEqual({ tipo: 'ANONIMO', id: anon.id })
  })

  it('filtra por "virou envio" usando Shipment.quoteId', async () => {
    const userId = await usuario()
    const quote = await criarCotacaoValida(userId, {
      precoCentavos: 1500,
      cepOrigem: '01000-000',
      cepDestino: '02000-000',
    })
    quotesCriadas.push(quote.id)

    const carrier = await prisma.carrier.findFirstOrThrow({ where: { slug: 'transportadora-teste' } })
    const servico = await prisma.service.findFirstOrThrow({ where: { id: 'eco' } })

    const shipment = await prisma.shipment.create({
      data: {
        userId,
        quoteId: quote.id,
        serviceId: servico.id,
        remetente: {},
        destinatario: {},
        precoBalcaoCentavos: 1500,
        precoCobradoCentavos: 1500,
        descontoCentavos: 0,
        opcionais: {},
        valorDeclaradoCentavos: 0,
        produtos: [],
      },
    })

    const somenteConvertidas = await listarCotacoes({ virouEnvio: 'SIM', cep: '01000-000' })
    expect(somenteConvertidas.itens.some((item) => item.id === quote.id)).toBe(true)
    expect(somenteConvertidas.itens.find((item) => item.id === quote.id)?.shipmentId).toBe(
      shipment.id,
    )

    const somenteNaoConvertidas = await listarCotacoes({ virouEnvio: 'NAO', cep: '01000-000' })
    expect(somenteNaoConvertidas.itens.some((item) => item.id === quote.id)).toBe(false)

    await prisma.shipment.delete({ where: { id: shipment.id } })
    void carrier
  })
})

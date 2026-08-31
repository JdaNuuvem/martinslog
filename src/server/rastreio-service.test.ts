import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { montarCodigoRastreio } from '@/domain/shipment/codigo-rastreio'
import { rastrearEnvio } from './rastreio-service'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let serviceId = ''
let donoId = ''
let sequencial = 1

function proximoCodigo(): string {
  sequencial += 1
  return montarCodigoRastreio('EC', Number(`${sufixo}`) * 10 + (sequencial % 10))
}

async function criarUsuario(rotulo: string, indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `7${indice}${sufixo}`.padEnd(11, '3').slice(0, 11),
      nome: `Usuário Rastreio ${rotulo}`,
      email: `rastreio-${rotulo}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

async function criarEnvio(userId: string, codigoRastreio: string) {
  return prisma.shipment.create({
    data: {
      userId,
      serviceId,
      codigoRastreio,
      status: 'GENERATED',
      remetente: {
        nome: 'Remetente Ana Prado',
        documento: '11122233344',
        logradouro: 'Rua das Acácias',
        cidade: 'São Paulo',
        uf: 'SP',
      },
      destinatario: {
        nome: 'Destinatário Bruno Lima',
        documento: '55566677788',
        logradouro: 'Travessa do Porto',
        cidade: 'Curitiba',
        uf: 'PR',
      },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
      simulacaoIniciadaEm: new Date('2026-01-01T09:00:00Z'),
    },
  })
}

type EventoDeTeste = {
  sequencia: number
  codigo: string
  descricao: string
  ocorridoEm: Date
  unidadeOrigem?: string
  unidadeDestino?: string
}

async function criarEventos(shipmentId: string, eventos: EventoDeTeste[]) {
  await prisma.trackingEvent.createMany({
    data: eventos.map((evento) => ({
      shipmentId,
      sequencia: evento.sequencia,
      offsetMinutos: evento.sequencia * 60,
      codigo: evento.codigo,
      status: 'POSTED',
      titulo: evento.descricao,
      descricao: evento.descricao,
      unidadeOrigem: evento.unidadeOrigem ?? null,
      unidadeDestino: evento.unidadeDestino ?? null,
      cidade: 'Curitiba',
      uf: 'PR',
      ocorridoEm: evento.ocorridoEm,
    })),
  })
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `RASTREIO-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `RASTREIO-${sufixo}`,
      nome: 'Serviço de teste de rastreio',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id
  donoId = await criarUsuario('dono', 1)
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('rastrearEnvio', () => {
  it('devolve serviço, prazo e eventos do mais recente para o mais antigo', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'POSTADO',
        descricao: 'Objeto postado',
        ocorridoEm: new Date('2026-01-01T10:00:00Z'),
        unidadeOrigem: 'AGÊNCIA DE ENCOMENDAS- SAO PAULO/SP',
      },
      {
        sequencia: 2,
        codigo: 'TRANSFERENCIA',
        descricao: 'Objeto em transferência - por favor aguarde',
        ocorridoEm: new Date('2026-01-02T10:00:00Z'),
        unidadeOrigem: 'UNIDADE DE TRATAMENTO- SAO PAULO/SP',
        unidadeDestino: 'UNIDADE DE TRATAMENTO- CURITIBA/PR',
      },
    ])

    const rastreio = await rastrearEnvio(codigo, new Date('2026-01-03T00:00:00Z'))

    expect(rastreio.codigoRastreio).toBe(codigo)
    expect(rastreio.servico).toBe('Serviço de teste de rastreio')
    expect(rastreio.prazoDias).toBe(3)
    expect(rastreio.eventos.map((e) => e.codigo)).toEqual(['TRANSFERENCIA', 'POSTADO'])
    expect(rastreio.eventos[0]?.unidadeDestino).toBe('UNIDADE DE TRATAMENTO- CURITIBA/PR')
  })

  it('esconde evento futuro e o revela quando o relógio avança', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'POSTADO',
        descricao: 'Objeto postado',
        ocorridoEm: new Date('2026-01-01T10:00:00Z'),
      },
      {
        sequencia: 2,
        codigo: 'ENTREGUE',
        descricao: 'Objeto entregue ao destinatário',
        ocorridoEm: new Date('2026-01-05T10:00:00Z'),
      },
    ])

    const antes = await rastrearEnvio(codigo, new Date('2026-01-02T00:00:00Z'))
    const depois = await rastrearEnvio(codigo, new Date('2026-01-06T00:00:00Z'))

    expect(antes.eventos.map((e) => e.codigo)).toEqual(['POSTADO'])
    expect(depois.eventos.map((e) => e.codigo)).toEqual(['ENTREGUE', 'POSTADO'])
  })

  it('deriva o status do último evento visível, não do campo persistido', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'POSTADO',
        descricao: 'Objeto postado',
        ocorridoEm: new Date('2026-01-01T10:00:00Z'),
      },
      {
        sequencia: 2,
        codigo: 'ENTREGUE',
        descricao: 'Objeto entregue ao destinatário',
        ocorridoEm: new Date('2026-01-05T10:00:00Z'),
      },
    ])

    // O envio continua GENERATED no banco — a sincronização ainda não rodou.
    const antes = await rastrearEnvio(codigo, new Date('2026-01-02T00:00:00Z'))
    const depois = await rastrearEnvio(codigo, new Date('2026-01-06T00:00:00Z'))

    expect(antes.status).toBe('POSTED')
    expect(depois.status).toBe('DELIVERED')
  })

  it('cai no status persistido enquanto nenhum evento é visível', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'POSTADO',
        descricao: 'Objeto postado',
        ocorridoEm: new Date('2026-02-01T10:00:00Z'),
      },
    ])

    const rastreio = await rastrearEnvio(codigo, new Date('2026-01-01T00:00:00Z'))

    expect(rastreio.eventos).toEqual([])
    expect(rastreio.status).toBe('GENERATED')
  })

  it('é público: qualquer pessoa com o código consulta, sem sessão', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'POSTADO',
        descricao: 'Objeto postado',
        ocorridoEm: new Date('2026-01-01T10:00:00Z'),
      },
    ])

    const rastreio = await rastrearEnvio(codigo, new Date('2026-01-02T00:00:00Z'))

    expect(rastreio.codigoRastreio).toBe(codigo)
    expect(rastreio.eventos).toHaveLength(1)
  })

  it('não devolve nome, documento nem logradouro em nenhum campo', async () => {
    const codigo = proximoCodigo()
    const envio = await criarEnvio(donoId, codigo)
    await criarEventos(envio.id, [
      {
        sequencia: 1,
        codigo: 'SAIU_PARA_ENTREGA',
        descricao: 'Objeto saiu para entrega ao destinatário',
        ocorridoEm: new Date('2026-01-01T10:00:00Z'),
      },
    ])

    const rastreio = await rastrearEnvio(codigo, new Date('2026-01-02T00:00:00Z'))
    const serializado = JSON.stringify(rastreio)

    const remetente = envio.remetente as Record<string, string>
    const destinatario = envio.destinatario as Record<string, string>
    for (const valor of [
      remetente.nome,
      remetente.logradouro,
      remetente.documento,
      destinatario.nome,
      destinatario.logradouro,
      destinatario.documento,
    ]) {
      if (valor) {
        expect(serializado).not.toContain(valor)
      }
    }
  })

  it('recusa código sem envio correspondente', async () => {
    await expect(rastrearEnvio(proximoCodigo())).rejects.toBeInstanceOf(EnvioNaoEncontradoError)
  })
})

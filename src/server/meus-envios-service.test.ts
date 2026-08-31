import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { listarMeusEnvios } from './meus-envios-service'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let donoId = ''
let outroId = ''
let serviceId = ''
const AGORA = new Date('2026-03-10T12:00:00Z')

async function criarUsuario(rotulo: string, indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `5${indice}${sufixo}`.padEnd(11, '2').slice(0, 11),
      nome: `Usuário meus envios ${rotulo}`,
      email: `meus-envios-${rotulo}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

async function criarEnvio(
  userId: string,
  status: string,
  destinatarioNome: string,
  criadoEm: Date,
  codigoRastreio: string | null = null,
) {
  return prisma.shipment.create({
    data: {
      userId,
      serviceId,
      status: status as never,
      codigoRastreio,
      criadoEm,
      remetente: { nome: 'Remetente', cidade: 'São Paulo', uf: 'SP' },
      destinatario: {
        nome: destinatarioNome,
        documento: '11122233344',
        logradouro: 'Rua Secreta, 42',
        cidade: 'Curitiba',
        uf: 'PR',
      },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })
}

async function criarEvento(
  shipmentId: string,
  codigo: string,
  titulo: string,
  ocorridoEm: Date,
  sequencia = 1,
) {
  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      sequencia,
      offsetMinutos: sequencia * 60,
      codigo,
      titulo,
      status: 'POSTED',
      descricao: titulo,
      cidade: 'Curitiba',
      uf: 'PR',
      ocorridoEm,
    },
  })
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `MEUS-ENVIOS-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `MEUS-ENVIOS-${sufixo}`,
      nome: 'Serviço de teste da lista',
      prazoBase: 2,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  donoId = await criarUsuario('dono', 1)
  outroId = await criarUsuario('outro', 2)
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('listarMeusEnvios', () => {
  it('lista apenas os envios do próprio usuário', async () => {
    await criarEnvio(donoId, 'POSTED', 'Ana Julia', new Date('2026-03-01T10:00:00Z'))
    await criarEnvio(outroId, 'POSTED', 'Intruso', new Date('2026-03-01T10:00:00Z'))

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)

    expect(envios).toHaveLength(1)
    expect(envios[0]?.destinatarioNome).toBe('Ana Julia')
  })

  it('ordena do mais recente para o mais antigo', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    await criarEnvio(donoId, 'POSTED', 'Antigo', new Date('2026-01-01T10:00:00Z'))
    await criarEnvio(donoId, 'POSTED', 'Recente', new Date('2026-03-01T10:00:00Z'))

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)

    expect(envios.map((e) => e.destinatarioNome)).toEqual(['Recente', 'Antigo'])
  })

  it('deriva o status do último evento visível, não do campo persistido', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    // Persistido como GENERATED, mas a timeline já passou por ENTREGUE.
    const envio = await criarEnvio(donoId, 'GENERATED', 'Ana Julia', new Date('2026-03-01T10:00:00Z'))
    await criarEvento(envio.id, 'POSTADO', 'Objeto postado', new Date('2026-03-02T10:00:00Z'), 1)
    await criarEvento(
      envio.id,
      'ENTREGUE',
      'Objeto entregue ao destinatário',
      new Date('2026-03-03T10:00:00Z'),
      2,
    )

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)

    expect(envios[0]?.status).toBe('DELIVERED')
    expect(envios[0]?.ultimoEvento).toBe('Objeto entregue ao destinatário')
  })

  it('ignora evento futuro ao derivar o status da lista', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    const envio = await criarEnvio(donoId, 'GENERATED', 'Ana Julia', new Date('2026-03-01T10:00:00Z'))
    await criarEvento(envio.id, 'POSTADO', 'Objeto postado', new Date('2026-03-02T10:00:00Z'), 1)
    await criarEvento(
      envio.id,
      'ENTREGUE',
      'Objeto entregue ao destinatário',
      new Date('2026-12-01T10:00:00Z'),
      2,
    )

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)

    expect(envios[0]?.status).toBe('POSTED')
  })

  it('conta as abas e filtra por elas', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    const entregue = await criarEnvio(donoId, 'GENERATED', 'Entregue', new Date('2026-03-01T10:00:00Z'))
    await criarEvento(entregue.id, 'ENTREGUE', 'Objeto entregue', new Date('2026-03-02T10:00:00Z'))
    await criarEnvio(donoId, 'POSTED', 'A caminho', new Date('2026-03-01T11:00:00Z'))
    await criarEnvio(donoId, 'PENDING', 'Sem pagar', new Date('2026-03-01T12:00:00Z'))

    const todos = await listarMeusEnvios(donoId, 'todos', AGORA)
    const pendentes = await listarMeusEnvios(donoId, 'pendentes', AGORA)
    const entregues = await listarMeusEnvios(donoId, 'entregues', AGORA)

    expect(todos.contagem).toEqual({ todos: 3, pendentes: 2, entregues: 1 })
    expect(pendentes.envios.map((e) => e.destinatarioNome).sort()).toEqual([
      'A caminho',
      'Sem pagar',
    ])
    expect(entregues.envios).toHaveLength(1)
  })

  it('não classifica cancelado nem extraviado como pendente', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    await criarEnvio(donoId, 'CANCELLED', 'Cancelado', new Date('2026-03-01T10:00:00Z'))
    await criarEnvio(donoId, 'LOST', 'Extraviado', new Date('2026-03-01T11:00:00Z'))

    const { contagem } = await listarMeusEnvios(donoId, 'todos', AGORA)

    // Ambos aparecem em "todos" e em nenhuma das outras abas: não estão a
    // caminho nem foram entregues.
    expect(contagem).toEqual({ todos: 2, pendentes: 0, entregues: 0 })
  })

  it('suporta envio sem código de rastreio e sem evento', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    await criarEnvio(donoId, 'PENDING', 'Recém-criado', new Date('2026-03-01T10:00:00Z'))

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)

    expect(envios[0]?.codigoRastreio).toBeNull()
    expect(envios[0]?.ultimoEvento).toBeNull()
    expect(envios[0]?.status).toBe('PENDING')
  })

  it('não expõe documento nem logradouro do destinatário', async () => {
    await prisma.shipment.deleteMany({ where: { userId: donoId } })
    await criarEnvio(donoId, 'POSTED', 'Ana Julia', new Date('2026-03-01T10:00:00Z'))

    const { envios } = await listarMeusEnvios(donoId, 'todos', AGORA)
    const cru = JSON.stringify(envios)

    expect(cru).not.toContain('11122233344')
    expect(cru).not.toContain('Rua Secreta')
  })

  it('devolve lista vazia para quem não tem envio', async () => {
    const { envios, contagem } = await listarMeusEnvios(outroId, 'entregues', AGORA)

    expect(envios).toEqual([])
    expect(contagem.entregues).toBe(0)
  })
})

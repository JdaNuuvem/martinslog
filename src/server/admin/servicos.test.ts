import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { emitirEtiqueta } from '@/server/emitir-etiqueta-service'
import {
  alternarServico,
  alternarTransportadora,
  listarTransportadoras,
  salvarServico,
  salvarTransportadora,
} from './servicos'

const usuariosCriados: string[] = []
const carriersCriados: string[] = []

async function ator(): Promise<string> {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  return user.id
}

async function transportadora(nome: string): Promise<string> {
  const criada = await salvarTransportadora(await ator(), { nome })
  carriersCriados.push(criada.id)
  return criada.id
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({
    where: { shipment: { userId: { in: usuariosCriados } } },
  })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  // Serviços caem por cascade com a transportadora.
  await prisma.carrier.deleteMany({ where: { id: { in: carriersCriados } } })
})

describe('salvarTransportadora', () => {
  it('cria com slug derivado do nome e registra a auditoria', async () => {
    const admin = await ator()
    const criada = await salvarTransportadora(admin, { nome: `Expressa Ação ${Date.now()}` })
    carriersCriados.push(criada.id)

    expect(criada.slug).toMatch(/^expressa-acao-\d+$/)
    expect(criada.ativo).toBe(true)

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'TRANSPORTADORA_CRIADA', entidadeId: criada.id },
    })
    expect(log).not.toBeNull()
  })

  it('renomear não reescreve o slug', async () => {
    const admin = await ator()
    const criada = await salvarTransportadora(admin, { nome: `Original ${Date.now()}` })
    carriersCriados.push(criada.id)

    const renomeada = await salvarTransportadora(admin, { id: criada.id, nome: 'Nome Novo' })

    expect(renomeada.nome).toBe('Nome Novo')
    // O slug é identificador estável — é por ele que o seed encontra a
    // transportadora, e trocá-lo criaria outra na prática.
    expect(renomeada.slug).toBe(criada.slug)
  })

  it('recusa nome vazio e slug duplicado', async () => {
    const admin = await ator()
    await expect(salvarTransportadora(admin, { nome: '   ' })).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )

    const nome = `Duplicada ${Date.now()}`
    const criada = await salvarTransportadora(admin, { nome })
    carriersCriados.push(criada.id)

    await expect(salvarTransportadora(admin, { nome })).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})

describe('salvarServico', () => {
  it('cria o serviço e o devolve na listagem, com contagens', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Com Serviço ${Date.now()}`)

    const servico = await salvarServico(admin, {
      carrierId,
      codigo: 'expresso',
      nome: 'Expresso',
      prazoBase: 2,
      limitePesoG: 20000,
      limiteDimensoes: { alturaCm: 50, larguraCm: 40, comprimentoCm: 60 },
    })

    expect(servico.prazoBase).toBe(2)

    const lista = await listarTransportadoras()
    const encontrada = lista.find((t) => t.id === carrierId)
    const resumo = encontrada?.servicos.find((s) => s.id === servico.id)

    expect(resumo).toMatchObject({ codigo: 'expresso', envios: 0, regrasVigentes: 0 })
    expect(resumo?.limiteDimensoes.alturaCm).toBe(50)
  })

  it('recusa código repetido dentro da mesma transportadora', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Codigo Repetido ${Date.now()}`)

    await salvarServico(admin, {
      carrierId,
      codigo: 'eco',
      nome: 'Econômico',
      prazoBase: 5,
      limitePesoG: 30000,
    })

    await expect(
      salvarServico(admin, {
        carrierId,
        codigo: 'eco',
        nome: 'Outro',
        prazoBase: 3,
        limitePesoG: 10000,
      }),
    ).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('recusa prazo e peso fora dos limites', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Limites ${Date.now()}`)
    const base = { carrierId, codigo: 'x', nome: 'X', prazoBase: 5, limitePesoG: 1000 }

    await expect(salvarServico(admin, { ...base, prazoBase: 0 })).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
    await expect(salvarServico(admin, { ...base, prazoBase: 121 })).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
    await expect(salvarServico(admin, { ...base, limitePesoG: 0 })).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
    await expect(salvarServico(admin, { ...base, limitePesoG: 200_000 })).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
  })

  it('registra antes e depois na auditoria ao editar', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Auditoria ${Date.now()}`)

    const criado = await salvarServico(admin, {
      carrierId,
      codigo: 'padrao',
      nome: 'Padrão',
      prazoBase: 5,
      limitePesoG: 30000,
    })

    await salvarServico(admin, {
      id: criado.id,
      carrierId,
      codigo: 'padrao',
      nome: 'Padrão',
      prazoBase: 9,
      limitePesoG: 30000,
    })

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'SERVICO_ATUALIZADO', entidadeId: criado.id },
      orderBy: { criadoEm: 'desc' },
    })

    expect((log?.antes as { prazoBase?: number } | null)?.prazoBase).toBe(5)
    expect((log?.depois as { prazoBase?: number } | null)?.prazoBase).toBe(9)
  })
})

/**
 * A garantia que sustenta a edição de prazo.
 *
 * A linha do tempo é materializada na emissão, com `ocorridoEm` calculado a
 * partir do prazo daquele momento. Se algo passasse a recalcular pelo
 * `prazoBase` atual, um envio em curso mudaria de data debaixo do cliente que
 * já está esperando o pacote — exatamente o que a spec evita ao copiar o
 * fator de velocidade para o `Shipment` em vez de lê-lo da configuração
 * global.
 */
describe('editar o prazo não mexe em envio já emitido', () => {
  it('as datas da timeline continuam as mesmas depois de dobrar o prazo do serviço', async () => {
    const admin = await ator()
    const user = await criarUsuarioComSaldo(0)
    usuariosCriados.push(user.id)

    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, {
      quoteId: cotacao.id,
      servicoId: 'eco',
      remetente: {
        nome: 'Remetente Prazo',
        cep: '01310-100',
        logradouro: 'Av. Paulista',
        numero: '1000',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'SP',
      } satisfies EnderecoEnvio,
      destinatario: {
        nome: 'Destinatário Prazo',
        cep: '20040-020',
        logradouro: 'Av. Rio Branco',
        numero: '100',
        bairro: 'Centro',
        cidade: 'Rio de Janeiro',
        uf: 'RJ',
      } satisfies EnderecoEnvio,
      produtos: [{ nome: 'Caneca', quantidade: 1, valorUnitarioCentavos: 3000 }],
    })

    await prisma.shipment.update({
      where: { id: envio.id },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })
    await emitirEtiqueta(envio.id)

    const servico = await prisma.service.findUniqueOrThrow({ where: { id: 'eco' } })
    const antes = await prisma.trackingEvent.findMany({
      where: { shipmentId: envio.id },
      orderBy: { sequencia: 'asc' },
      select: { codigo: true, offsetMinutos: true, ocorridoEm: true },
    })

    try {
      await salvarServico(admin, {
        id: servico.id,
        carrierId: servico.carrierId,
        codigo: servico.codigo,
        nome: servico.nome,
        prazoBase: servico.prazoBase * 2,
        limitePesoG: servico.limitePesoG,
      })

      const depois = await prisma.trackingEvent.findMany({
        where: { shipmentId: envio.id },
        orderBy: { sequencia: 'asc' },
        select: { codigo: true, offsetMinutos: true, ocorridoEm: true },
      })

      expect(depois).toEqual(antes)
    } finally {
      // O serviço 'eco' é compartilhado pelas fábricas: devolvê-lo ao prazo
      // original evita contaminar qualquer outro teste.
      await prisma.service.update({
        where: { id: servico.id },
        data: { prazoBase: servico.prazoBase },
      })
    }
  })
})

describe('alternar', () => {
  it('desativar o serviço não apaga nada e fica na auditoria', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Alternar ${Date.now()}`)
    const servico = await salvarServico(admin, {
      carrierId,
      codigo: 'alvo',
      nome: 'Alvo',
      prazoBase: 4,
      limitePesoG: 10000,
    })

    await alternarServico(admin, servico.id, false)

    const depois = await prisma.service.findUniqueOrThrow({ where: { id: servico.id } })
    expect(depois.ativo).toBe(false)

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'SERVICO_DESATIVADO', entidadeId: servico.id },
    })
    expect(log).not.toBeNull()
  })

  it('desativar a transportadora preserva o ativo de cada serviço', async () => {
    const admin = await ator()
    const carrierId = await transportadora(`Preserva ${Date.now()}`)
    const ligado = await salvarServico(admin, {
      carrierId,
      codigo: 'ligado',
      nome: 'Ligado',
      prazoBase: 3,
      limitePesoG: 5000,
    })
    const desligado = await salvarServico(admin, {
      carrierId,
      codigo: 'desligado',
      nome: 'Desligado',
      prazoBase: 3,
      limitePesoG: 5000,
      ativo: false,
    })

    await alternarTransportadora(admin, carrierId, false)

    // A cotação exige carrier.ativo E service.ativo, então desligar a
    // transportadora já tira os dois das cotações novas — sem apagar qual
    // deles estava desligado individualmente, para quando ela voltar.
    expect((await prisma.service.findUniqueOrThrow({ where: { id: ligado.id } })).ativo).toBe(true)
    expect((await prisma.service.findUniqueOrThrow({ where: { id: desligado.id } })).ativo).toBe(
      false,
    )
  })

  it('recusa alternar id inexistente', async () => {
    const admin = await ator()
    await expect(alternarServico(admin, 'nao-existe', false)).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
    await expect(alternarTransportadora(admin, 'nao-existe', false)).rejects.toBeInstanceOf(
      ValorInvalidoError,
    )
  })
})

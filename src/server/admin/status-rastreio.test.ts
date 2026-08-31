import { afterEach, afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { TransicaoInvalidaError, ValorInvalidoError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { catalogoDoUsuario, obterStatusPorCodigo } from '@/server/status-rastreio-service'
import { criarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { emitirEtiqueta } from '@/server/emitir-etiqueta-service'
import { sincronizarEnvio } from '@/server/sincronizar-envio-service'
import { ID_CONFIG_SIMULACAO } from '@/server/simulacao-config'
import { aplicarStatusAgora } from './simulacao'
import {
  definirCadenciaDias,
  listarCatalogoPadrao,
  removerStatusPadrao,
  salvarStatusPadrao,
} from './status-rastreio'

const usuariosCriados: string[] = []

async function admin(): Promise<string> {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  return user.id
}

/**
 * Configuração do catálogo padrão E avanço de status de ponta a ponta, no
 * mesmo arquivo de propósito.
 *
 * `status_rastreio` com `userId` nulo é uma tabela **global**, e o vitest roda
 * arquivos em paralelo: dois arquivos escrevendo o catálogo padrão ao mesmo
 * tempo colidem no índice único e produzem vermelho que não significa bug.
 * Dentro de um arquivo, os testes são sequenciais — daí a fusão.
 *
 * Pelo mesmo motivo, nada aqui afirma nada sobre o fator de velocidade
 * global: as asserções de relógio usam o fator **copiado para o envio** na
 * emissão, que é o que de fato governa aquela linha do tempo.
 */
afterEach(async () => {
  await prisma.statusRastreio.deleteMany({ where: { userId: null } })
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({
    where: { shipment: { userId: { in: usuariosCriados } } },
  })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

/**
 * As posições em dias destes testes são frações de dia de propósito.
 *
 * `conferirPrevia` valida contra o **menor** prazo de serviço em uso, e o
 * catálogo de teste tem serviço de 1 dia: mover a postagem para o dia 2 ali é
 * legitimamente impossível (a entrega já aconteceu no dia 1) e o serviço
 * recusa — comportamento correto, coberto pelo teste de reprovação abaixo.
 * Quem quiser dias inteiros usa a cadência, que reposiciona a timeline
 * inteira e por isso não depende do prazo.
 */
describe('salvarStatusPadrao', () => {
  it('reposiciona uma etapa do motor em dias e registra a auditoria', async () => {
    const ator = await admin()

    const salvo = await salvarStatusPadrao(ator, {
      nome: 'POSTADO',
      titulo: 'Objeto postado',
      descricao: 'Saiu da agência',
      diasAposEmissao: 0.5,
    })

    expect(salvo.codigo).toBe('POSTADO')
    expect(salvo.diasAposEmissao).toBe(0.5)
    expect(salvo.userId).toBeNull()

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: ator, acao: 'STATUS_PADRAO_CRIADO', entidadeId: salvo.id },
    })
    expect(log).not.toBeNull()
  })

  it('salvar de novo com o mesmo código edita, não duplica', async () => {
    const ator = await admin()

    await salvarStatusPadrao(ator, {
      nome: 'POSTADO',
      titulo: 'Objeto postado',
      descricao: 'Primeira versão',
      diasAposEmissao: 0.2,
    })
    await salvarStatusPadrao(ator, {
      nome: 'POSTADO',
      titulo: 'Objeto postado',
      descricao: 'Segunda versão',
      diasAposEmissao: 0.5,
    })

    const linhas = await prisma.statusRastreio.findMany({ where: { userId: null, codigo: 'POSTADO' } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.descricao).toBe('Segunda versão')
    expect(linhas[0]?.diasAposEmissao).toBe(0.5)
  })

  it('recusa uma posição que jogue a etapa depois da entrega, sem deixar resíduo', async () => {
    const ator = await admin()

    await expect(
      salvarStatusPadrao(ator, {
        nome: 'POSTADO',
        titulo: 'Objeto postado',
        descricao: 'Tarde demais',
        diasAposEmissao: 400,
      }),
    ).rejects.toBeInstanceOf(ValorInvalidoError)

    // Nem a linha nova sobrevive à reprovação.
    expect(await prisma.statusRastreio.count({ where: { userId: null, codigo: 'POSTADO' } })).toBe(0)
  })

  it('cria uma etapa manual que entra no roteiro de todas as contas', async () => {
    const ator = await admin()
    const cliente = await admin()

    await salvarStatusPadrao(ator, {
      nome: 'Em conferência',
      titulo: 'Em conferência',
      descricao: 'Objeto em conferência na unidade',
      cenario: 'ENTREGA_NORMAL',
      statusResultante: 'POSTED',
      diasAposEmissao: 0.5,
    })

    const catalogo = await catalogoDoUsuario(cliente)
    const extra = catalogo.etapasExtras.find((e) => e.codigo === 'EM_CONFERENCIA')

    expect(extra).toMatchObject({
      dias: 0.5,
      cenario: 'ENTREGA_NORMAL',
      statusResultante: 'POSTED',
    })
  })

  it('recusa transformar um código do motor em etapa nova', async () => {
    const ator = await admin()

    await expect(
      salvarStatusPadrao(ator, {
        nome: 'POSTADO',
        titulo: 'Objeto postado',
        descricao: 'Duplicata',
        cenario: 'ENTREGA_NORMAL',
        statusResultante: 'POSTED',
        fracaoPrazo: 0.3,
      }),
    ).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})

describe('definirCadenciaDias', () => {
  it('espaça o fluxo principal de X em X dias', async () => {
    const ator = await admin()

    const resultado = await definirCadenciaDias(ator, 2)
    expect(resultado.dias).toBe(2)

    const porCodigo = new Map(
      (await listarCatalogoPadrao()).map((linha) => [linha.codigo, linha.diasAposEmissao]),
    )

    expect(porCodigo.get('ETIQUETA_EMITIDA')).toBe(0)
    expect(porCodigo.get('POSTADO')).toBe(2)
    expect(porCodigo.get('TRANSFERENCIA')).toBe(4)
    expect(porCodigo.get('SAIU_PARA_ENTREGA')).toBe(8)
    expect(porCodigo.get('ENTREGUE')).toBe(14)
  })

  it('posiciona também os códigos exclusivos de cenário', async () => {
    // Deixá-los na fração do prazo produzia timeline impossível: num serviço
    // de 1 dia com cadência de 2, o extravio (1,5 · P) caía antes da postagem
    // e a máquina de estados recusava GENERATED → LOST.
    const ator = await admin()

    await definirCadenciaDias(ator, 2)

    const porCodigo = new Map(
      (await listarCatalogoPadrao()).map((linha) => [linha.codigo, linha.diasAposEmissao]),
    )
    expect(porCodigo.get('EXTRAVIADO')).toBe(10)
    expect(porCodigo.get('TENTATIVA_FRUSTRADA')).toBe(10)
    expect(porCodigo.get('DEVOLVIDO')).toBe(16)
  })

  it('a cadência sobrevive a serviços de prazos diferentes', async () => {
    // A validação roda contra o menor e o maior prazo em uso; passar aqui é a
    // prova de que nenhum cenário quebra em nenhum dos dois.
    const ator = await admin()
    await expect(definirCadenciaDias(ator, 5)).resolves.toMatchObject({ dias: 5 })
  })

  it('dias = 0 desfaz a cadência e devolve o fluxo às frações do prazo', async () => {
    const ator = await admin()

    await definirCadenciaDias(ator, 2)
    await definirCadenciaDias(ator, 0)

    const comDias = await prisma.statusRastreio.count({
      where: { userId: null, diasAposEmissao: { not: null } },
    })
    expect(comDias).toBe(0)
  })

  it('recusa cadência negativa ou acima do teto', async () => {
    const ator = await admin()

    await expect(definirCadenciaDias(ator, -1)).rejects.toBeInstanceOf(ValorInvalidoError)
    await expect(definirCadenciaDias(ator, 91)).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('registra a cadência na auditoria', async () => {
    const ator = await admin()

    await definirCadenciaDias(ator, 3)

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: ator, acao: 'STATUS_PADRAO_CADENCIA' },
    })
    expect((log?.depois as { dias?: number } | null)?.dias).toBe(3)
  })
})

describe('removerStatusPadrao', () => {
  it('remove a linha e registra a auditoria', async () => {
    const ator = await admin()
    const salvo = await salvarStatusPadrao(ator, {
      nome: 'POSTADO',
      titulo: 'Objeto postado',
      descricao: 'Texto novo',
    })

    await removerStatusPadrao(ator, salvo.id)

    expect(await prisma.statusRastreio.findUnique({ where: { id: salvo.id } })).toBeNull()
    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: ator, acao: 'STATUS_PADRAO_REMOVIDO', entidadeId: salvo.id },
    })
    expect(log).not.toBeNull()
  })

  it('recusa remover uma linha que não é do catálogo padrão', async () => {
    const ator = await admin()
    await expect(removerStatusPadrao(ator, 'nao-existe')).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})


const MINUTOS_POR_DIA = 1440
const MS_POR_DIA = 24 * 60 * 60 * 1000

const remetente: EnderecoEnvio = {
  nome: 'Remetente Avanço',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Destinatário Avanço',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

async function envioEmitido(): Promise<{
  id: string
  userId: string
  emitidoEm: Date
  fator: number
}> {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)

  const cotacao = await criarCotacaoValida(user.id)
  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Caneca', quantidade: 1, valorUnitarioCentavos: 3000 }],
  })

  // Direto para RELEASED: o pagamento tem testes próprios e aqui só interessa
  // que a emissão aconteça.
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })
  await emitirEtiqueta(envio.id)

  const emitido = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
  return {
    id: envio.id,
    userId: user.id,
    emitidoEm: emitido.simulacaoIniciadaEm as Date,
    // O fator COPIADO para o envio na emissão, e não o global: o valor
    // copiado é o que governa esta linha do tempo, e é imune a outra suíte
    // mexer no singleton no meio do caminho.
    fator: emitido.fatorSimulacao,
  }
}

describe('cadência em dias governa quando o status muda', () => {
  it('com cadência de 2 dias e fator 1, o envio só é postado depois do segundo dia', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    await definirCadenciaDias(ator.id, 2)

    const envio = await envioEmitido()

    const eventos = await prisma.trackingEvent.findMany({
      where: { shipmentId: envio.id },
      orderBy: { sequencia: 'asc' },
      select: { codigo: true, offsetMinutos: true, ocorridoEm: true },
    })

    const postado = eventos.find((evento) => evento.codigo === 'POSTADO')
    expect(postado?.offsetMinutos).toBe(2 * MINUTOS_POR_DIA)

    // O relógio: dois dias de simulação divididos pelo fator do envio.
    const esperado = envio.emitidoEm.getTime() + (2 * MS_POR_DIA) / envio.fator
    expect(postado?.ocorridoEm.getTime()).toBe(esperado)

    // Um minuto antes do prazo o status não se move; um minuto depois, sim.
    const umPouquinhoAntes = new Date(esperado - 60_000)
    expect(await sincronizarEnvio(envio.id, umPouquinhoAntes)).toBe('GENERATED')

    const umPouquinhoDepois = new Date(esperado + 60_000)
    expect(await sincronizarEnvio(envio.id, umPouquinhoDepois)).toBe('POSTED')
  })

  it('o fator de velocidade encolhe a espera sem mexer no roteiro', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    await definirCadenciaDias(ator.id, 2)

    // 1440× = um dia de simulação por minuto de relógio.
    await prisma.simulacaoConfig.update({
      where: { id: ID_CONFIG_SIMULACAO },
      data: { fatorVelocidade: 1440 },
    })

    const envio = await envioEmitido()

    const postado = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId: envio.id, codigo: 'POSTADO' },
    })

    // O offset do roteiro continua em dois dias de simulação, seja qual for
    // o fator: quem muda é só o instante real em que ele vence.
    expect(postado.offsetMinutos).toBe(2 * MINUTOS_POR_DIA)

    const esperado = envio.emitidoEm.getTime() + (2 * MS_POR_DIA) / envio.fator
    expect(postado.ocorridoEm.getTime()).toBe(esperado)

    // A espera real é o offset dividido pelo fator — o contrato de
    // `calcularOcorridoEm`, verificado aqui de ponta a ponta.
    expect(await sincronizarEnvio(envio.id, new Date(esperado - 1_000))).toBe('GENERATED')
    expect(await sincronizarEnvio(envio.id, new Date(esperado + 1_000))).toBe('POSTED')
  })

  it('um salto grande de relógio atravessa os estados intermediários até a entrega', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    await definirCadenciaDias(ator.id, 2)

    const envio = await envioEmitido()

    // 30 dias à frente cobre a timeline inteira de uma vez. O status final é
    // DELIVERED, e não um salto direto que pularia POSTED.
    const futuro = new Date(envio.emitidoEm.getTime() + 30 * MS_POR_DIA)
    expect(await sincronizarEnvio(envio.id, futuro)).toBe('DELIVERED')

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.postadoEm).not.toBeNull()
    expect(atualizado.entregueEm).not.toBeNull()
  })

  it('sem cadência, o roteiro volta a depender do prazo do serviço', async () => {
    const envio = await envioEmitido()

    const postado = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId: envio.id, codigo: 'POSTADO' },
    })

    // Serviço 'eco' das fábricas tem prazo base de 5 dias; 0,1 · 5 = meio dia.
    expect(postado.offsetMinutos).toBe(0.5 * MINUTOS_POR_DIA)
  })
})

describe('aplicarStatusAgora', () => {
  it('move o envio para o status escolhido, gravando um evento forçado', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    const envio = await envioEmitido()

    const resultado = await aplicarStatusAgora(ator.id, envio.id, 'POSTADO')
    expect(resultado.status).toBe('POSTED')

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('POSTED')
    expect(atualizado.postadoEm).not.toBeNull()

    const forcado = await prisma.trackingEvent.findFirst({
      where: { shipmentId: envio.id, forcado: true },
    })
    expect(forcado?.codigo).toBe('POSTADO')
    expect(forcado?.titulo).toBeTruthy()
  })

  it('preserva o passado e descarta apenas o futuro que o salto tornou impossível', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    const envio = await envioEmitido()

    const antes = await prisma.trackingEvent.count({ where: { shipmentId: envio.id } })

    // Um passo de cada vez: DELIVERED não sucede GENERATED, e a função não
    // abre exceção para o administrador — ver o teste do salto proibido.
    await aplicarStatusAgora(ator.id, envio.id, 'POSTADO')
    await aplicarStatusAgora(ator.id, envio.id, 'ENTREGUE')

    const restantes = await prisma.trackingEvent.findMany({
      where: { shipmentId: envio.id },
      orderBy: { sequencia: 'asc' },
      select: { codigo: true, ocorridoEm: true },
    })

    // A emissão, que o cliente já viu, continua lá.
    expect(restantes.some((evento) => evento.codigo === 'ETIQUETA_EMITIDA')).toBe(true)
    // O futuro que não pode mais suceder DELIVERED sumiu.
    expect(restantes.length).toBeLessThan(antes + 1)
    expect(restantes.at(-1)?.codigo).toBe('ENTREGUE')
  })

  it('recusa um salto que a máquina de estados não permite', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    const envio = await envioEmitido()

    // GENERATED → LOST não é transição válida: o extravio exige postagem antes.
    await expect(aplicarStatusAgora(ator.id, envio.id, 'EXTRAVIADO')).rejects.toBeInstanceOf(
      TransicaoInvalidaError,
    )

    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('GENERATED')
  })

  it('o status aplicado sobrevive à sincronização seguinte', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    const envio = await envioEmitido()

    await aplicarStatusAgora(ator.id, envio.id, 'POSTADO')

    const statusPorCodigo = await obterStatusPorCodigo(envio.userId)
    const depois = await sincronizarEnvio(envio.id, new Date(), statusPorCodigo)

    expect(depois).toBe('POSTED')
  })

  it('registra a aplicação na auditoria', async () => {
    const ator = await criarUsuarioComSaldo(0)
    usuariosCriados.push(ator.id)
    const envio = await envioEmitido()

    await aplicarStatusAgora(ator.id, envio.id, 'POSTADO')

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: ator.id, acao: 'SIMULACAO_APLICAR_STATUS', entidadeId: envio.id },
    })
    expect((log?.depois as { codigo?: string } | null)?.codigo).toBe('POSTADO')
  })
})

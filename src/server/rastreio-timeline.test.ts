import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { CodigoEvento } from '@/domain/simulacao/tipos'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { rastrearEnvio } from './rastreio-service'
import { ID_CONFIG_SIMULACAO } from './simulacao-config'

/**
 * Prova o comportamento central do produto: a timeline de um envio não é uma
 * lista estática — ela nasce inteira e datada no futuro na emissão
 * (`emitirEtiqueta`), e o que o cliente vê depende só de comparar
 * `ocorridoEm` com o relógio no instante da consulta (`rastrearEnvio`).
 *
 * Em vez de mockar timers globais (que arriscam travar o cliente do Prisma,
 * que também usa temporizadores internos), avançamos o relógio da forma mais
 * honesta disponível: passando explicitamente o `agora` que `rastrearEnvio`
 * já aceita como parâmetro (é assim que a rota HTTP e o admin consultam a
 * mesma timeline em momentos diferentes — nenhum atalho de teste aqui, é a
 * própria API de produção).
 *
 * Nenhuma das funções do motor de simulação é reimplementada: usamos
 * `statusDoEvento` (para não recalcular o status esperado por conta própria)
 * e `obterConfigSimulacao`/`ID_CONFIG_SIMULACAO` só para ligar o fator global
 * antes de emitir — a geração do roteiro e do offset em si vem inteiramente
 * de `emitirEtiqueta`, que já usa `gerarRoteiro`/`calcularOcorridoEm`
 * internamente.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: envios.map((e) => e.id) } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await definirFatorGlobal(1)
})

/** A configuração de simulação é um registro global único; outros arquivos de
 * teste dependem do fator 1, então cada teste que mexe nela devolve ao
 * padrão logo depois. */
beforeEach(async () => {
  await definirFatorGlobal(1)
})

async function definirFatorGlobal(fatorVelocidade: number): Promise<void> {
  await prisma.simulacaoConfig.upsert({
    where: { id: ID_CONFIG_SIMULACAO },
    update: { fatorVelocidade },
    create: { id: ID_CONFIG_SIMULACAO, fatorVelocidade },
  })
}

const remetente: EnderecoEnvio = {
  nome: 'Remetente Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Destinatário Teste',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

/**
 * Emite um envio pago (fator global vigente no momento da chamada) e devolve
 * o código de rastreio junto com `simulacaoIniciadaEm`, a origem do tempo de
 * toda a timeline gerada.
 */
async function criarEnvioEmitido(fatorVelocidade: number): Promise<{
  codigoRastreio: string
  simulacaoIniciadaEm: Date
}> {
  await definirFatorGlobal(fatorVelocidade)

  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id)

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  // `pagarEnvio` já emite a etiqueta como parte do fluxo real (Task 14):
  // não há passo separado de "emitir" a chamar aqui.
  await pagarEnvio(user.id, envio.id)

  const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
  if (!salvo.codigoRastreio || !salvo.simulacaoIniciadaEm) {
    throw new Error('Envio de teste não foi emitido corretamente')
  }

  return { codigoRastreio: salvo.codigoRastreio, simulacaoIniciadaEm: salvo.simulacaoIniciadaEm }
}

describe('timeline anda com o relógio', () => {
  it('logo após a emissão, só o evento com ocorridoEm no passado aparece — os futuros ficam de fora', async () => {
    const { codigoRastreio, simulacaoIniciadaEm } = await criarEnvioEmitido(1)

    const rastreio = await rastrearEnvio(codigoRastreio, simulacaoIniciadaEm)

    expect(rastreio.eventos).toHaveLength(1)
    expect(rastreio.eventos[0]?.codigo).toBe('ETIQUETA_EMITIDA')
    expect(rastreio.status).toBe(statusDoEvento('ETIQUETA_EMITIDA'))

    const todosOsEventos = await prisma.trackingEvent.findMany({
      where: { shipment: { codigoRastreio } },
    })
    expect(todosOsEventos.length).toBeGreaterThan(1)
  })

  it('avançar o relógio revela novos eventos, na ordem certa, com o status derivado do último visível', async () => {
    const { codigoRastreio, simulacaoIniciadaEm } = await criarEnvioEmitido(1)

    const eventosGravados = await prisma.trackingEvent.findMany({
      where: { shipment: { codigoRastreio } },
      orderBy: { sequencia: 'asc' },
    })
    expect(eventosGravados.length).toBeGreaterThanOrEqual(4)

    // Consulta em cada instante em que um evento gravado ocorre: a cada
    // avanço, exatamente os eventos até ali (inclusive) ficam visíveis, na
    // ordem certa, e o status bate com `statusDoEvento` do último visível —
    // nunca um recálculo próprio do teste.
    for (const [indice, evento] of eventosGravados.entries()) {
      const rastreio = await rastrearEnvio(codigoRastreio, evento.ocorridoEm)

      expect(rastreio.eventos).toHaveLength(indice + 1)
      expect(rastreio.eventos.map((e) => e.sequencia)).toEqual(
        eventosGravados.slice(0, indice + 1).map((e) => e.sequencia).reverse(),
      )
      expect(rastreio.status).toBe(statusDoEvento(evento.codigo as CodigoEvento))
    }

    // Um instante um segundo antes do início não revela nem o primeiro
    // evento — confirma que "no passado" é comparado de verdade, não que
    // tudo aparece de qualquer jeito.
    const antesDeComecar = await rastrearEnvio(
      codigoRastreio,
      new Date(simulacaoIniciadaEm.getTime() - 1000),
    )
    expect(antesDeComecar.eventos).toHaveLength(0)

    // Um instante depois do último evento revela a timeline inteira, na
    // ordem certa (mais recente primeiro).
    const depoisDeTudo = await rastrearEnvio(
      codigoRastreio,
      new Date((eventosGravados.at(-1)?.ocorridoEm.getTime() ?? 0) + 1000),
    )
    expect(depoisDeTudo.eventos).toHaveLength(eventosGravados.length)
    expect(depoisDeTudo.eventos[0]?.sequencia).toBe(eventosGravados.at(-1)?.sequencia)
  })

  /**
   * "Com fatorSimulacao alto, a entrega inteira acontece em minutos de tempo
   * real" já é provado por
   * `emitir-etiqueta-service.test.ts` ("aplica o fator vigente na emissão:
   * fator 1440 comprime um dia em um minuto"), que também usa
   * `calcularOcorridoEm`/`gerarRoteiro` via `emitirEtiqueta`, sem
   * reimplementar nada. Não duplicamos esse teste aqui de propósito: os dois
   * arquivos mexem no mesmo registro global (`SimulacaoConfig`, id
   * `singleton`) e o vitest roda arquivos de teste em paralelo — um segundo
   * teste de fator alto neste arquivo correndo ao mesmo tempo que o daquele
   * cria uma corrida real entre os dois `UPDATE` no mesmo registro (visto
   * empiricamente: o `fatorSimulacao` gravado saía 1 em vez de 1440 quando
   * os dois arquivos rodavam ao mesmo tempo). Os dois testes acima usam
   * fator global, mas nunca dependem do valor exato lido durante a emissão
   * (só da ordem/visibilidade dos eventos, que vale para qualquer fator
   * positivo), então continuam corretos mesmo que outro arquivo altere o
   * registro global no meio da execução.
   */
})

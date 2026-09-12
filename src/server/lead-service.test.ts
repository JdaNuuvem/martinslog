import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarLead } from './lead-service'

const CPF = '52998224725'
const OUTRO_CPF = '11144477735'

/*
  Limpa ANTES de cada teste, e não depois.

  Outros arquivos da suíte criam leads como efeito colateral — todo teste que
  registra pedido ou emite etiqueta passa a alimentar a base — e nenhum deles
  os apaga, porque `LeadOrigem` não tem chave estrangeira para usuário, envio
  ou pedido e a limpeza deles não cascateia até aqui. Limpando só no fim, o
  primeiro teste deste arquivo herdaria os leads do arquivo que rodou antes, e
  a contagem exata que ele afirma dependeria da ordem da suíte.

  Apagar sem filtro é seguro porque `vitest.config.ts` roda um arquivo por vez
  (`fileParallelism: false`).
*/
beforeEach(async () => {
  await prisma.lead.deleteMany({})
})

function base(extras: Partial<Parameters<typeof registrarLead>[0]> = {}) {
  return {
    tipo: 'PEDIDO_PAGO' as const,
    ocorridoEm: new Date('2026-09-01T10:00:00Z'),
    ...extras,
  }
}

describe('registrarLead', () => {
  it('sem nenhuma chave utilizável não cria lead', async () => {
    expect(await registrarLead(base({ nome: 'Fulano' }))).toBeNull()
    expect(await prisma.lead.count()).toBe(0)
  })

  it('o mesmo CPF em duas lojas é um lead com duas origens', async () => {
    const primeiro = await registrarLead(
      base({ cpf: CPF, perfilId: null, pedidoId: 'p1', valorCentavos: 5000 }),
    )
    const segundo = await registrarLead(
      base({ cpf: CPF, perfilId: null, pedidoId: 'p2', valorCentavos: 3000 }),
    )

    expect(segundo).toBe(primeiro)
    expect(await prisma.lead.count()).toBe(1)
    expect(await prisma.leadOrigem.count({ where: { leadId: primeiro! } })).toBe(2)

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: primeiro! } })
    expect(lead.totalPedidos).toBe(2)
    expect(lead.valorTotalCentavos).toBe(8000)
  })

  it('o mesmo telefone com e sem DDI é um lead só', async () => {
    const um = await registrarLead(base({ telefone: '(21) 99999-0001', conversaId: 'c1' }))
    const dois = await registrarLead(base({ telefone: '5521999990001', pedidoId: 'p1' }))

    expect(dois).toBe(um)
    expect(await prisma.lead.count()).toBe(1)
  })

  it('o mesmo e-mail em caixa diferente é um lead só', async () => {
    const um = await registrarLead(base({ email: 'Maria@Exemplo.com', pedidoId: 'p1' }))
    const dois = await registrarLead(base({ email: 'maria@exemplo.com', pedidoId: 'p2' }))

    expect(dois).toBe(um)
  })

  it('pessoas sem nada em comum são leads separados', async () => {
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    await registrarLead(base({ cpf: OUTRO_CPF, pedidoId: 'p2' }))

    expect(await prisma.lead.count()).toBe(2)
  })

  it('funde os dois leads quando o CPF revela que são a mesma pessoa', async () => {
    /*
      O caso real: a pessoa chama no WhatsApp (só telefone) e mais tarde faz
      um envio com CPF — mas o CPF dela já tinha entrado por um pedido de
      outra loja. São dois leads que precisam virar um, e é exatamente nos
      leads mais completos (com CPF E WhatsApp) que a duplicata apareceria.
    */
    const porConversa = await registrarLead(
      base({
        tipo: 'CONVERSA',
        telefone: '21999990002',
        conversaId: 'c1',
        ocorridoEm: new Date('2026-08-01T10:00:00Z'),
      }),
    )
    const porCpf = await registrarLead(
      base({ cpf: CPF, pedidoId: 'p1', valorCentavos: 7000 }),
    )
    expect(porCpf).not.toBe(porConversa)
    expect(await prisma.lead.count()).toBe(2)

    // O envio traz os dois dados juntos e revela que são a mesma pessoa.
    await registrarLead(
      base({ tipo: 'ENVIO', cpf: CPF, telefone: '21999990002', shipmentId: 's1' }),
    )

    expect(await prisma.lead.count()).toBe(1)
    const sobrevivente = await prisma.lead.findFirstOrThrow()
    expect(sobrevivente.telefoneNormalizado).toBe('21999990002')
    expect(sobrevivente.cpfHash).not.toBeNull()
    expect(await prisma.leadOrigem.count()).toBe(3)
    expect(sobrevivente.valorTotalCentavos).toBe(7000)
    // O sobrevivente é o de contato mais antigo: é ele que carrega a data
    // verdadeira do primeiro contato daquela pessoa.
    expect(sobrevivente.id).toBe(porConversa)
  })

  it('com contato empatado, sobrevive o lead que entrou na base primeiro', async () => {
    /*
      O caso da carga inicial: eventos importados de uma vez só chegam com o
      mesmo horário, ou dois eventos de verdade aconteceram ao mesmo tempo.
      `primeiroContatoEm` sozinho não desempata, e é o `criadoEm` — a ordem
      real de entrada na base — que decide quem sobrevive.
    */
    const porTelefone = await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990010', conversaId: 'c10' }),
    )
    const porCpf = await registrarLead(base({ cpf: CPF, pedidoId: 'p10' }))
    expect(porCpf).not.toBe(porTelefone)

    await registrarLead(
      base({ tipo: 'ENVIO', cpf: CPF, telefone: '21999990010', shipmentId: 's10' }),
    )

    expect(await prisma.lead.count()).toBe(1)
    const sobrevivente = await prisma.lead.findFirstOrThrow()
    expect(sobrevivente.id).toBe(porTelefone)
  })

  it('funde também quando a busca casa primeiro pelo CPF', async () => {
    /*
      O espelho do caso acima, e o que denuncia uma cascata que para no
      primeiro acerto: se a procura encontra o lead do CPF e não olha mais
      nada, o gêmeo do telefone sobrevive para sempre.
    */
    const porCpf = await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    const porTelefone = await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990009', conversaId: 'c9' }),
    )
    expect(porCpf).not.toBe(porTelefone)

    await registrarLead(
      base({ tipo: 'ENVIO', cpf: CPF, telefone: '21999990009', shipmentId: 's9' }),
    )

    expect(await prisma.lead.count()).toBe(1)
  })

  it('não grava o CPF em claro em nenhuma coluna', async () => {
    const id = await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: id! } })

    expect(JSON.stringify(lead)).not.toContain(CPF)
  })

  it('reprocessar a mesma origem não duplica a linha de origem', async () => {
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))

    expect(await prisma.leadOrigem.count()).toBe(1)
    const lead = await prisma.lead.findFirstOrThrow()
    // O total também não pode contar duas vezes o mesmo pedido.
    expect(lead.totalPedidos).toBe(1)
  })

  it('duas aparições simultâneas da mesma pessoa nova viram um lead só', async () => {
    /*
      A corrida real: pedido pago e envio pago da mesma compradora chegam com
      segundos de diferença. Disparadas juntas, as duas procuram, ninguém é
      encontrado, e as duas tentam criar. Sem a nova tentativa, uma delas se
      perde da base.
    */
    const [a, b] = await Promise.all([
      registrarLead(base({ cpf: CPF, pedidoId: 'corrida-p' })),
      registrarLead(base({ tipo: 'ENVIO', cpf: CPF, shipmentId: 'corrida-s' })),
    ])

    expect(a).toBe(b)
    expect(await prisma.lead.count()).toBe(1)
    expect(await prisma.leadOrigem.count()).toBe(2)
  })

  it('reprocessar uma origem não desfaz a atualização do lead na mesma chamada', async () => {
    /*
      O defeito que `skipDuplicates` evita. Com `create` + `try/catch`, a
      origem repetida abortava a transação no Postgres e o COMMIT virava
      ROLLBACK — levando junto o nome novo gravado segundos antes.
    */
    await registrarLead(base({ telefone: '21999990077', pedidoId: 'p77' }))

    await registrarLead(
      base({ telefone: '21999990077', pedidoId: 'p77', nome: 'Nome Que Chegou Depois' }),
    )

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.nome).toBe('Nome Que Chegou Depois')
  })

  it('pedido que passa de pendente para pago conta uma vez só', async () => {
    /*
      O mesmo pedido gera duas origens — PEDIDO_PENDENTE e, depois,
      PEDIDO_PAGO — porque o índice de idempotência inclui o tipo. As duas
      aparições ficam no histórico, mas é o MESMO pedido, e totalPedidos não
      pode contar as duas.
    */
    await registrarLead(
      base({
        tipo: 'PEDIDO_PENDENTE',
        telefone: '21999990055',
        pedidoId: 'pendente-depois-pago',
        valorCentavos: 0,
      }),
    )
    await registrarLead(
      base({
        tipo: 'PEDIDO_PAGO',
        telefone: '21999990055',
        pedidoId: 'pendente-depois-pago',
        valorCentavos: 5000,
      }),
    )

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.totalPedidos).toBe(1)
    expect(lead.valorTotalCentavos).toBe(5000)
    expect(await prisma.leadOrigem.count()).toBe(2)
  })

  it('o nome do envio vence o nome vindo da conversa', async () => {
    await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990003', nome: 'zezinho❤️', conversaId: 'c1' }),
    )
    await registrarLead(
      base({ tipo: 'ENVIO', telefone: '21999990003', nome: 'José da Silva', shipmentId: 's1' }),
    )

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.nome).toBe('José da Silva')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarLead } from './lead-service'

const CPF = '52998224725'
const OUTRO_CPF = '11144477735'

afterEach(async () => {
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
      base({ tipo: 'CONVERSA', telefone: '21999990002', conversaId: 'c1' }),
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

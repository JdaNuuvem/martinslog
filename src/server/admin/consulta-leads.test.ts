import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarLead } from '@/server/lead-service'
import { listarLeads, obterLead } from './consulta-leads'

const CPF = '52998224725'

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

async function semear() {
  await registrarLead({
    tipo: 'PEDIDO_PAGO',
    pedidoId: 'p1',
    ocorridoEm: new Date('2026-09-01T10:00:00Z'),
    nome: 'Maria Aparecida',
    email: 'maria@exemplo.com',
    telefone: '21999990001',
    cpf: CPF,
    valorCentavos: 9990,
  })
  await registrarLead({
    tipo: 'CONVERSA',
    conversaId: 'c1',
    ocorridoEm: new Date('2026-09-05T10:00:00Z'),
    nome: 'João Pedro',
    telefone: '21999990002',
  })
}

describe('listarLeads', () => {
  it('lista do contato mais recente para o mais antigo', async () => {
    await semear()

    const { leads, total } = await listarLeads()

    expect(total).toBe(2)
    expect(leads[0]?.nome).toBe('João Pedro')
  })

  it('nunca devolve o CPF completo na listagem', async () => {
    await semear()

    const { leads } = await listarLeads()

    expect(JSON.stringify(leads)).not.toContain(CPF)
    expect(leads.find((l) => l.nome === 'Maria Aparecida')?.cpfMascarado).toBe('***.982.247-**')
  })

  it('acha pelo CPF digitado, comparando impressão digital', async () => {
    await semear()

    const { leads } = await listarLeads({ busca: '529.982.247-25' })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.nome).toBe('Maria Aparecida')
  })

  it('acha por nome, e-mail e telefone', async () => {
    await semear()

    expect((await listarLeads({ busca: 'maria' })).leads).toHaveLength(1)
    expect((await listarLeads({ busca: 'maria@exemplo.com' })).leads).toHaveLength(1)
    expect((await listarLeads({ busca: '21999990002' })).leads).toHaveLength(1)
  })

  it('celular de onze dígitos acha pelo telefone, mesmo tendo o tamanho de um CPF', async () => {
    /*
      Onze dígitos são ambíguos: CPF e celular com DDD têm o mesmo tamanho.
      Uma busca que decide pelo primeiro formato que casa trataria o celular
      como CPF, compararia impressões digitais e voltaria vazia. Digitado com
      máscara de propósito — é assim que o suporte cola o número.
    */
    await semear()

    const { leads } = await listarLeads({ busca: '(21) 99999-0002' })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.nome).toBe('João Pedro')
  })

  it('filtra por período pelo último contato', async () => {
    await semear()

    const { leads } = await listarLeads({ desde: new Date('2026-09-03T00:00:00Z') })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.nome).toBe('João Pedro')
  })
})

describe('obterLead', () => {
  it('devolve o histórico em ordem e não devolve o CPF completo', async () => {
    await semear()
    const lead = await prisma.lead.findFirstOrThrow({ where: { nome: 'Maria Aparecida' } })

    const detalhe = await obterLead(lead.id)

    expect(detalhe?.origens).toHaveLength(1)
    expect(JSON.stringify(detalhe)).not.toContain(CPF)
  })

  it('devolve null para id que não existe', async () => {
    expect(await obterLead('nao-existe')).toBeNull()
  })
})

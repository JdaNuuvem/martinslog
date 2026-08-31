import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError } from '@/domain/errors'
import { analisarTabelaCsv, importarTabela } from './importar-tabela'

const sufixo = String(Date.now()).slice(-6)
const SERVICO = `IMPORT-${sufixo}`
let serviceId = ''
let adminId = ''

// Planilha brasileira sai com `;`, porque a vírgula é o separador decimal
// do preço. O separador `,` é exercitado no teste de delimitador.
const CABECALHO =
  'servico;cep_origem_ini;cep_origem_fim;cep_destino_ini;cep_destino_fim;peso_min_g;peso_max_g;preco_balcao;preco_venda;prazo_dias'

function linha(campos: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    servico: SERVICO,
    cep_origem_ini: '01000000',
    cep_origem_fim: '19999999',
    cep_destino_ini: '20000000',
    cep_destino_fim: '28999999',
    peso_min_g: '0',
    peso_max_g: '1000',
    preco_balcao: '24,90',
    preco_venda: '14,16',
    prazo_dias: '3',
    ...campos,
  }
  return CABECALHO.split(';')
    .map((coluna) => base[coluna] ?? '')
    .join(';')
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: SERVICO } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: SERVICO,
      nome: 'Serviço de teste de importação',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  const admin = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'ADMIN',
      documento: `4${sufixo}`.padEnd(11, '6').slice(0, 11),
      nome: 'Admin da importação',
      email: `admin-importacao-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  adminId = admin.id
})

afterAll(async () => {
  await prisma.priceRule.deleteMany({ where: { serviceId } })
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } })
  await prisma.user.deleteMany({ where: { id: adminId } })
})

describe('analisarTabelaCsv', () => {
  it('converte preço em reais com vírgula para centavos', () => {
    const linhas = analisarTabelaCsv(`${CABECALHO}\n${linha()}`)

    expect(linhas[0]?.precoBalcaoCentavos).toBe(2490)
    expect(linhas[0]?.precoVendaCentavos).toBe(1416)
  })

  it('aceita ponto decimal no preço e preço inteiro sem separador', () => {
    const csv = [
      CABECALHO,
      linha({ preco_balcao: '24.90', preco_venda: '14.16' }),
      linha({ preco_balcao: '25', preco_venda: '15' }),
    ].join('\n')

    const linhas = analisarTabelaCsv(csv)

    expect(linhas[0]?.precoBalcaoCentavos).toBe(2490)
    expect(linhas[1]?.precoBalcaoCentavos).toBe(2500)
    expect(linhas[1]?.precoVendaCentavos).toBe(1500)
  })

  it('ignora linhas em branco no fim do arquivo', () => {
    const linhas = analisarTabelaCsv(`${CABECALHO}\n${linha()}\n\n`)

    expect(linhas).toHaveLength(1)
  })

  it('aceita CRLF e espaços em volta dos campos', () => {
    const linhas = analisarTabelaCsv(`${CABECALHO}\r\n${linha().replace(/;/g, ' ; ')}\r\n`)

    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.servico).toBe(SERVICO)
  })

  it('recusa cabeçalho com coluna faltando, nomeando a coluna', () => {
    const semPrazo = CABECALHO.replace(';prazo_dias', '')

    expect(() => analisarTabelaCsv(`${semPrazo}\n${linha()}`)).toThrow(ArquivoInvalidoError)
    expect(() => analisarTabelaCsv(`${semPrazo}\n${linha()}`)).toThrow(/prazo_dias/)
  })

  it('recusa arquivo sem nenhuma linha de dados', () => {
    expect(() => analisarTabelaCsv(CABECALHO)).toThrow(ArquivoInvalidoError)
  })

  it('aponta o número da linha do arquivo quando um número é inválido', () => {
    const csv = [CABECALHO, linha(), linha({ peso_max_g: 'mil' })].join('\n')

    // Cabeçalho é a linha 1, primeiro dado a 2, defeito na 3.
    expect(() => analisarTabelaCsv(csv)).toThrow(/linha 3/)
  })

  it('recusa faixa de peso invertida e faixa de CEP invertida', () => {
    const pesoInvertido = [CABECALHO, linha({ peso_min_g: '2000', peso_max_g: '1000' })].join('\n')
    const cepInvertido = [
      CABECALHO,
      linha({ cep_destino_ini: '28999999', cep_destino_fim: '20000000' }),
    ].join('\n')

    expect(() => analisarTabelaCsv(pesoInvertido)).toThrow(ArquivoInvalidoError)
    expect(() => analisarTabelaCsv(cepInvertido)).toThrow(ArquivoInvalidoError)
  })

  it('recusa preço negativo e prazo não positivo', () => {
    const precoNegativo = [CABECALHO, linha({ preco_venda: '-1,00' })].join('\n')
    const prazoZero = [CABECALHO, linha({ prazo_dias: '0' })].join('\n')

    expect(() => analisarTabelaCsv(precoNegativo)).toThrow(ArquivoInvalidoError)
    expect(() => analisarTabelaCsv(prazoZero)).toThrow(ArquivoInvalidoError)
  })

  it('recusa linha com número de colunas diferente do cabeçalho', () => {
    const csv = [CABECALHO, `${linha()};sobrando`].join('\n')

    expect(() => analisarTabelaCsv(csv)).toThrow(/linha 2/i)
  })
})

describe('importarTabela', () => {
  it('grava as regras e registra auditoria', async () => {
    const csv = [CABECALHO, linha(), linha({ peso_min_g: '1001', peso_max_g: '2000' })].join('\n')

    const resultado = await importarTabela(adminId, csv)

    expect(resultado.importadas).toBe(2)

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })
    expect(regras).toHaveLength(2)
    expect(regras.every((regra) => regra.ativo)).toBe(true)

    const auditoria = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, acao: 'IMPORTAR_TABELA' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(auditoria).not.toBeNull()
  })

  it('substitui as regras anteriores do serviço, sem deixar tabela misturada', async () => {
    await importarTabela(adminId, [CABECALHO, linha({ preco_venda: '10,00' })].join('\n'))
    await importarTabela(adminId, [CABECALHO, linha({ preco_venda: '20,00' })].join('\n'))

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })

    expect(regras).toHaveLength(1)
    expect(regras[0]?.precoVendaCentavos).toBe(2000)
  })

  it('linha malformada aborta a importação inteira — nada é gravado', async () => {
    await prisma.priceRule.deleteMany({ where: { serviceId } })

    const csv = [CABECALHO, linha(), linha({ preco_venda: 'quatorze reais' })].join('\n')

    await expect(importarTabela(adminId, csv)).rejects.toBeInstanceOf(ArquivoInvalidoError)

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })
    expect(regras).toHaveLength(0)
  })

  it('serviço inexistente aborta a importação, nomeando o código', async () => {
    await prisma.priceRule.deleteMany({ where: { serviceId } })

    const csv = [CABECALHO, linha({ servico: 'SERVICO-QUE-NAO-EXISTE' })].join('\n')

    await expect(importarTabela(adminId, csv)).rejects.toThrow(/SERVICO-QUE-NAO-EXISTE/)

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })
    expect(regras).toHaveLength(0)
  })
})

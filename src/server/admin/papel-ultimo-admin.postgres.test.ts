import { execFileSync } from 'child_process'
import path from 'path'
import { randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { UltimoAdminError } from '@/domain/errors'

/**
 * Testa a proteção do último administrador contra o **Postgres real** — não
 * contra a modelagem do lock em `papel-ultimo-admin.test.ts`.
 *
 * `papel-ultimo-admin.test.ts` prova a lógica de `alterarPapel` (a contagem,
 * a recusa, a corrida) usando um `prisma` simulado com um mutex em memória
 * que reproduz o que o `FOR UPDATE` do Postgres deveria fazer. Isso prova
 * que a função se comporta corretamente **se** o banco serializar — mas não
 * prova que o `SELECT ... FOR UPDATE` da consulta real está de fato
 * serializando. Se o `FOR UPDATE` estivesse na consulta errada, fora da
 * transação, ou se o nível de isolamento não fizesse o que se espera, aquele
 * teste continuaria verde, porque quem serializa ali é o mutex do teste, não
 * o Postgres.
 *
 * Este arquivo fecha essa lacuna: roda a mesma corrida de quatro
 * rebaixamentos simultâneos contra um Postgres de verdade, chamando
 * `alterarPapel` sem nenhuma simulação de lock.
 *
 * **Isolamento (a "saída 2" do pedido: banco próprio para este arquivo).**
 * A regra de "último administrador" conta admins GLOBALMENTE na tabela
 * `users` — é assim que a proteção real funciona. Testar esse cenário no
 * banco de teste compartilhado (`frete_test_1a`) exigiria rebaixar todo
 * `ADMIN` pré-existente, e isso já quebrou `guarda.test.ts` quando tentado
 * (vitest roda arquivos de teste em paralelo por padrão, e outro arquivo
 * pode estar criando um `ADMIN` seu na mesma janela de tempo). Em vez de
 * serializar o arquivo (saída 1) — que exigiria configuração global de
 * paralelismo do vitest, compartilhada com as outras sessões que usam este
 * repositório — este arquivo cria seu próprio schema Postgres dedicado
 * (`CREATE SCHEMA`, aplicado com `prisma db push`) no mesmo servidor de
 * teste, e aponta um `PrismaClient` próprio para ele via
 * `datasourceUrl` + `?schema=`. Nenhuma linha de nenhum outro teste é
 * tocada, e o `FOR UPDATE` roda contra uma tabela `users` que só este
 * arquivo enxerga.
 */

const nomeSchema = `papel_corrida_${Date.now()}_${randomBytes(4).toString('hex')}`
const baseUrl =
  process.env.DATABASE_URL_TEST ?? 'postgresql://frete:frete@localhost:5433/frete_test'
const urlSchemaDedicado = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}schema=${nomeSchema}`

let prismaDedicado: PrismaClient

const contextoAtual: { prisma: PrismaClient | null } = { prisma: null }

vi.mock('@/infra/db/client', () => ({
  get prisma() {
    if (!contextoAtual.prisma) {
      throw new Error('prisma dedicado não configurado neste teste')
    }
    return contextoAtual.prisma
  },
}))

function criarUsuario(sufixo: string) {
  return {
    tipo: 'PF' as const,
    documento: sufixo.padStart(11, '0').slice(-11),
    nome: `Admin corrida real ${sufixo}`,
    email: `papel-corrida-real-${sufixo}@teste.com`,
    senhaHash: 'hash-fake-nao-usado-neste-teste',
  }
}

beforeAll(async () => {
  // `db push` cria as tabelas do schema.prisma atual direto no schema novo
  // — mais rápido e mais simples que reaplicar todo o histórico de
  // migrations, e correto aqui porque só as tabelas (não o histórico de
  // migrations) importam para este teste.
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: urlSchemaDedicado },
    stdio: 'pipe',
    shell: true,
  })

  prismaDedicado = new PrismaClient({ datasourceUrl: urlSchemaDedicado })
  contextoAtual.prisma = prismaDedicado
}, 60_000)

afterAll(async () => {
  await prismaDedicado.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${nomeSchema}" CASCADE`)
  await prismaDedicado.$disconnect()
})

/**
 * Cada teste começa com a tabela `users` vazia neste schema dedicado.
 *
 * A primeira versão deste arquivo não fazia isso, e um teste (o de "só
 * existe um ADMIN") deixava, corretamente, um `ADMIN` para trás — a recusa
 * não altera o papel. Sem essa limpeza, esse admin sobrevivia para o teste
 * seguinte, inflando a contagem GLOBAL que `alterarPapel` usa de verdade e
 * fazendo o teste de corrida (que só verifica se `a` e `b` continuam admin)
 * passar ou falhar por um motivo alheio ao que ele quer provar: o invariante
 * real (pelo menos um admin em todo o schema) continuava valendo — só não
 * era mais um dos dois que o teste estava olhando. Como este schema é
 * exclusivo deste arquivo, apagar tudo entre testes é seguro: não há nenhum
 * outro teste, de nenhum outro arquivo, usando estas linhas.
 */
afterEach(async () => {
  await prismaDedicado.user.deleteMany({})
})

describe('alterarPapel — último administrador (Postgres real, schema dedicado)', () => {
  it('recusa rebaixar quando só existe um ADMIN, e o papel permanece', async () => {
    const alvo = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}1`), papel: 'ADMIN' },
    })
    const ator = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}2`), papel: 'CLIENTE' },
    })

    const { alterarPapel } = await import('./papel')

    await expect(alterarPapel(ator.id, alvo.id, 'CLIENTE')).rejects.toThrow(UltimoAdminError)

    const depois = await prismaDedicado.user.findUniqueOrThrow({ where: { id: alvo.id } })
    expect(depois.papel).toBe('ADMIN')
  })

  it('permite rebaixar quando há mais de um ADMIN', async () => {
    const alvo = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}3`), papel: 'ADMIN' },
    })
    const outro = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}4`), papel: 'ADMIN' },
    })
    const ator = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}5`), papel: 'CLIENTE' },
    })

    const { alterarPapel } = await import('./papel')

    const resultado = await alterarPapel(ator.id, alvo.id, 'CLIENTE')
    expect(resultado).toEqual({ papelAnterior: 'ADMIN', papelAtual: 'CLIENTE' })

    const depois = await prismaDedicado.user.findUniqueOrThrow({ where: { id: alvo.id } })
    expect(depois.papel).toBe('CLIENTE')
    void outro
  })

  it('corrida: quatro requisições simultâneas rebaixando os dois últimos administradores — sempre sobra ao menos um, contra o Postgres de verdade', async () => {
    const a = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}6`), papel: 'ADMIN' },
    })
    const b = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}7`), papel: 'ADMIN' },
    })
    const ator = await prismaDedicado.user.create({
      data: { ...criarUsuario(`${Date.now()}8`), papel: 'CLIENTE' },
    })

    // Enche a tabela com linhas CLIENTE (não ADMIN) só para alargar a janela
    // da corrida: sem índice em `papel`, `SELECT ... WHERE papel = 'ADMIN'`
    // faz varredura sequencial da tabela inteira, e ~2000 linhas levam
    // mensuravelmente mais tempo para escanear do que 2 — é essa janela
    // mais larga que dá chance real de duas transações se sobreporem de
    // verdade no Postgres, em vez de, por sorte do round-trip de localhost,
    // uma sempre terminar antes de a outra começar. Como decoy é CLIENTE, a
    // contagem de admins continua sendo só `a` e `b`: a varredura fica mais
    // lenta, mas o resultado (quem é admin) não muda.
    await prismaDedicado.user.createMany({
      data: Array.from({ length: 2000 }, (_, indice) => ({
        ...criarUsuario(`${Date.now()}9${indice}`),
        papel: 'CLIENTE' as const,
      })),
    })

    const { alterarPapel } = await import('./papel')

    // Quatro participantes, não dois: com dois, a primeira transação
    // costuma terminar antes de a segunda começar, e a corrida não se
    // manifesta. Alterna entre rebaixar `a` e `b` para forçar disputa pelo
    // mesmo lock `SELECT ... FOR UPDATE` — desta vez, o lock real do
    // Postgres, não uma simulação dele.
    const chamadas = [
      alterarPapel(ator.id, a.id, 'CLIENTE'),
      alterarPapel(ator.id, b.id, 'CLIENTE'),
      alterarPapel(ator.id, a.id, 'CLIENTE'),
      alterarPapel(ator.id, b.id, 'CLIENTE'),
    ]

    await Promise.allSettled(chamadas)

    // Os 200 decoys nunca são alvo de rebaixamento — continuam ADMIN em
    // qualquer cenário e não são o que este teste quer provar. O invariante
    // real ("sobra pelo menos um dos DOIS últimos admins que a corrida
    // disputou") só faz sentido olhando exatamente `a` e `b`.
    const restantes = await prismaDedicado.user.count({
      where: { papel: 'ADMIN', id: { in: [a.id, b.id] } },
    })
    expect(restantes).toBeGreaterThanOrEqual(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UltimoAdminError } from '@/domain/errors'

/**
 * Testa a proteção do último administrador — inclusive a corrida de quatro
 * requisições simultâneas — contra um `prisma` **simulado**, em vez do banco
 * de teste real.
 *
 * Por quê: a checagem de `alterarPapel` conta administradores GLOBALMENTE
 * (`SELECT ... FOR UPDATE` em toda a tabela `users`), porque é assim que a
 * proteção precisa funcionar de verdade. Simular "só sobra um admin" no
 * banco de teste exigiria rebaixar todo `ADMIN` pré-existente — inclusive os
 * criados por outros arquivos de teste rodando em paralelo (`vitest`
 * executa arquivos em paralelo por padrão) contra o mesmo banco. Na prática
 * isso quebrou `guarda.test.ts` quando tentado em `papel.test.ts`: o
 * `updateMany` rebaixou, por uma janela de tempo, o admin que aquele arquivo
 * tinha acabado de criar. Um `prisma` simulado isola o cenário por completo
 * — nenhuma linha real é tocada — e ainda assim exercita a função de
 * produção de verdade (`alterarPapel`), não uma reimplementação da regra.
 *
 * O mock reproduz o comportamento de `SELECT ... FOR UPDATE` com um mutex:
 * a primeira transação a chamar `$queryRaw` (o caminho de rebaixar um
 * ADMIN) prende o mutex até a transação terminar — exatamente como o lock
 * de linha do Postgres, que é liberado só no fim da transação. É esse mutex
 * que serializa as quatro requisições concorrentes do teste de corrida.
 */

type Usuario = { papel: 'ADMIN' | 'CLIENTE' }

function criarMutex() {
  let travado = false
  const fila: (() => void)[] = []
  return {
    acquire(): Promise<void> {
      return new Promise((resolve) => {
        if (!travado) {
          travado = true
          resolve()
          return
        }
        fila.push(() => {
          travado = true
          resolve()
        })
      })
    },
    release(): void {
      const proximo = fila.shift()
      if (proximo) {
        proximo()
      } else {
        travado = false
      }
    },
  }
}

function criarPrismaSimulado(usuariosIniciais: Record<string, Usuario>) {
  const usuarios = new Map<string, Usuario>(Object.entries(usuariosIniciais))
  const auditoria: unknown[] = []
  const mutexAdmins = criarMutex()

  const prisma = {
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      let travouAdmins = false

      const tx = {
        user: {
          findUnique: async ({ where: { id } }: { where: { id: string } }) => {
            const usuario = usuarios.get(id)
            return usuario ? { papel: usuario.papel } : null
          },
          update: async ({
            where: { id },
            data,
          }: {
            where: { id: string }
            data: { papel: 'ADMIN' | 'CLIENTE' }
          }) => {
            const usuario = usuarios.get(id)
            if (usuario) usuario.papel = data.papel
            return { id, ...data }
          },
        },
        $queryRaw: async () => {
          // Modela o `FOR UPDATE`: prende o mutex até a transação terminar,
          // não até este `await` retornar — é o que faz duas transações
          // concorrentes esperarem uma pela outra, em vez de lerem a mesma
          // contagem obsoleta ao mesmo tempo.
          await mutexAdmins.acquire()
          travouAdmins = true
          return [...usuarios.entries()]
            .filter(([, usuario]) => usuario.papel === 'ADMIN')
            .map(([id]) => ({ id }))
        },
        auditLog: {
          create: async ({ data }: { data: unknown }) => {
            auditoria.push(data)
            return data
          },
        },
      }

      try {
        return await callback(tx)
      } finally {
        if (travouAdmins) {
          mutexAdmins.release()
        }
      }
    },
  }

  return { prisma, usuarios, auditoria }
}

const contextoAtual: { prisma: ReturnType<typeof criarPrismaSimulado>['prisma'] | null } = {
  prisma: null,
}

vi.mock('@/infra/db/client', () => ({
  get prisma() {
    if (!contextoAtual.prisma) {
      throw new Error('prisma simulado não configurado neste teste')
    }
    return contextoAtual.prisma
  },
}))

describe('alterarPapel — último administrador (prisma simulado)', () => {
  beforeEach(() => {
    contextoAtual.prisma = null
  })

  it('recusa rebaixar quando só existe um ADMIN, e o papel permanece', async () => {
    const { prisma, usuarios } = criarPrismaSimulado({
      alvo: { papel: 'ADMIN' },
      ator: { papel: 'CLIENTE' },
    })
    contextoAtual.prisma = prisma

    const { alterarPapel } = await import('./papel')

    await expect(alterarPapel('ator', 'alvo', 'CLIENTE')).rejects.toThrow(UltimoAdminError)
    expect(usuarios.get('alvo')?.papel).toBe('ADMIN')
  })

  it('permite rebaixar quando há mais de um ADMIN', async () => {
    const { prisma, usuarios } = criarPrismaSimulado({
      alvo: { papel: 'ADMIN' },
      outro: { papel: 'ADMIN' },
      ator: { papel: 'CLIENTE' },
    })
    contextoAtual.prisma = prisma

    const { alterarPapel } = await import('./papel')

    const resultado = await alterarPapel('ator', 'alvo', 'CLIENTE')
    expect(resultado).toEqual({ papelAnterior: 'ADMIN', papelAtual: 'CLIENTE' })
    expect(usuarios.get('alvo')?.papel).toBe('CLIENTE')
  })

  it('corrida: quatro requisições simultâneas rebaixando os dois últimos administradores — sempre sobra ao menos um', async () => {
    const { prisma, usuarios } = criarPrismaSimulado({
      a: { papel: 'ADMIN' },
      b: { papel: 'ADMIN' },
      ator: { papel: 'CLIENTE' },
    })
    contextoAtual.prisma = prisma

    const { alterarPapel } = await import('./papel')

    // Quatro participantes, não dois: com dois, a primeira transação
    // costuma terminar antes de a segunda começar, e a corrida não se
    // manifesta. Alterna entre rebaixar `a` e `b` para forçar disputa pelo
    // mesmo lock.
    const chamadas = [
      alterarPapel('ator', 'a', 'CLIENTE'),
      alterarPapel('ator', 'b', 'CLIENTE'),
      alterarPapel('ator', 'a', 'CLIENTE'),
      alterarPapel('ator', 'b', 'CLIENTE'),
    ]

    await Promise.allSettled(chamadas)

    const restantes = [...usuarios.values()].filter((u) => u.papel === 'ADMIN').length
    expect(restantes).toBeGreaterThanOrEqual(1)
  })
})

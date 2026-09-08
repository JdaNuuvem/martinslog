import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * A guarda de cada página administrativa e de cada página da área logada.
 *
 * Este teste existe por causa de um vazamento real: `/admin/pedidos`
 * respondia HTTP 404 e, no MESMO corpo, 240 KB com telefone, nome e valor
 * pago de compradores — para qualquer requisição anônima. A guarda existia,
 * no layout, chamando `notFound()`. No App Router o layout e os filhos
 * renderizam EM PARALELO: o `notFound()` decide o que o navegador desenha e
 * não impede a página filha de rodar. As consultas já tinham ido ao banco e o
 * resultado saía no payload RSC. **404 não prova que a rota está protegida.**
 *
 * A correção foi chamar a guarda dentro de cada página. Uma correção assim
 * dura até alguém criar a próxima página — e a próxima é sempre a que vaza,
 * porque a regra vive num comentário e ninguém lê comentário ao criar
 * arquivo. Este teste é a regra escrita onde ela falha sozinha.
 *
 * Ele não roda a página nem sobe servidor: lê o texto do arquivo e exige que
 * a chamada apareça ANTES do primeiro `await` de dados. É grosseiro de
 * propósito — um teste que precisa de banco para cobrir isto não seria
 * escrito, e a alternativa a um teste grosseiro é nenhum teste.
 */

const RAIZ = join(process.cwd(), 'src', 'app')

function paginasDe(grupo: string): string[] {
  const encontradas: string[] = []

  function varrer(dir: string) {
    for (const entrada of readdirSync(dir)) {
      const caminho = join(dir, entrada)
      if (statSync(caminho).isDirectory()) varrer(caminho)
      else if (entrada === 'page.tsx') encontradas.push(caminho)
    }
  }

  varrer(join(RAIZ, grupo))
  return encontradas
}

/**
 * A guarda tem de vir antes do primeiro `await`. Depois dele, a página já
 * pode ter consultado — e o que se quer impedir é justamente a consulta.
 */
function guardaVemPrimeiro(fonte: string, guarda: string): boolean {
  const corpo = fonte.slice(fonte.indexOf('export default'))
  const posGuarda = corpo.indexOf(guarda)
  if (posGuarda === -1) return false

  const primeiroAwait = corpo.indexOf('await ')
  return primeiroAwait === -1 || primeiroAwait >= posGuarda - 'await '.length
}

describe('toda página de (admin) chama a guarda de administrador', () => {
  const paginas = paginasDe('(admin)')

  it('encontrou páginas para verificar', () => {
    expect(paginas.length).toBeGreaterThan(0)
  })

  for (const caminho of paginas) {
    const relativo = caminho.slice(RAIZ.length + 1).replace(/\\/g, '/')

    it(relativo, () => {
      const fonte = readFileSync(caminho, 'utf8')
      expect(fonte).toContain('exigirAdminNaPagina()')
      expect(guardaVemPrimeiro(fonte, 'exigirAdminNaPagina()')).toBe(true)
    })
  }
})

describe('página de (app) que consulta o servidor chama a guarda de sessão', () => {
  const paginas = paginasDe('(app)')

  it('encontrou páginas para verificar', () => {
    expect(paginas.length).toBeGreaterThan(0)
  })

  for (const caminho of paginas) {
    const relativo = caminho.slice(RAIZ.length + 1).replace(/\\/g, '/')

    it(relativo, () => {
      const fonte = readFileSync(caminho, 'utf8')

      /*
        Página síncrona não consulta nada: não há dado para vazar, e exigir a
        guarda ali a tornaria dinâmica de graça. A cobrança começa no momento
        em que ela vira `async` — que é o momento em que ela pode consultar.
      */
      if (!/export default async function/.test(fonte)) return

      expect(fonte).toContain('exigirSessaoNaPagina()')
      expect(guardaVemPrimeiro(fonte, 'exigirSessaoNaPagina()')).toBe(true)
    })
  }
})

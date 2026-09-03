import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { env } from '@/env'
import { cadastrarUsuario } from '@/server/auth/cadastro'

/**
 * O cadastro público está fechado: conta nova nasce pelo painel de
 * administração.
 *
 * O que estes testes protegem é a diferença entre fechar e ESCONDER. Esconder o
 * botão não fecha nada — a rota continua aceitando requisição direta de
 * qualquer cliente, e o formulário é só a porta mais visível. A trava tem que
 * estar no servidor, e o padrão tem que ser fechado.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfis.map((p) => p.id) } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('a porta padrão', () => {
  it('o cadastro público nasce FECHADO', () => {
    /*
      O padrão é a parte que importa. Esquecer de definir a variável mantém a
      porta trancada; o contrário — aberto por omissão — faria um ambiente novo,
      ou uma variável perdida numa migração de servidor, abrir o cadastro sem
      ninguém notar.
    */
    expect(env.CADASTRO_PUBLICO).toBe(false)
  })
})

describe('o caminho do administrador', () => {
  it('cria conta com as MESMAS regras da tela pública', async () => {
    /*
      A rota do admin reúsa `cadastrarUsuario` em vez de reimplementar. Um
      caminho paralelo abriria espaço para validação mais fraca: documento não
      conferido, senha curta aceita, e-mail duplicado passando.
    */
    const email = `admin-criou-${Date.now()}@teste.local`
    const { userId } = await cadastrarUsuario(
      {
        nome: 'Cliente Criado pelo Admin',
        documento: '52998224725',
        email,
        senha: 'senha-forte-o-suficiente',
      },
      { anonSessionId: null },
    )
    usuariosCriados.push(userId)

    const gravado = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(gravado.email).toBe(email)
    expect(gravado.papel).toBe('CLIENTE')
    // A senha nunca é gravada em claro, nem quando quem cria é o admin.
    expect(gravado.senhaHash).not.toContain('senha-forte')
    expect(gravado.senhaHash.startsWith('$argon2')).toBe(true)
  })

  it('recusa documento inválido, mesmo vindo do admin', async () => {
    await expect(
      cadastrarUsuario(
        {
          nome: 'Documento Ruim',
          documento: '11111111111', // dígito verificador inválido
          email: `doc-ruim-${Date.now()}@teste.local`,
          senha: 'senha-forte-o-suficiente',
        },
        { anonSessionId: null },
      ),
    ).rejects.toThrow()
  })

  it('recusa e-mail já cadastrado', async () => {
    /*
      Documento diferente do usado no teste anterior, de propósito: repetir o
      CPF faria a recusa vir da PRIMEIRA chamada, e o teste passaria a provar
      unicidade de documento em vez de unicidade de e-mail.
    */
    const email = `repetido-${Date.now()}@teste.local`
    const dados = {
      nome: 'Primeiro',
      documento: '11144477735',
      email,
      senha: 'senha-forte-o-suficiente',
    }

    const { userId } = await cadastrarUsuario(dados, { anonSessionId: null })
    usuariosCriados.push(userId)

    // Duas contas com o mesmo e-mail deixariam o login ambíguo.
    await expect(cadastrarUsuario(dados, { anonSessionId: null })).rejects.toThrow()
  })
})

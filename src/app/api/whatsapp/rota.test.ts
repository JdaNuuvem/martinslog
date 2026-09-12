import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { catalogoPronto, conferirRegrasDaMeta } from '@/domain/mensagem/whatsapp-textos'
import { obterConfig, salvarConfig } from '@/server/whatsapp-service'

/**
 * A tela do WhatsApp depende de duas garantias que nenhum teste de interface
 * pega: o token não pode voltar em leitura, e uma credencial inválida não pode
 * ser gravada como conectada.
 *
 * A segunda é a que protege o lojista de um erro silencioso: gravar sem
 * verificar deixaria a tela dizendo "conectado" para um token digitado errado,
 * e ele só descobriria na primeira venda que não avisou ninguém — quando não há
 * mais como reenviar aquele momento.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.whatsappConfig.deleteMany({ where: { perfilId: { in: perfis.map((p) => p.id) } } })
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function perfilNovo(nome: string) {
  const usuario = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(usuario.id)
  const perfil = await prisma.perfil.create({ data: { userId: usuario.id, nome } })
  return { usuario, perfil }
}

describe('conexão do WhatsApp', () => {
  it('não grava credencial que a Meta recusa', async () => {
    const { usuario, perfil } = await perfilNovo('Loja Token Ruim')

    /*
      Sem rede nos testes, a chamada à Meta falha — que é exatamente o caminho
      de uma credencial inválida. O que importa provar é o efeito: nada gravado.
    */
    await expect(
      salvarConfig(usuario.id, perfil.id, {
        phoneNumberId: '105954253907000',
        token: 'token-que-nao-serve',
      }),
    ).rejects.toThrow()

    expect(await obterConfig(usuario.id, perfil.id)).toBeNull()
  })

  it('recusa um ID de número que não é sequência de dígitos', async () => {
    const { usuario, perfil } = await perfilNovo('Loja ID Ruim')

    // Erro comum: colar o número de telefone em vez do ID dele.
    await expect(
      salvarConfig(usuario.id, perfil.id, {
        phoneNumberId: '+55 11 98888-7777',
        token: 'qualquer',
      }),
    ).rejects.toThrow(/ID do número/)
  })

  it('a leitura nunca devolve o token', async () => {
    const { usuario, perfil } = await perfilNovo('Loja Leitura')

    /*
      Grava direto no banco para testar a LEITURA isoladamente — passar por
      `salvarConfig` exigiria a Meta responder, e o que está sob teste aqui é
      o formato do que sai, não o que entra.
    */
    await prisma.whatsappConfig.create({
      data: {
        perfilId: perfil.id,
        phoneNumberId: '105954253907000',
        tokenCifrado: 'cifrado-qualquer',
        dicaToken: 'EAAG…4f2a',
        ativo: true,
        verificadaEm: new Date(),
      },
    })

    const visivel = await obterConfig(usuario.id, perfil.id)

    expect(visivel).not.toBeNull()
    expect(visivel!.dicaToken).toBe('EAAG…4f2a')
    // Um segredo que volta numa resposta transforma qualquer falha de
    // autorização em permissão de mandar mensagem em nome da loja.
    expect(JSON.stringify(visivel)).not.toContain('cifrado-qualquer')
    expect(Object.keys(visivel!)).not.toContain('tokenCifrado')
  })

  it('perfil de outra conta não é acessível', async () => {
    const { perfil } = await perfilNovo('Loja Alheia')
    const { usuario: intruso } = await perfilNovo('Loja Intrusa')

    await expect(obterConfig(intruso.id, perfil.id)).rejects.toThrow()
  })
})

describe('textos que a tela oferece', () => {
  it('todos passam nas regras da Meta antes de chegar na tela', () => {
    /*
      A tela mostra as recusas ao lado de cada texto. Se algum texto nosso já
      nascesse recusado, o lojista veria um aviso vermelho num texto que nós
      mesmos escrevemos — e perderia a confiança nos outros sete.
    */
    for (const c of catalogoPronto()) {
      expect(conferirRegrasDaMeta(c), c.nome).toEqual([])
    }
  })

  it('cada texto leva exemplo para toda variável', () => {
    // A Meta trava o cadastro quando falta exemplo, sem dizer qual.
    for (const c of catalogoPronto()) {
      expect(c.exemplos.length, c.nome).toBe(c.variaveis.length)
      expect(c.exemplos.every((e) => e.length > 0), c.nome).toBe(true)
    }
  })
})

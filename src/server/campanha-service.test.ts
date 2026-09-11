import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { criarCampanha, listarCampanhas } from './campanha-service'

/**
 * Campanhas, com foco no que protege o número da loja.
 *
 * O disparo em si não entra aqui — ele fala com a Evolution e espaça os
 * envios em segundos, o que tornaria a suíte lenta sem provar mais nada. O
 * que se testa é a lista: quem entra, quem é descartado e quem não entra
 * duas vezes.
 */

const usuariosCriados: string[] = []

async function loja() {
  const user = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(user.id)
  const perfil = await prisma.perfil.create({
    data: { userId: user.id, nome: `loja-campanha-${Date.now()}-${Math.random()}` },
  })
  return { userId: user.id, perfilId: perfil.id }
}

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  const campanhas = await prisma.campanha.findMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.campanhaDestinatario.deleteMany({
    where: { campanhaId: { in: campanhas.map((c) => c.id) } },
  })
  await prisma.campanha.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { id: { in: perfilIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('lista de destinatários', () => {
  /**
   * O número repetido é o caso que mais acontece: a loja cola uma planilha
   * exportada e o mesmo cliente aparece em duas linhas. Mandar duas vezes a
   * mesma mensagem é o tipo de coisa que faz o comprador denunciar como spam.
   */
  it('não manda duas vezes para o mesmo número', async () => {
    const { userId, perfilId } = await loja()

    const resultado = await criarCampanha(userId, perfilId, {
      nome: 'Repetidos',
      texto: 'oi',
      destinatarios: [
        { contato: '5511988887777' },
        { contato: '5511988887777' },
        // Mesmo número escrito de outro jeito — a normalização tem que pegar.
        { contato: '(11) 98888-7777' },
      ],
    })

    expect(resultado.validos).toBe(1)
    expect(resultado.descartados).toBe(2)
  })

  it('descarta número inválido em vez de guardá-lo para falhar depois', async () => {
    const { userId, perfilId } = await loja()

    const resultado = await criarCampanha(userId, perfilId, {
      nome: 'Com lixo',
      texto: 'oi',
      destinatarios: [
        { contato: '5511988886666' },
        { contato: '123' },
        { contato: 'não é telefone' },
        { contato: '' },
      ],
    })

    expect(resultado.validos).toBe(1)
    expect(resultado.descartados).toBe(3)
  })

  it('guarda o nome quando ele vem junto, para personalizar a mensagem', async () => {
    const { userId, perfilId } = await loja()

    const { id } = await criarCampanha(userId, perfilId, {
      nome: 'Com nomes',
      texto: 'Olá {{cliente}}',
      destinatarios: [{ contato: '5511988885555', nome: 'Maria' }],
    })

    const destinatario = await prisma.campanhaDestinatario.findFirstOrThrow({
      where: { campanhaId: id },
    })
    expect(destinatario.nome).toBe('Maria')
    expect(destinatario.status).toBe('PENDENTE')
  })

  it('nasce como rascunho quando não tem data, e agendada quando tem', async () => {
    const { userId, perfilId } = await loja()

    const rascunho = await criarCampanha(userId, perfilId, {
      nome: 'Sem data',
      texto: 'oi',
      destinatarios: [{ contato: '5511988884444' }],
    })
    const agendada = await criarCampanha(userId, perfilId, {
      nome: 'Com data',
      texto: 'oi',
      agendadaPara: new Date(),
      destinatarios: [{ contato: '5511988883333' }],
    })

    const [a, b] = await Promise.all([
      prisma.campanha.findUniqueOrThrow({ where: { id: rascunho.id } }),
      prisma.campanha.findUniqueOrThrow({ where: { id: agendada.id } }),
    ])

    expect(a.status).toBe('RASCUNHO')
    expect(b.status).toBe('AGENDADA')
  })

  it('não deixa uma conta ver campanha de outra', async () => {
    const dono = await loja()
    const estranho = await loja()

    await criarCampanha(dono.userId, dono.perfilId, {
      nome: 'Da casa',
      texto: 'oi',
      destinatarios: [{ contato: '5511988882222' }],
    })

    await expect(
      criarCampanha(estranho.userId, dono.perfilId, {
        nome: 'Invasora',
        texto: 'oi',
        destinatarios: [{ contato: '5511988881111' }],
      }),
    ).rejects.toThrow()

    const doEstranho = await listarCampanhas(estranho.userId, estranho.perfilId)
    expect(doEstranho).toHaveLength(0)
  })
})

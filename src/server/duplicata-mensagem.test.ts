import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'

/**
 * A trava que impede o comprador de receber a mesma mensagem duas vezes.
 *
 * Este arquivo existe porque ela não funcionava, e o teste que deveria cobri-la
 * passava: `dispararSmsPendentes` também descarta repetição pelo status, então
 * o caminho testado nunca chegava a exercitar o índice. A corrida real — dois
 * disparos simultâneos lendo a fila antes de qualquer um gravar — não passa
 * pelo status, passa só por aqui.
 *
 * O defeito era de semântica do banco: num índice único comum, o Postgres
 * considera NULL sempre diferente de NULL, e basta uma coluna nula na tupla
 * para duas linhas idênticas serem aceitas as duas. Toda mensagem que sai de um
 * envio tem `pedidoId` nulo.
 *
 * Os testes abaixo gravam direto na tabela, sem passar por serviço nenhum, de
 * propósito: é o banco que está sendo testado.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const perfis = await prisma.perfil.findMany({ where: { userId: { in: usuariosCriados } } })
  const perfilIds = perfis.map((p) => p.id)
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId: { in: perfilIds } } })
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function perfilNovo(nome: string) {
  const usuario = await criarUsuarioComSaldo(1000)
  usuariosCriados.push(usuario.id)
  return prisma.perfil.create({ data: { userId: usuario.id, nome } })
}

function linha(perfilId: string, extra: Record<string, unknown> = {}) {
  return {
    perfilId,
    canal: 'SMS' as const,
    evento: 'PEDIDO_PAGO',
    para: '5511988887777',
    ...extra,
  }
}

describe('trava contra mensagem repetida', () => {
  it('barra a segunda gravação mesmo com pedidoId e shipmentId nulos', async () => {
    const perfil = await perfilNovo('Duplicata Nulos')

    /*
      O caso que passava antes. `pedidoId` e `shipmentId` nulos é a forma de
      TODA mensagem que a plataforma manda hoje.
    */
    await prisma.mensagemEnvio.create({ data: linha(perfil.id) })

    await expect(prisma.mensagemEnvio.create({ data: linha(perfil.id) })).rejects.toMatchObject({
      code: 'P2002',
    })

    expect(await prisma.mensagemEnvio.count({ where: { perfilId: perfil.id } })).toBe(1)
  })

  it('barra a repetição também quando a mensagem nasce de um envio', async () => {
    const perfil = await perfilNovo('Duplicata Envio')
    const dados = linha(perfil.id, { shipmentId: 'envio-inventado-1' })

    await prisma.mensagemEnvio.create({ data: dados })
    await expect(prisma.mensagemEnvio.create({ data: dados })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  it('canais diferentes do mesmo evento continuam passando', async () => {
    const perfil = await perfilNovo('Duplicata Canais')

    // Endurecer a trava não pode fazer o SMS bloquear o WhatsApp.
    await prisma.mensagemEnvio.create({ data: linha(perfil.id, { canal: 'SMS' }) })
    await prisma.mensagemEnvio.create({ data: linha(perfil.id, { canal: 'WHATSAPP' }) })

    expect(await prisma.mensagemEnvio.count({ where: { perfilId: perfil.id } })).toBe(2)
  })

  it('a régua de recuperação manda várias vezes para o mesmo pedido', async () => {
    const perfil = await perfilNovo('Duplicata Regua')

    /*
      Cobrar de novo é o desenho da régua, não repetição. Sem `regraId` na
      chave, a trava endurecida transformaria uma régua de três toques em um
      toque só — e o defeito seria mudo, porque a segunda gravação falha
      silenciosamente como "já existe".
    */
    const evento = { evento: 'PEDIDO_PENDENTE', pedidoId: null }
    await prisma.mensagemEnvio.create({ data: linha(perfil.id, { ...evento, regraId: 'r15min' }) })
    await prisma.mensagemEnvio.create({ data: linha(perfil.id, { ...evento, regraId: 'r2h' }) })

    expect(await prisma.mensagemEnvio.count({ where: { perfilId: perfil.id } })).toBe(2)

    // Mas a MESMA regra, duas vezes, continua sendo repetição.
    await expect(
      prisma.mensagemEnvio.create({ data: linha(perfil.id, { ...evento, regraId: 'r15min' }) }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})

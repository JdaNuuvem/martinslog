import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarPedido } from '@/server/pedido-service'
import { criarUsuarioComSaldo } from '@/test/factories'

/**
 * O comprador que pagou tem que ser avisado — por algum canal.
 *
 * Este arquivo existe por causa de um defeito que ficou dias invisível em
 * produção: o caminho do pedido pago chamava só a fila do WhatsApp, e o
 * WhatsApp exige uma conta verificada na Meta que ainda não existe. A função
 * devolvia "sem-whatsapp", a API respondia "Pedido salvo" e ninguém recebia
 * nada. O número que denunciou: 561 pedidos pagos numa loja e 28 SMS.
 *
 * O que se protege aqui, então, não é "manda WhatsApp" nem "manda SMS" — é
 * que a falta de um canal não cala o outro.
 */

let perfilId = ''
let userId = ''

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(0)
  userId = user.id
  const perfil = await prisma.perfil.create({
    data: { userId, nome: 'Loja do teste de aviso', nomeExibicao: 'Loja' },
  })
  perfilId = perfil.id
})

afterAll(async () => {
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId } })
  await prisma.pedido.deleteMany({ where: { perfilId } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId } })
  await prisma.perfil.deleteMany({ where: { id: perfilId } })
  await prisma.wallet.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

function pedido(externalId: string, telefone: string) {
  return {
    externalId,
    status: 'PAGO' as const,
    clienteNome: 'Compradora Teste',
    clienteFone: telefone,
    valorCentavos: 9990,
  }
}

describe('aviso de pagamento confirmado', () => {
  it('enfileira SMS mesmo sem WhatsApp conectado', async () => {
    /*
      O caso real: nenhuma conta de WhatsApp verificada no perfil. Antes da
      correção, isto produzia zero mensagens — o retorno "sem-whatsapp"
      encerrava a função e o SMS nunca era considerado.
    */
    const salvo = await registrarPedido(perfilId, pedido('PED-AVISO-1', '11988880001'))

    const mensagens = await prisma.mensagemEnvio.findMany({ where: { pedidoId: salvo.id } })
    expect(mensagens.map((m) => m.canal)).toContain('SMS')
    expect(salvo.mensagem).toContain('SMS')
  })

  it('o texto de SMS nasce sozinho: loja nova não fica muda', async () => {
    /*
      `enfileirarSms` garante o template padrão quando não existe. Sem isso,
      toda loja recém-integrada passaria os primeiros dias sem avisar ninguém,
      e o sintoma seria idêntico ao defeito que este arquivo cobre.
    */
    const template = await prisma.mensagemTemplate.findFirst({
      where: { perfilId, evento: 'PEDIDO_PAGO', canal: 'SMS' },
    })
    expect(template).not.toBeNull()
    expect(template!.ativo).toBe(true)
  })

  it('repetir o mesmo pedido pago não manda duas vezes', async () => {
    await registrarPedido(perfilId, pedido('PED-AVISO-2', '11988880002'))
    const segundo = await registrarPedido(perfilId, pedido('PED-AVISO-2', '11988880002'))

    const mensagens = await prisma.mensagemEnvio.findMany({
      where: { pedidoId: segundo.id, canal: 'SMS' },
    })
    // A trava é do banco (índice único), não da aplicação: duas chamadas
    // simultâneas do integrador cairiam no mesmo lugar.
    expect(mensagens).toHaveLength(1)
  })

  it('telefone impossível não vira mensagem, e a API diz por quê', async () => {
    const salvo = await registrarPedido(perfilId, {
      ...pedido('PED-AVISO-3', '123'),
      clienteFone: '123',
    })

    const mensagens = await prisma.mensagemEnvio.findMany({ where: { pedidoId: salvo.id } })
    expect(mensagens).toHaveLength(0)
    // "Pedido salvo" e ponto final foi o que deixou o defeito original
    // invisível: quem integra precisa do motivo.
    expect(salvo.mensagem.toLowerCase()).toContain('telefone')
  })

  it('pedido pendente não avisa nada: quem não pagou não recebe confirmação', async () => {
    const salvo = await registrarPedido(perfilId, {
      ...pedido('PED-AVISO-4', '11988880004'),
      status: 'PENDENTE',
    })

    const mensagens = await prisma.mensagemEnvio.findMany({ where: { pedidoId: salvo.id } })
    expect(mensagens).toHaveLength(0)
  })
})

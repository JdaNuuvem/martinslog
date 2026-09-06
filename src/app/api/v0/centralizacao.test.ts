import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarToken } from '@/server/api-token-service'
import { criarUsuarioComSaldo } from '@/test/factories'
import { listarPedidosAdmin } from '@/server/admin/consulta-pedidos'
import { listarMensagensAdmin } from '@/server/admin/consulta-mensagens'
import { POST as PEDIDOS } from './pedidos/route'
import { POST as MENSAGENS } from './mensagens/route'

/**
 * Trazer a operação inteira da loja para o painel.
 *
 * Medido antes: a loja tinha 5.409 pedidos e a plataforma 1.890 — só os
 * criados depois que a integração foi ligada. Tinha 3.651 e-mails enviados e a
 * plataforma zero, porque não havia rota por onde eles entrarem. E 3.622
 * pedidos expirados que nunca viraram CANCELADO aqui, porque a loja só avisava
 * PENDENTE e PAGO.
 *
 * O que estes testes protegem é o que torna a importação POSSÍVEL sem estragar
 * nada: trazer histórico não pode avisar ninguém, não pode carimbar a data de
 * hoje num pedido de agosto, e repetir a importação não pode duplicar.
 */

let userId = ''
let perfilId = ''
let token = ''

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(0)
  userId = user.id
  const perfil = await prisma.perfil.create({
    data: { userId, nome: 'Loja da importação', nomeExibicao: 'Loja' },
  })
  perfilId = perfil.id
  const criado = await criarToken(userId, 'Importação', 'PRODUCAO')
  token = criado.tokenClaro
  await prisma.apiToken.updateMany({ where: { userId }, data: { perfilId } })
})

afterAll(async () => {
  await prisma.mensagemEnvio.deleteMany({ where: { perfilId } })
  await prisma.pedido.deleteMany({ where: { perfilId } })
  await prisma.mensagemTemplate.deleteMany({ where: { perfilId } })
  await prisma.apiToken.deleteMany({ where: { userId } })
  await prisma.perfil.deleteMany({ where: { id: perfilId } })
  await prisma.wallet.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

function req(url: string, corpo: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(corpo),
  })
}

const ONTEM = '2026-08-15T10:30:00.000Z'

describe('importação de pedidos antigos', () => {
  it('não avisa ninguém quando `notificar_cliente` é falso', async () => {
    /*
      O teste que impede o acidente mais caro deste recurso. Sem a trava, trazer
      meses de histórico avisaria "pagamento confirmado" a milhares de pessoas
      que compraram semanas atrás — mensagem cobrada uma a uma, sem sentido para
      quem recebe, e um envio em massa não solicitado do ponto de vista da
      operadora.
    */
    const resposta = await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-001',
        status: 'PAGO',
        cliente: { nome: 'Compradora Antiga', telefone: '11988887001' },
        valor_centavos: 9990,
        notificar_cliente: false,
        criado_em: ONTEM,
        pago_em: ONTEM,
      }),
    )
    expect(resposta.status).toBe(201)

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-001' } },
    })
    const mensagens = await prisma.mensagemEnvio.findMany({ where: { pedidoId: pedido.id } })
    expect(mensagens).toHaveLength(0)
  })

  it('guarda a data da LOJA, não a da importação', async () => {
    /*
      Sem isto, todo pedido importado nasceria com a data de hoje e a lista
      viraria uma parede de "hoje" — perdendo exatamente a informação que faz o
      histórico valer.
    */
    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-001' } },
    })
    expect(pedido.criadoEm.toISOString()).toBe(ONTEM)
    expect(pedido.pagoEm?.toISOString()).toBe(ONTEM)
  })

  it('marca o importado como NÃO recuperável — a régua não pode alcançá-lo', async () => {
    /*
      A trava que faltava, e a mais perigosa.

      `notificar_cliente` decidia só se AQUELA chamada avisava, e morria ali. A
      régua de recuperação não olha nada disso: varre pedido pendente por idade
      e cria mensagem direto, duzentos por regra por rodada. Bastava uma regra
      ativa para milhares de "conclua sua compra" saírem para quem abandonou o
      carrinho semanas atrás.

      A proteção que existia — a janela de sete dias — só funciona se quem
      importa lembrar de mandar a data da loja. Sem ela, todo pedido importado
      parece nascido agora e passa por dentro. Agora a decisão vive no dado.
    */
    await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-004',
        status: 'PENDENTE',
        cliente: { nome: 'Abandonou o carrinho', telefone: '11988887004' },
        notificar_cliente: false,
      }),
    )

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-004' } },
    })
    expect(pedido.recuperavel).toBe(false)
  })

  it('o pedido normal continua recuperável: a trava é da importação, não de todos', async () => {
    await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'VIVO-001',
        status: 'PENDENTE',
        cliente: { nome: 'Comprando agora', telefone: '11988887010' },
      }),
    )

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'VIVO-001' } },
    })
    expect(pedido.recuperavel).toBe(true)
  })

  it('uma sincronização depois não reabilita a cobrança que a importação desligou', async () => {
    await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-004',
        status: 'PENDENTE',
        cliente: { nome: 'Abandonou o carrinho', telefone: '11988887004' },
      }),
    )

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-004' } },
    })
    expect(pedido.recuperavel).toBe(false)
  })

  it('aceita CANCELADO, que é o destino dos pedidos expirados', async () => {
    /*
      A loja tem milhares de PIX que venceram. Eles existiam só como "pendente
      para sempre" aqui, e o painel contava como venda a recuperar algo que
      morreu há semanas.
    */
    const resposta = await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-002',
        status: 'CANCELADO',
        cliente: { nome: 'Comprador Sumiu', telefone: '11988887002' },
        notificar_cliente: false,
        criado_em: ONTEM,
      }),
    )
    expect(resposta.status).toBe(201)

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-002' } },
    })
    expect(pedido.status).toBe('CANCELADO')
    expect(pedido.canceladoEm).not.toBeNull()
  })

  it('guarda o comprovante que o comprador mandou', async () => {
    const imagem =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

    await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-003',
        status: 'PAGO',
        cliente: { nome: 'Mandou Prova', telefone: '11988887003' },
        comprovante: imagem,
        comprovante_em: ONTEM,
        notificar_cliente: false,
      }),
    )

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-003' } },
    })
    expect(pedido.comprovante).toBe(imagem)
    expect(pedido.comprovanteEm?.toISOString()).toBe(ONTEM)
  })

  it('o painel mostra e conta quem tem comprovante', async () => {
    const lista = await listarPedidosAdmin({ perfilId })
    expect(lista.comComprovante).toBe(1)
    expect(lista.pedidos.find((p) => p.externalId === 'HIST-003')?.temComprovante).toBe(true)

    const so = await listarPedidosAdmin({ perfilId, comComprovante: true })
    expect(so.pedidos.map((p) => p.externalId)).toEqual(['HIST-003'])
  })

  it('uma sincronização depois não apaga o comprovante que já estava aqui', async () => {
    await PEDIDOS(
      req('/api/v0/pedidos', {
        external_id: 'HIST-003',
        status: 'PAGO',
        cliente: { nome: 'Mandou Prova', telefone: '11988887003' },
        notificar_cliente: false,
      }),
    )

    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-003' } },
    })
    expect(pedido.comprovante).not.toBeNull()
  })
})

describe('e-mails da loja no painel', () => {
  it('a loja reporta um lote e ele aparece na mesma lista das outras mensagens', async () => {
    const resposta = await MENSAGENS(
      req('/api/v0/mensagens', {
        mensagens: [
          {
            canal: 'EMAIL',
            evento: 'PEDIDO_PAGO',
            para: 'Compradora@Exemplo.com',
            entregue: true,
            external_id: 'HIST-001',
            assunto: 'Pagamento confirmado',
            enviada_em: ONTEM,
          },
          {
            canal: 'EMAIL',
            evento: 'PEDIDO_RECEBIDO',
            para: 'quebrado@',
            entregue: false,
            erro: 'Invalid `to` field.',
            enviada_em: ONTEM,
          },
        ],
      }),
    )
    expect(resposta.status).toBe(200)
    expect(await resposta.json()).toMatchObject({ registradas: 2, repetidas: 0 })

    const lista = await listarMensagensAdmin({ canal: 'EMAIL' })
    expect(lista.total).toBe(2)
    // O que falhou entra na contagem de "não chegaram", junto com SMS e
    // WhatsApp — é a pergunta da tela, e ela não distingue canal.
    expect(lista.falhas).toBe(1)
  })

  it('o e-mail fica amarrado ao pedido pelo código da loja', async () => {
    const pedido = await prisma.pedido.findUniqueOrThrow({
      where: { perfilId_externalId: { perfilId, externalId: 'HIST-001' } },
    })
    const doPedido = await prisma.mensagemEnvio.findMany({
      where: { pedidoId: pedido.id, canal: 'EMAIL' },
    })
    expect(doPedido).toHaveLength(1)
    // Endereço em minúsculas, mas sem outra normalização: o que importa é bater
    // com o que a loja enviou de fato.
    expect(doPedido[0]!.para).toBe('compradora@exemplo.com')
  })

  it('repetir o mesmo lote não duplica — a importação é segura de repetir', async () => {
    const resposta = await MENSAGENS(
      req('/api/v0/mensagens', {
        mensagens: [
          {
            canal: 'EMAIL',
            evento: 'PEDIDO_PAGO',
            para: 'Compradora@Exemplo.com',
            entregue: true,
            external_id: 'HIST-001',
            assunto: 'Pagamento confirmado',
            enviada_em: ONTEM,
          },
        ],
      }),
    )

    expect(await resposta.json()).toMatchObject({ registradas: 0, repetidas: 1 })
  })

  it('dois e-mails com o MESMO evento e assuntos iguais não colapsam num só', async () => {
    /*
      A trava geral desta tabela foi desenhada para o que a PLATAFORMA envia:
      `(perfil, evento, canal, pedido, envio, regra)` com `NULLS NOT DISTINCT`.
      Numa mensagem reportada, envio e regra são sempre nulos e o pedido fica
      nulo quando o código não é encontrado — e a chave desaba para
      `(perfil, evento, canal)`.

      O efeito seria brutal e silencioso: três mil e-mails "pagamento
      confirmado" virariam UM, e os outros voltariam contados como REPETIDOS —
      o número que a rota devolve justamente como prova de que a importação é
      segura de repetir. O operador leria "500 repetidas" e concluiria que já
      tinha importado, quando havia perdido o lote.

      O id do provedor é a identidade de verdade.
    */
    const resposta = await MENSAGENS(
      req('/api/v0/mensagens', {
        mensagens: [
          {
            canal: 'EMAIL',
            evento: 'PROMOCAO',
            para: 'um@exemplo.com',
            entregue: true,
            id_externo: 'resend-aaa',
          },
          {
            canal: 'EMAIL',
            evento: 'PROMOCAO',
            para: 'dois@exemplo.com',
            entregue: true,
            id_externo: 'resend-bbb',
          },
        ],
      }),
    )

    expect(await resposta.json()).toMatchObject({ registradas: 2, repetidas: 0 })

    const gravadas = await prisma.mensagemEnvio.count({
      where: { perfilId, canal: 'EMAIL', evento: 'PROMOCAO' },
    })
    expect(gravadas).toBe(2)
  })

  it('o MESMO id do provedor duas vezes é uma mensagem só', async () => {
    const resposta = await MENSAGENS(
      req('/api/v0/mensagens', {
        mensagens: [
          {
            canal: 'EMAIL',
            evento: 'PROMOCAO',
            para: 'um@exemplo.com',
            entregue: true,
            id_externo: 'resend-aaa',
          },
        ],
      }),
    )

    expect(await resposta.json()).toMatchObject({ registradas: 0, repetidas: 1 })
  })

  it('mensagem de e-mail nunca entra na fila de envio da plataforma', async () => {
    /*
      Ela já foi enviada pela loja. `PENDENTE` faria o disparador tentar
      reenviar algo que não é dele — e cobraria por isso.
    */
    const naFila = await prisma.mensagemEnvio.count({
      where: { perfilId, canal: 'EMAIL', status: 'PENDENTE' },
    })
    expect(naFila).toBe(0)

    const comProximaTentativa = await prisma.mensagemEnvio.count({
      where: { perfilId, canal: 'EMAIL', proximaTentativaEm: { not: null } },
    })
    expect(comProximaTentativa).toBe(0)
  })
})

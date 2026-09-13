import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { criarUsuarioComSaldo } from '@/test/factories'
import {
  aplicarTemplate,
  AtalhoRepetidoError,
  criarTemplate,
  listarTemplates,
} from './template-whatsapp-service'

/**
 * Respostas prontas: as padrão, a trava do atalho e o preenchimento.
 *
 * O preenchimento é o que pode dar vergonha na frente do cliente: um
 * `{{codigo_rastreio}}` cru na mensagem, ou o pedido de outra pessoa.
 */

const usuariosCriados: string[] = []
const carriersCriados: string[] = []
let donoId = ''
let estranhoId = ''
let perfilId = ''
let conversaComTelefone = ''
let conversaLid = ''

beforeAll(async () => {
  const dono = await criarUsuarioComSaldo(0)
  const estranho = await criarUsuarioComSaldo(0)
  usuariosCriados.push(dono.id, estranho.id)
  donoId = dono.id
  estranhoId = estranho.id

  const perfil = await prisma.perfil.create({
    data: { userId: dono.id, nome: `templates-${Date.now()}`, nomeExibicao: 'Loja Bonita' },
  })
  perfilId = perfil.id

  const carrier = await prisma.carrier.create({
    data: { nome: 'Transportadora Teste', slug: `tpl-whatsapp-${Date.now()}` },
  })
  carriersCriados.push(carrier.id)
  const service = await prisma.service.create({
    data: {
      carrierId: carrier.id,
      codigo: `TPL${Date.now()}`,
      nome: 'Serviço Teste',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: {},
    },
  })
  const codigo = `MLTPL${String(Date.now()).slice(-8)}BR`
  await prisma.shipment.create({
    data: {
      userId: dono.id,
      perfilId,
      serviceId: service.id,
      codigoRastreio: codigo,
      referenciaExterna: 'PED-777',
      remetente: {},
      // Cadastrado sem o 55: a busca é pelo final do número.
      destinatario: { nome: 'Fulana', telefone: '(11) 96666-5555' },
      precoBalcaoCentavos: 1000,
      precoCobradoCentavos: 100,
      descontoCentavos: 0,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })

  conversaComTelefone = (
    await prisma.conversa.create({
      data: {
        perfilId,
        jid: '5511966665555@s.whatsapp.net',
        telefone: '5511966665555',
        nomeContato: 'Fulana',
      },
    })
  ).id
  conversaLid = (await prisma.conversa.create({ data: { perfilId, jid: '600@lid' } })).id
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.service.deleteMany({ where: { carrierId: { in: carriersCriados } } })
  await prisma.carrier.deleteMany({ where: { id: { in: carriersCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('templates do WhatsApp', () => {
  it('cria as cinco padrão na primeira listagem, e só na primeira', async () => {
    const primeira = await listarTemplates(donoId, perfilId)
    expect(primeira.map((t) => t.titulo)).toEqual([
      'Saudação',
      'Pagamento confirmado',
      'Código de rastreio',
      'Aguardando pagamento',
      'Pedido a caminho',
    ])
    expect(await listarTemplates(donoId, perfilId)).toHaveLength(5)
  })

  it('atalho repetido na mesma loja é recusado', async () => {
    await listarTemplates(donoId, perfilId)
    await expect(
      criarTemplate(donoId, perfilId, { titulo: 'Outro', atalho: 'rastreio', texto: 'x' }),
    ).rejects.toBeInstanceOf(AtalhoRepetidoError)
  })

  it('preenche cliente, loja, pedido, código e link pelo telefone da conversa', async () => {
    const templates = await listarTemplates(donoId, perfilId)
    const rastreio = templates.find((t) => t.atalho === 'rastreio')!

    const texto = await aplicarTemplate(donoId, conversaComTelefone, rastreio.id)

    const envio = await prisma.shipment.findFirstOrThrow({ where: { perfilId } })
    expect(texto).toBe(
      `Fulana, o código de rastreio do seu pedido é ${envio.codigoRastreio}. ` +
        `Acompanhe por aqui: https://app.martinslog.net/r/${envio.codigoRastreio}`,
    )

    const personalizado = await criarTemplate(donoId, perfilId, {
      titulo: 'Tudo',
      atalho: null,
      texto: '{{loja}} | {{pedido}} | {{cliente}}',
    })
    expect(await aplicarTemplate(donoId, conversaComTelefone, personalizado.id)).toBe(
      'Loja Bonita | PED-777 | Fulana',
    )
  })

  it('conversa @lid sem telefone: variáveis vazias, sem {{ }} sobrando e sem pedido alheio', async () => {
    const templates = await listarTemplates(donoId, perfilId)
    const caminho = templates.find((t) => t.atalho === 'caminho')!

    const texto = await aplicarTemplate(donoId, conversaLid, caminho.id)

    expect(texto).not.toContain('{{')
    expect(texto).not.toContain('PED-777')
    expect(texto).toContain('Boa notícia')
  })

  it('conversa de outra conta responde como inexistente', async () => {
    const [primeiro] = await listarTemplates(donoId, perfilId)
    await expect(aplicarTemplate(estranhoId, conversaComTelefone, primeiro!.id)).rejects.toBeInstanceOf(
      NaoAutorizadoError,
    )
    await expect(listarTemplates(estranhoId, perfilId)).rejects.toBeInstanceOf(NaoAutorizadoError)
  })
})

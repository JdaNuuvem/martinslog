import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { NaoAutorizadoError } from '@/domain/errors'
import { criarUsuarioComSaldo } from '@/test/factories'
import {
  conversaDaConta,
  listarConversasCaixa,
  listarLojas,
  listarMensagens,
} from './caixa-service'

/**
 * A caixa de entrada vista pela tela.
 *
 * Sem Evolution nenhuma: `credenciaisDoServidor` é nulo na suíte, então a
 * importação inicial não dispara e o que se testa é só a leitura.
 */

const usuariosCriados: string[] = []
let donoId = ''
let estranhoId = ''
let perfilId = ''
let conversaCarla = ''

beforeAll(async () => {
  const dono = await criarUsuarioComSaldo(0)
  const estranho = await criarUsuarioComSaldo(0)
  usuariosCriados.push(dono.id, estranho.id)
  donoId = dono.id
  estranhoId = estranho.id

  // A primeira loja não está pareada; a caixa sem perfilId deve pular para a segunda.
  await prisma.perfil.create({ data: { userId: dono.id, nome: `sem-celular-${Date.now()}` } })
  const perfil = await prisma.perfil.create({
    data: { userId: dono.id, nome: `caixa-${Date.now()}`, nomeExibicao: 'Loja Pareada' },
  })
  perfilId = perfil.id
  await prisma.evolutionConfig.create({
    data: {
      perfilId,
      instancia: `loja-${perfilId}`,
      conectadoEm: new Date(),
      sincronizadoEm: new Date(),
      numero: '5511900001111',
    },
  })

  const agora = Date.now()
  const carla = await prisma.conversa.create({
    data: { perfilId, jid: '100@lid', nomeContato: 'Carla', ultimaMensagemEm: new Date(agora - 1000) },
  })
  conversaCarla = carla.id
  await prisma.conversaMensagem.createMany({
    data: [
      { conversaId: carla.id, autor: 'CLIENTE', texto: 'oi', ocorridoEm: new Date(agora - 3000) },
      {
        conversaId: carla.id,
        autor: 'CLIENTE',
        texto: 'Quero TROCAR o tamanho',
        ocorridoEm: new Date(agora - 2000),
      },
      {
        conversaId: carla.id,
        autor: 'CLIENTE',
        tipo: 'AUDIO',
        midiaMimetype: 'audio/ogg',
        midiaDuracao: 5,
        ocorridoEm: new Date(agora - 1000),
      },
    ],
  })

  await prisma.conversa.create({
    data: {
      perfilId,
      jid: '5511977778888@s.whatsapp.net',
      telefone: '5511977778888',
      nomeContato: 'Diego',
      ultimaMensagemEm: new Date(agora),
    },
  })

  // Volume para a segunda página.
  await prisma.conversa.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      perfilId,
      jid: `${900000 + i}@lid`,
      ultimaMensagemEm: new Date(agora - 100_000 - i * 1000),
    })),
  })
})

afterAll(async () => {
  await prisma.perfil.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('lojas e conversas', () => {
  it('lista as lojas com nome de exibição e estado do celular', async () => {
    const lojas = await listarLojas(donoId)
    expect(lojas).toHaveLength(2)
    expect(lojas[1]).toEqual({
      perfilId,
      nome: expect.stringMatching(/^Loja Pareada \(caixa-\d+\)$/),
      conectado: true,
      numero: '5511900001111',
    })
  })

  it('sem perfilId usa a loja pareada, pagina 50 por vez e segue pelo cursor', async () => {
    const primeira = await listarConversasCaixa(donoId, {})
    expect(primeira.conversas).toHaveLength(50)
    expect(primeira.conversas[0]?.nome).toBe('Diego')
    expect(primeira.conversas[1]).toMatchObject({ jid: '100@lid', telefone: null, previaTipo: 'TEXTO' })
    expect(primeira.proximoCursor).not.toBeNull()

    const segunda = await listarConversasCaixa(donoId, { cursor: primeira.proximoCursor })
    expect(segunda.conversas).toHaveLength(2)
    expect(segunda.proximoCursor).toBeNull()

    const ids = new Set([...primeira.conversas, ...segunda.conversas].map((c) => c.id))
    expect(ids.size).toBe(52)
  })

  it('busca casa o texto das mensagens, sem diferenciar maiúsculas', async () => {
    const { conversas } = await listarConversasCaixa(donoId, { perfilId, busca: 'trocar o tam' })
    expect(conversas.map((c) => c.nome)).toEqual(['Carla'])
  })

  it('busca casa nome e telefone', async () => {
    expect((await listarConversasCaixa(donoId, { perfilId, busca: 'dieg' })).conversas).toHaveLength(1)
    expect((await listarConversasCaixa(donoId, { perfilId, busca: '97777' })).conversas).toHaveLength(1)
  })

  it('loja de outra conta responde como inexistente', async () => {
    await expect(listarConversasCaixa(estranhoId, { perfilId })).rejects.toBeInstanceOf(NaoAutorizadoError)
    await expect(conversaDaConta(estranhoId, conversaCarla)).rejects.toBeInstanceOf(NaoAutorizadoError)
    await expect(listarMensagens(estranhoId, conversaCarla, {})).rejects.toBeInstanceOf(NaoAutorizadoError)
    expect((await listarConversasCaixa(estranhoId, {})).conversas).toEqual([])
  })
})

describe('mensagens', () => {
  it('devolve as mais recentes em ordem crescente e pagina para trás', async () => {
    const recentes = await listarMensagens(donoId, conversaCarla, { limite: 2 })
    expect(recentes.temMais).toBe(true)
    expect(recentes.mensagens.map((m) => m.texto)).toEqual(['Quero TROCAR o tamanho', null])

    const audio = recentes.mensagens[1]!
    expect(audio.midia).toEqual({
      url: `/api/whatsapp/mensagens/${audio.id}/midia`,
      mimetype: 'audio/ogg',
      nome: null,
      tamanho: null,
      duracao: 5,
    })
    expect(recentes.mensagens[0]?.midia).toBeNull()

    const antigas = await listarMensagens(donoId, conversaCarla, {
      antesDe: recentes.mensagens[0]!.id,
      limite: 2,
    })
    expect(antigas).toMatchObject({ temMais: false })
    expect(antigas.mensagens.map((m) => m.texto)).toEqual(['oi'])

    const novas = await listarMensagens(donoId, conversaCarla, { depoisDe: antigas.mensagens[0]!.ocorridoEm })
    expect(novas.mensagens).toHaveLength(2)
  })
})

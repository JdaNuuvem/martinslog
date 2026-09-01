import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import { FakeEmailProvider } from '@/infra/email/fake'
import { emailProvider } from '@/infra/email'
import {
  conectarEmail,
  desconectarEmail,
  enviarAtualizacao,
  listarEnvios,
  obterConfigEmail,
} from './email-service'

const fake = emailProvider as FakeEmailProvider

let contador = 0
const usuariosCriados: string[] = []

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = 'chave-de-teste-com-mais-de-32-caracteres'
})

async function criarUsuario(): Promise<string> {
  contador += 1
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `${Date.now()}${contador}`.slice(-11),
      nome: 'Conta Teste E-mail',
      email: `email-cfg-${Date.now()}-${contador}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

function atualizacao(userId: string, shipmentId: string, evento = 'POSTADO') {
  return {
    userId,
    shipmentId,
    destinatarioEmail: 'destinatario@teste.com',
    codigoRastreio: 'EC000000014BR',
    evento,
    titulo: 'Objeto postado',
    descricao: 'Sua encomenda saiu da loja',
    cidade: 'São Paulo',
    uf: 'SP',
    urlRastreio: 'http://localhost:3200/r/EC000000014BR',
  }
}

afterAll(async () => {
  await prisma.emailDelivery.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.emailConfig.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('conectarEmail', () => {
  it('nunca devolve a chave, só a dica', async () => {
    const userId = await criarUsuario()

    const salvo = await conectarEmail(userId, {
      apiKey: 're_umaChaveSecreta_1234',
      remetente: 'Loja <pedidos@sualoja.com.br>',
    })

    const serializado = JSON.stringify(salvo)
    expect(serializado).not.toContain('umaChaveSecreta')
    expect(salvo.dicaChave).toBe('re_u••••1234')
  })

  it('grava a chave cifrada, nunca em texto puro', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, {
      apiKey: 're_chaveEmTextoPuro_9999',
      remetente: 'pedidos@sualoja.com.br',
    })

    // O ponto do teste: quem obtiver um dump do banco não encontra a chave.
    const linha = await prisma.emailConfig.findUniqueOrThrow({ where: { userId } })
    expect(linha.apiKeyCifrada).not.toContain('chaveEmTextoPuro')
    expect(linha.apiKeyCifrada.split(':')).toHaveLength(4)
  })

  it('recusa remetente que não é e-mail', async () => {
    const userId = await criarUsuario()

    await expect(
      conectarEmail(userId, { apiKey: 're_x', remetente: 'não é e-mail' }),
    ).rejects.toThrow(ValorInvalidoError)
  })

  it('aceita remetente com nome, no formato que o Resend espera', async () => {
    const userId = await criarUsuario()

    await expect(
      conectarEmail(userId, { apiKey: 're_x', remetente: 'Loja Martins <envios@loja.com.br>' }),
    ).resolves.toMatchObject({ remetente: 'Loja Martins <envios@loja.com.br>' })
  })

  it('reconectar substitui a chave anterior em vez de duplicar', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_primeira_1111', remetente: 'a@loja.com.br' })
    await conectarEmail(userId, { apiKey: 're_segunda_2222', remetente: 'b@loja.com.br' })

    const config = await obterConfigEmail(userId)
    expect(config?.dicaChave).toBe('re_s••••2222')
    expect(await prisma.emailConfig.count({ where: { userId } })).toBe(1)
  })
})

describe('desconectarEmail', () => {
  it('apaga a chave, em vez de só desligar', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })

    await desconectarEmail(userId)

    // Desligar sem apagar deixaria o segredo do cliente parado no banco.
    expect(await prisma.emailConfig.count({ where: { userId } })).toBe(0)
    expect(await obterConfigEmail(userId)).toBeNull()
  })
})

describe('enviarAtualizacao', () => {
  it('não envia nada para conta sem Resend conectado', async () => {
    const userId = await criarUsuario()
    fake.enviados.length = 0

    expect(await enviarAtualizacao(atualizacao(userId, `envio-${Date.now()}`))).toBe(false)
    expect(fake.enviados).toHaveLength(0)
  })

  it('envia com a chave e o remetente da conta', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, {
      apiKey: 're_chaveDaConta_5678',
      remetente: 'Loja <pedidos@loja.com.br>',
    })
    fake.enviados.length = 0

    const enviado = await enviarAtualizacao(atualizacao(userId, `envio-${Date.now()}`))

    expect(enviado).toBe(true)
    const saiu = fake.enviados.at(-1)!
    expect(saiu.chaveApi).toBe('re_chaveDaConta_5678')
    expect(saiu.remetente).toBe('Loja <pedidos@loja.com.br>')
    expect(saiu.email.assunto).toContain('EC000000014BR')
  })

  it('não repete o mesmo evento do mesmo envio', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })
    const shipmentId = `envio-${Date.now()}-repetido`
    fake.enviados.length = 0

    // A sincronização roda a cada leitura do rastreio: sem a trava, o
    // destinatário receberia o mesmo aviso a cada visita à página.
    expect(await enviarAtualizacao(atualizacao(userId, shipmentId))).toBe(true)
    expect(await enviarAtualizacao(atualizacao(userId, shipmentId))).toBe(false)
    expect(fake.enviados).toHaveLength(1)
  })

  it('envios concorrentes do mesmo evento mandam um e-mail só', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })
    const shipmentId = `envio-${Date.now()}-corrida`
    fake.enviados.length = 0

    const resultados = await Promise.all(
      Array.from({ length: 4 }, () => enviarAtualizacao(atualizacao(userId, shipmentId))),
    )

    expect(resultados.filter(Boolean)).toHaveLength(1)
    expect(fake.enviados).toHaveLength(1)
  })

  it('eventos diferentes do mesmo envio são enviados', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })
    const shipmentId = `envio-${Date.now()}-varios`
    fake.enviados.length = 0

    await enviarAtualizacao(atualizacao(userId, shipmentId, 'POSTADO'))
    await enviarAtualizacao(atualizacao(userId, shipmentId, 'ENTREGUE'))

    expect(fake.enviados).toHaveLength(2)
  })

  it('escapa marcação no texto, que é escrito pelo dono da conta', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })
    fake.enviados.length = 0

    await enviarAtualizacao({
      ...atualizacao(userId, `envio-${Date.now()}-xss`),
      titulo: '<script>alert(1)</script>',
    })

    // Quem escreve o texto do fluxo não pode injetar marcação no e-mail de
    // quem recebe.
    const saiu = fake.enviados.at(-1)!
    expect(saiu.email.html).not.toContain('<script>')
    expect(saiu.email.html).toContain('&lt;script&gt;')
  })

  it('falha do provedor não derruba a operação, e fica registrada', async () => {
    const userId = await criarUsuario()
    await conectarEmail(userId, { apiKey: 're_x_1234', remetente: 'a@loja.com.br' })
    const shipmentId = `envio-${Date.now()}-falha`
    fake.enviados.length = 0
    fake.falharCom = new Error('Resend fora do ar')

    // E-mail é um extra do envio: uma falha aqui não pode quebrar a emissão
    // nem a consulta que disparou o aviso.
    await expect(enviarAtualizacao(atualizacao(userId, shipmentId))).resolves.toBe(false)

    fake.falharCom = null

    const envios = await listarEnvios(userId)
    expect(envios[0]?.status).toBe('FALHOU')
    expect(envios[0]?.erro).toContain('Resend fora do ar')
  })
})

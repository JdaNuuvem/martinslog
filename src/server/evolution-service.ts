import { prisma } from '@/infra/db/client'
import { DomainError, NaoAutorizadoError } from '@/domain/errors'
import { acharPerfil } from '@/server/perfil-service'
import { credenciaisDoServidor } from '@/infra/whatsapp'
import { env } from '@/env'

/**
 * Ciclo de vida de uma instância da Evolution, por loja.
 *
 * A Evolution é uma instalação só, atendendo todas as lojas. O que separa uma
 * da outra é a instância — um celular pareado por QR. Por isso a `apikey` é do
 * servidor e nunca de uma loja: quem tem a chave manda por QUALQUER instância.
 *
 * Nada aqui expõe a chave para o navegador. A tela pede o QR, e é o servidor
 * que vai buscá-lo.
 */

const TIMEOUT_MS = 20_000

export class EvolutionIndisponivelError extends DomainError {
  readonly codigo = 'EVOLUTION_INDISPONIVEL'
  constructor() {
    super('A Evolution não está configurada neste servidor. Avise quem cuida da instalação.')
  }
}

export class EvolutionRecusouError extends DomainError {
  readonly codigo = 'EVOLUTION_RECUSOU'
}

export class EvolutionSemRespostaError extends DomainError {
  readonly codigo = 'EVOLUTION_SEM_RESPOSTA'
}

async function chamar<T>(
  caminho: string,
  init: { metodo: 'GET' | 'POST' | 'DELETE'; corpo?: unknown },
): Promise<T> {
  const servidor = credenciaisDoServidor()
  if (!servidor) throw new EvolutionIndisponivelError()

  const controle = new AbortController()
  const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS)

  try {
    const resposta = await fetch(`${servidor.baseUrl}${caminho}`, {
      method: init.metodo,
      headers: { 'content-type': 'application/json', apikey: servidor.apiKey },
      body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
      signal: controle.signal,
    })

    const corpo = (await resposta.json().catch(() => null)) as T | null

    if (!resposta.ok) {
      throw new EvolutionRecusouError(
        `A Evolution recusou a operação (HTTP ${resposta.status}).`,
      )
    }
    return corpo as T
  } catch (erro) {
    if (erro instanceof DomainError) throw erro
    throw new EvolutionSemRespostaError('A Evolution não respondeu. Tente de novo.')
  } finally {
    clearTimeout(alarme)
  }
}

/**
 * Nome da instância a partir do perfil.
 *
 * Deriva do id em vez de deixar a loja escolher: o nome é único no SERVIDOR
 * inteiro, não na conta. Nome livre viraria colisão entre duas lojas que se
 * chamam "loja1" — e a segunda passaria a mandar pelo celular da primeira.
 */
function nomeDaInstancia(perfilId: string): string {
  return `loja-${perfilId}`
}

export type ConexaoEvolution = {
  instancia: string
  numero: string | null
  conectadoEm: Date | null
  ultimoErro: string | null
  /** `open` é pareado; qualquer outro valor pede QR de novo. */
  estado: string | null
  /** `data:image/png;base64,...` enquanto o pareamento não acontece. */
  qrcode: string | null
}

type RespostaInstancia = {
  instance?: { instanceName?: string; state?: string; status?: string }
  qrcode?: { base64?: string }
  base64?: string
  state?: string
}

/**
 * Estado atual da conexão da loja, com QR quando ainda falta parear.
 *
 * Faz upsert da instância na primeira chamada: quem abre a tela quer o QR, e
 * exigir um clique em "criar instância" antes de mostrá-lo só adiciona um
 * passo que não decide nada.
 */
export async function obterConexao(
  userId: string,
  perfilId: string,
): Promise<ConexaoEvolution | null> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
  if (!credenciaisDoServidor()) return null

  const instancia = nomeDaInstancia(perfilId)
  const local = await prisma.evolutionConfig.findUnique({ where: { perfilId } })

  let estado: string | null = null
  let qrcode: string | null = null

  const status = await chamar<RespostaInstancia>(
    `/instance/connectionState/${encodeURIComponent(instancia)}`,
    { metodo: 'GET' },
  ).catch(() => null)

  estado = status?.instance?.state ?? status?.state ?? null

  if (estado !== 'open') {
    /*
      `connect` devolve o QR de uma instância que existe. Quando ela ainda não
      existe, a Evolution responde 404 e aí é a hora de criar — nesta ordem,
      para não recriar instância a cada abertura de tela e derrubar um
      pareamento que estava de pé.
    */
    const conexao = await chamar<RespostaInstancia>(
      `/instance/connect/${encodeURIComponent(instancia)}`,
      { metodo: 'GET' },
    ).catch(() => null)

    qrcode = conexao?.base64 ?? conexao?.qrcode?.base64 ?? null

    if (!qrcode) {
      const criada = await chamar<RespostaInstancia>('/instance/create', {
        metodo: 'POST',
        corpo: {
          instanceName: instancia,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          ...(env.EVOLUTION_WEBHOOK_TOKEN && process.env.APP_URL
            ? {
                webhook: {
                  url: `${process.env.APP_URL}/api/evolution/webhook/${env.EVOLUTION_WEBHOOK_TOKEN}`,
                  byEvents: false,
                  events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
                },
              }
            : {}),
        },
      }).catch(() => null)

      qrcode = criada?.qrcode?.base64 ?? criada?.base64 ?? null
    }
  }

  const registro = await prisma.evolutionConfig.upsert({
    where: { perfilId },
    create: {
      perfilId,
      instancia,
      conectadoEm: estado === 'open' ? new Date() : null,
    },
    update: {
      // Só carimba quando ABRE. Sobrescrever com null a cada consulta apagaria
      // a informação de que a loja já esteve conectada alguma vez.
      ...(estado === 'open' ? { conectadoEm: local?.conectadoEm ?? new Date() } : {}),
    },
  })

  return {
    instancia: registro.instancia,
    numero: registro.numero,
    conectadoEm: registro.conectadoEm,
    ultimoErro: registro.ultimoErro,
    estado,
    qrcode,
  }
}

/**
 * Desliga a instância da loja.
 *
 * Apaga na Evolution além do banco: instância órfã continua com o celular
 * pareado, e um celular pareado é um WhatsApp que ainda pode mandar mensagem
 * em nome da loja.
 */
export async function desconectar(userId: string, perfilId: string): Promise<void> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')

  const instancia = nomeDaInstancia(perfilId)
  await chamar(`/instance/logout/${encodeURIComponent(instancia)}`, { metodo: 'DELETE' }).catch(
    () => null,
  )
  await chamar(`/instance/delete/${encodeURIComponent(instancia)}`, { metodo: 'DELETE' }).catch(
    () => null,
  )
  await prisma.evolutionConfig.deleteMany({ where: { perfilId } })
}

/**
 * Troca o provedor de WhatsApp da loja.
 *
 * Não desliga o outro: durante uma migração as duas credenciais convivem, e
 * derrubar a antiga ao escolher a nova deixaria a loja sem canal se a nova
 * não funcionasse.
 */
export async function escolherProvedor(
  userId: string,
  perfilId: string,
  provedor: 'META' | 'EVOLUTION',
): Promise<void> {
  if (!(await acharPerfil(userId, perfilId))) throw new NaoAutorizadoError('Perfil não encontrado.')
  await prisma.perfil.update({ where: { id: perfilId }, data: { whatsappProvedor: provedor } })
}

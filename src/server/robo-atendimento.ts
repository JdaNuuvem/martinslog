import { prisma } from '@/infra/db/client'

/**
 * Robô de atendimento da loja.
 *
 * Responde o que a plataforma sabe de verdade: onde está o pedido. É a
 * pergunta que o comprador faz em quase toda conversa, e a única que um bot
 * genérico não consegue responder — ele não tem o rastreio.
 *
 * Deliberadamente burro fora disso. Um robô que tenta responder tudo acaba
 * inventando prazo e prometendo o que a loja não cumpre; quando não sabe, ele
 * diz que vai chamar alguém e cala a boca, que é o comportamento honesto.
 */

/** Quanto texto do comprador vale a pena olhar. O resto é desabafo. */
const LIMITE_ANALISE = 400

const SAUDACOES = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'oie']

const PEDE_RASTREIO = [
  'cade',
  'cadê',
  'rastrei',
  'onde esta',
  'onde está',
  'chegou',
  'entrega',
  'pedido',
  'encomenda',
  'chega quando',
  'prazo',
  'codigo',
  'código',
]

const QUER_HUMANO = ['atendente', 'humano', 'pessoa', 'falar com alguem', 'falar com alguém']

/** Como cada status soa para quem está esperando a encomenda. */
const COMO_EXPLICAR: Record<string, string> = {
  PENDING: 'ainda não foi pago',
  RELEASED: 'foi pago e está sendo preparado',
  GENERATED: 'está com a etiqueta pronta, aguardando a postagem',
  POSTED: 'já foi postado e está a caminho',
  DELIVERED: 'consta como entregue',
  CANCELLED: 'foi cancelado',
  LOST: 'está sendo investigado pela transportadora',
}

function normalizar(texto: string): string {
  return texto
    .slice(0, LIMITE_ANALISE)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function contem(texto: string, termos: string[]): boolean {
  const alvo = normalizar(texto)
  return termos.some((t) => alvo.includes(normalizar(t)))
}

export type RespostaDoRobo =
  | { tipo: 'responder'; texto: string }
  /** O robô sabe que não sabe. A conversa fica para um humano. */
  | { tipo: 'chamar-humano'; texto: string }
  /** Nada a dizer — nem toda mensagem precisa de resposta automática. */
  | { tipo: 'calar' }

/**
 * Os envios daquele telefone, do mais novo para o mais antigo.
 *
 * Busca pelo telefone dentro do JSON do destinatário porque é a única ponte
 * entre quem escreve no WhatsApp e o envio: o comprador não tem login, e o
 * número dele é o que a loja informou ao criar a etiqueta.
 */
async function enviosDoTelefone(perfilId: string, contato: string) {
  const digitos = contato.replace(/\D/g, '')
  // Sem o 55 e sem o nono dígito: a loja pode ter cadastrado de qualquer
  // um dos jeitos, e comparar só a forma exata acharia menos do que existe.
  const semPais = digitos.startsWith('55') ? digitos.slice(2) : digitos
  const finalDoNumero = semPais.slice(-8)

  return prisma.shipment.findMany({
    where: {
      perfilId,
      destinatario: { path: ['telefone'], string_contains: finalDoNumero },
    },
    orderBy: { criadoEm: 'desc' },
    take: 3,
    select: { codigoRastreio: true, status: true, criadoEm: true, referenciaExterna: true },
  })
}

function descrever(envio: {
  codigoRastreio: string | null
  status: string
  referenciaExterna: string | null
}): string {
  const situacao = COMO_EXPLICAR[envio.status] ?? 'está em andamento'
  const pedido = envio.referenciaExterna ? `Pedido ${envio.referenciaExterna}: ` : ''
  const rastreio = envio.codigoRastreio
    ? ` O código de rastreio é ${envio.codigoRastreio}.`
    : ''
  return `${pedido}seu envio ${situacao}.${rastreio}`
}

/**
 * O que o robô responde a uma mensagem.
 *
 * Puro de propósito na decisão, com uma única ida ao banco para buscar o
 * envio: assim dá para testar cada caminho sem simular WhatsApp nenhum.
 */
export async function responder(entrada: {
  perfilId: string
  contato: string
  texto: string
  nomeLoja: string
}): Promise<RespostaDoRobo> {
  const { texto, nomeLoja } = entrada

  if (contem(texto, QUER_HUMANO)) {
    return {
      tipo: 'chamar-humano',
      texto: `Certo! Já estou chamando alguém da ${nomeLoja} para falar com você. É só aguardar aqui.`,
    }
  }

  if (contem(texto, PEDE_RASTREIO)) {
    const envios = await enviosDoTelefone(entrada.perfilId, entrada.contato)

    if (envios.length === 0) {
      /*
        Não achar envio não quer dizer que não existe: pode ter sido comprado
        com outro telefone. Prometer que "não há pedido" seria afirmar mais do
        que se sabe, então isto vira caso de humano.
      */
      return {
        tipo: 'chamar-humano',
        texto:
          'Não encontrei nenhum envio no seu número por aqui. Vou chamar alguém da equipe para verificar com você.',
      }
    }

    const linhas = envios.map((e) => `• ${descrever(e)}`).join('\n')
    return {
      tipo: 'responder',
      texto: `Achei ${envios.length === 1 ? 'seu envio' : `${envios.length} envios`}:\n${linhas}\n\nPrecisa de mais alguma coisa?`,
    }
  }

  if (contem(texto, SAUDACOES)) {
    return {
      tipo: 'responder',
      texto: `Olá! Aqui é o atendimento da ${nomeLoja}. Posso verificar o andamento do seu pedido — é só me dizer "cadê meu pedido".`,
    }
  }

  /*
    Fora do que ele sabe, o robô não arrisca. Chamar um humano é uma resposta
    pior que a certa e muito melhor que a inventada.
  */
  return {
    tipo: 'chamar-humano',
    texto: 'Não tenho certeza sobre isso. Vou chamar alguém da equipe para te ajudar.',
  }
}

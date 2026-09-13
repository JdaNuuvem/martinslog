/**
 * Chamadas tipadas das rotas `/api/whatsapp/*`.
 *
 * Os tipos espelham o contrato combinado com o backend, nome por nome. Nenhum
 * componente faz `fetch` direto: se o contrato mudar, muda aqui e o
 * TypeScript aponta cada tela que precisa acompanhar.
 */

export type TipoMensagem = 'TEXTO' | 'AUDIO' | 'IMAGEM' | 'VIDEO' | 'DOCUMENTO' | 'FIGURINHA' | 'OUTRO'
export type StatusMensagem = 'ENVIANDO' | 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'ERRO'
export type AutorMensagem = 'CLIENTE' | 'ROBO' | 'ATENDENTE'

export type Loja = { perfilId: string; nome: string; conectado: boolean; numero: string | null }

export type ResumoConversa = {
  id: string
  jid: string
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  ultimaMensagemEm: string
  previa: string | null
  previaTipo: TipoMensagem
  naoLidas: number
  roboPausado: boolean
}

export type Midia = {
  url: string
  mimetype: string
  nome: string | null
  tamanho: number | null
  duracao: number | null
}

export type Mensagem = {
  id: string
  autor: AutorMensagem
  tipo: TipoMensagem
  texto: string | null
  midia: Midia | null
  status: StatusMensagem
  erro: string | null
  ocorridoEm: string
}

export type Template = { id: string; titulo: string; atalho: string | null; texto: string; ordem: number }
export type DadosTemplate = Omit<Template, 'id'>

export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(url, { cache: 'no-store', ...init })
  } catch {
    throw new ErroApi('SEM_CONEXAO', 'Sem conexão com o servidor. Verifique a internet.', 0)
  }
  const corpo = (await resposta.json().catch(() => null)) as unknown
  if (!resposta.ok) {
    const erro = (corpo ?? {}) as { codigo?: string; mensagem?: string }
    throw new ErroApi(
      erro.codigo ?? `HTTP_${resposta.status}`,
      erro.mensagem ?? 'Não foi possível concluir. Tente de novo.',
      resposta.status,
    )
  }
  return corpo as T
}

function json(metodo: string, corpo: unknown): RequestInit {
  return { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }
}

function consulta(params: Record<string, string | number | undefined | null>): string {
  const busca = new URLSearchParams()
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') busca.set(chave, String(valor))
  }
  const texto = busca.toString()
  return texto ? `?${texto}` : ''
}

const base = '/api/whatsapp'
const idUrl = (id: string) => encodeURIComponent(id)

export const api = {
  listarLojas: () => pedir<{ lojas: Loja[] }>(`${base}/lojas`),

  listarConversas: (p: { perfilId: string; busca?: string; cursor?: string | null }) =>
    pedir<{ conversas: ResumoConversa[]; proximoCursor: string | null }>(
      `${base}/conversas${consulta({ perfilId: p.perfilId, busca: p.busca, cursor: p.cursor })}`,
    ),

  listarMensagens: (conversaId: string, p: { antesDe?: string; depoisDe?: string; limite?: number } = {}) =>
    pedir<{ mensagens: Mensagem[]; temMais: boolean }>(
      `${base}/conversas/${idUrl(conversaId)}/mensagens${consulta({ ...p, limite: p.limite ?? 50 })}`,
    ),

  enviarTexto: (conversaId: string, texto: string) =>
    pedir<{ mensagem: Mensagem }>(`${base}/conversas/${idUrl(conversaId)}/mensagens`, json('POST', { texto })),

  enviarArquivo: (conversaId: string, arquivo: File, legenda: string) => {
    const form = new FormData()
    form.set('arquivo', arquivo)
    if (legenda.trim()) form.set('legenda', legenda)
    return pedir<{ mensagem: Mensagem }>(`${base}/conversas/${idUrl(conversaId)}/mensagens`, {
      method: 'POST',
      body: form,
    })
  },

  enviarAudio: (conversaId: string, audio: Blob, nomeArquivo: string, duracao: number) => {
    const form = new FormData()
    form.set('audio', audio, nomeArquivo)
    // Campo extra, fora do contrato mínimo: áudio gravado em webm costuma sair
    // sem duração no cabeçalho, e só quem gravou sabe quanto tempo foi.
    form.set('duracao', String(Math.round(duracao)))
    return pedir<{ mensagem: Mensagem }>(`${base}/conversas/${idUrl(conversaId)}/mensagens`, {
      method: 'POST',
      body: form,
    })
  },

  marcarLida: (conversaId: string) =>
    pedir<{ ok: true }>(`${base}/conversas/${idUrl(conversaId)}/lida`, { method: 'POST' }),

  alternarRobo: (conversaId: string, acao: 'assumir' | 'devolver-ao-robo') =>
    pedir<{ ok: true; roboPausadoAte: string | null }>(
      `${base}/conversas/${idUrl(conversaId)}`,
      json('PATCH', { acao }),
    ),

  sincronizar: (perfilId: string) =>
    pedir<{ conversas: number; mensagens: number }>(`${base}/sincronizar${consulta({ perfilId })}`, {
      method: 'POST',
    }),

  listarTemplates: (perfilId: string) =>
    pedir<{ templates: Template[] }>(`${base}/templates${consulta({ perfilId })}`),

  criarTemplate: (perfilId: string, dados: DadosTemplate) =>
    pedir<{ template: Template }>(`${base}/templates${consulta({ perfilId })}`, json('POST', dados)),

  atualizarTemplate: (id: string, dados: DadosTemplate) =>
    pedir<{ template: Template }>(`${base}/templates/${idUrl(id)}`, json('PUT', dados)),

  excluirTemplate: (id: string) =>
    pedir<{ ok: true }>(`${base}/templates/${idUrl(id)}`, { method: 'DELETE' }),

  aplicarTemplate: (conversaId: string, templateId: string) =>
    pedir<{ texto: string }>(
      `${base}/conversas/${idUrl(conversaId)}/aplicar-template`,
      json('POST', { templateId }),
    ),
}

export function mensagemDeErro(erro: unknown): string {
  return erro instanceof ErroApi ? erro.message : 'Algo deu errado. Tente de novo.'
}

import { EVENTOS_MENSAGEM, acharEvento, type EventoMensagem } from './eventos'

/**
 * Mensagens prontas para o WhatsApp, e a tradução delas para o formato que a
 * Meta aceita no cadastro.
 *
 * ISTO É O QUE MUDA TUDO NO CANAL OFICIAL: o texto não vive aqui, vive
 * aprovado na Meta. Um editor de texto livre — escrever a mensagem e ela sair —
 * é como funciona uma integração não-oficial, por leitura de QR code. Na Cloud
 * API o corpo é cadastrado antes, revisado por eles, e só então pode ser usado;
 * o que mandamos em cada disparo são apenas os VALORES das variáveis.
 *
 * E a Meta não conhece nome de variável. Ela numera: 1, 2, 3. Quem cadastra
 * precisa lembrar qual número era qual campo, e errar a ordem manda o código de
 * rastreio no lugar do nome do cliente — a Meta aceita, porque para ela são só
 * textos em sequência.
 *
 * Este arquivo existe para essa ordem nunca ser digitada por ninguém. O texto é
 * escrito uma vez com nomes, e a numeração é DERIVADA dele: o que o lojista
 * cola na Meta e o que o nosso disparo preenche saem da mesma fonte e não têm
 * como divergir.
 */

export type TextoPronto = {
  evento: string
  /** Nome do template na Meta. Só minúsculas, números e `_` — regra deles. */
  nome: string
  /** Escrito com variáveis nomeadas. É a fonte; o resto se deriva daqui. */
  corpo: string
}

/**
 * Os textos.
 *
 * Escritos para caber no que cada momento realmente sabe: `PEDIDO_PAGO` não
 * promete código de rastreio porque ele ainda não existe, e `ETIQUETA_EMITIDA`
 * não repete "pagamento confirmado" porque isso já foi dito.
 */
export const TEXTOS_PADRAO_WHATSAPP: TextoPronto[] = [
  {
    evento: 'PEDIDO_PENDENTE',
    nome: 'pedido_pendente',
    corpo:
      'Oi, {{cliente}}! Seu pedido de {{valor}} na {{loja}} está separado, mas o pagamento ainda não entrou. ' +
      'Para finalizar é por aqui: {{link_checkout}} — assim que cair, a gente já prepara seu envio.',
  },
  {
    evento: 'PEDIDO_PAGO',
    nome: 'pedido_pago',
    corpo:
      'Olá, {{cliente}}! Confirmamos seu pagamento de {{valor}} na {{loja}}. ' +
      'Já estamos preparando seu pedido e você recebe o código de rastreio assim que a etiqueta for emitida.',
  },
  {
    evento: 'ETIQUETA_EMITIDA',
    nome: 'etiqueta_emitida',
    corpo:
      'Olá, {{cliente}}! Seu pedido na {{loja}} já tem código de rastreio: {{codigo_rastreio}}. ' +
      'Acompanhe por aqui: {{link_rastreio}} — atualizamos a cada novo movimento.',
  },
  {
    evento: 'POSTADO',
    nome: 'pedido_postado',
    corpo:
      'Olá, {{cliente}}! Seu pedido na {{loja}} foi postado e está a caminho. ' +
      'Código {{codigo_rastreio}}, acompanhe em {{link_rastreio}} para ver cada atualização.',
  },
  {
    evento: 'SAIU_PARA_ENTREGA',
    nome: 'saiu_para_entrega',
    corpo:
      'Olá, {{cliente}}! Seu pedido na {{loja}} saiu para entrega hoje. Se puder, deixe alguém no endereço. ' +
      'Código {{codigo_rastreio}}, acompanhe em {{link_rastreio}} até a chegada.',
  },
  {
    evento: 'TENTATIVA_FRUSTRADA',
    nome: 'tentativa_frustrada',
    corpo:
      'Olá, {{cliente}}! Tentamos entregar seu pedido da {{loja}} e não encontramos ninguém no endereço. ' +
      'Uma nova tentativa será feita. Código {{codigo_rastreio}}, detalhes em {{link_rastreio}} para conferir.',
  },
  {
    evento: 'AGUARDANDO_RETIRADA',
    nome: 'aguardando_retirada',
    corpo:
      'Olá, {{cliente}}! Seu pedido da {{loja}} está aguardando retirada na unidade. ' +
      'Código {{codigo_rastreio}}, endereço e prazo em {{link_rastreio}} — passado o prazo ele volta para a loja.',
  },
  {
    evento: 'ENTREGUE',
    nome: 'pedido_entregue',
    corpo:
      'Olá, {{cliente}}! Seu pedido da {{loja}} foi entregue. ' +
      'Código {{codigo_rastreio}}, comprovante em {{link_rastreio}}. Obrigado pela compra!',
  },
]

/** Acha as variáveis na ordem em que aparecem, sem repetir. */
function chavesNaOrdem(corpo: string): string[] {
  const ordem: string[] = []
  for (const achado of corpo.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    const chave = achado[1]!
    if (!ordem.includes(chave)) ordem.push(chave)
  }
  return ordem
}

export type ParaCadastro = {
  evento: EventoMensagem
  nome: string
  idioma: string
  categoria: 'UTILITY' | 'MARKETING'
  /** O corpo numerado — exatamente o que se cola no formulário da Meta. */
  corpo: string
  /** A ordem das variáveis. É ela que o disparo usa para preencher. */
  variaveis: string[]
  /** Um exemplo por variável, na mesma ordem. A Meta exige no cadastro. */
  exemplos: string[]
  /** Como o comprador vê, com os exemplos aplicados. */
  previa: string
}

/**
 * Traduz um texto pronto para o cadastro na Meta.
 *
 * As três saídas — corpo numerado, ordem das variáveis e exemplos — saem da
 * mesma leitura do texto. É o que impede o erro de ordem: não há um segundo
 * lugar onde a numeração possa ser digitada diferente.
 */
export function paraCadastro(texto: TextoPronto, idioma = 'pt_BR'): ParaCadastro {
  const evento = acharEvento(texto.evento)
  if (!evento) {
    throw new Error(`Texto pronto aponta para evento inexistente: ${texto.evento}`)
  }

  const variaveis = chavesNaOrdem(texto.corpo)

  const desconhecidas = variaveis.filter((c) => !evento.variaveis.some((v) => v.chave === c))
  if (desconhecidas.length > 0) {
    /*
      Uma variável que o evento não tem sairia sempre vazia: o disparo preenche
      pelo catálogo do evento, e o que não está lá não tem de onde vir. O
      lojista veria a mensagem aprovada e chegando com um buraco no meio.
    */
    throw new Error(
      `O texto de ${texto.evento} usa variáveis que o evento não oferece: ${desconhecidas.join(', ')}.`,
    )
  }

  let corpo = texto.corpo
  variaveis.forEach((chave, indice) => {
    corpo = corpo.replace(new RegExp(`\\{\\{\\s*${chave}\\s*\\}\\}`, 'g'), `{{${indice + 1}}}`)
  })

  const exemplos = variaveis.map((chave) => evento.variaveis.find((v) => v.chave === chave)!.exemplo)

  let previa = corpo
  exemplos.forEach((exemplo, indice) => {
    previa = previa.split(`{{${indice + 1}}}`).join(exemplo)
  })

  return {
    evento,
    nome: texto.nome,
    idioma,
    categoria: evento.categoria,
    corpo,
    variaveis,
    exemplos,
    previa,
  }
}

export type Recusa = { regra: string; motivo: string }

/**
 * As regras da Meta que fazem um cadastro ser recusado.
 *
 * Recusa lá custa uma ida e volta de horas, e a resposta não diz qual regra foi
 * quebrada. Conferir aqui é barato e transforma isso numa linha na tela — antes
 * de enviar, não depois.
 */
export function conferirRegrasDaMeta(cadastro: ParaCadastro): Recusa[] {
  const recusas: Recusa[] = []
  const corpo = cadastro.corpo.trim()

  if (!/^[a-z0-9_]+$/.test(cadastro.nome)) {
    recusas.push({
      regra: 'nome',
      motivo: 'O nome do template só aceita minúsculas, números e underscore.',
    })
  }

  if (/^\s*\{\{\d+\}\}/.test(cadastro.corpo)) {
    recusas.push({ regra: 'comeco', motivo: 'O corpo não pode começar com variável.' })
  }

  if (/\{\{\d+\}\}\s*$/.test(cadastro.corpo)) {
    recusas.push({ regra: 'fim', motivo: 'O corpo não pode terminar com variável.' })
  }

  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(corpo)) {
    recusas.push({
      regra: 'coladas',
      motivo: 'Duas variáveis seguidas, sem texto entre elas, são recusadas.',
    })
  }

  if (corpo.length > 1024) {
    recusas.push({ regra: 'tamanho', motivo: 'O corpo passa de 1024 caracteres.' })
  }

  // Uma variável sem exemplo trava o formulário de cadastro.
  if (cadastro.exemplos.length !== cadastro.variaveis.length) {
    recusas.push({ regra: 'exemplos', motivo: 'Falta exemplo para alguma variável.' })
  }

  return recusas
}

/** Os textos prontos, já traduzidos. É o que a tela mostra. */
export function catalogoPronto(idioma = 'pt_BR'): ParaCadastro[] {
  return TEXTOS_PADRAO_WHATSAPP.map((t) => paraCadastro(t, idioma))
}

/** Eventos sem texto pronto, para a tela não fingir que cobre tudo. */
export function eventosSemTextoPronto(): string[] {
  return EVENTOS_MENSAGEM.filter(
    (e) => !TEXTOS_PADRAO_WHATSAPP.some((t) => t.evento === e.codigo),
  ).map((e) => e.codigo)
}

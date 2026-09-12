import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * Cifra de CAMPO: para dado pessoal guardado em coluna e lido em massa.
 *
 * Existe ao lado de `segredo.ts`, e não no lugar dele, porque os dois resolvem
 * problemas diferentes. `segredo.ts` guarda a chave de API de terceiro de cada
 * conta — poucas, lidas raramente — e deriva uma chave nova por valor com
 * scrypt. Isso custa ~59 ms por chamada e BLOQUEIA O EVENT LOOP. Para uma
 * coluna de CPF lida página a página e exportada aos milhares, o servidor
 * inteiro pararia de responder enquanto um admin abre a tela.
 *
 * Aqui a chave é derivada UMA vez e reusada; cada valor ganha um IV aleatório.
 * É o desenho padrão de cifra de campo, e a segurança é a mesma que importa: o
 * texto cifrado é autenticado (GCM), e sem `SECRET_ENCRYPTION_KEY` nada é lido.
 *
 * O que se deixa de ter é o sal por valor, que protege uma senha humana fraca
 * contra ataque pré-computado. A chave mestra tem 32+ caracteres e já vive na
 * memória do processo, então esse sal não compraria proteção nenhuma aqui.
 */

const ALGORITMO = 'aes-256-gcm'
const TAMANHO_IV = 12
const TAMANHO_ETIQUETA = 16

/** Versão do formato. Muda se o desenho mudar, para os valores antigos serem reconhecidos. */
const VERSAO = 'c1'

/**
 * Sal fixo de domínio.
 *
 * Não é segredo e não precisa ser: ele separa a chave derivada aqui de
 * qualquer outra derivada da mesma `SECRET_ENCRYPTION_KEY` com outro
 * propósito. Trocar este texto torna ilegível todo valor já cifrado.
 */
const SAL_DE_DOMINIO = 'frete:cifra-de-campo:v1'

let chaveEmCache: { segredo: string; chave: Buffer } | null = null

/**
 * A chave derivada, calculada uma vez por valor do segredo.
 *
 * O cache é por VALOR do segredo, e não por processo: se o ambiente trocar a
 * variável (os testes fazem isso), a chave é derivada de novo em vez de seguir
 * usando uma velha em silêncio.
 */
function chave(): Buffer {
  const segredo = process.env.SECRET_ENCRYPTION_KEY

  if (!segredo || segredo.length < 32) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela, dado pessoal não pode ser guardado cifrado.',
    )
  }

  if (chaveEmCache?.segredo === segredo) return chaveEmCache.chave

  const derivada = scryptSync(segredo, SAL_DE_DOMINIO, 32)
  chaveEmCache = { segredo, chave: derivada }
  return derivada
}

/** Cifra um valor. A saída carrega versão, IV, etiqueta e conteúdo, separados por `:`. */
export function cifrarCampo(texto: string): string {
  const iv = randomBytes(TAMANHO_IV)
  const cifra = createCipheriv(ALGORITMO, chave(), iv, { authTagLength: TAMANHO_ETIQUETA })

  const conteudo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const etiqueta = cifra.getAuthTag()

  return [VERSAO, iv.toString('hex'), etiqueta.toString('hex'), conteudo.toString('hex')].join(':')
}

/**
 * Decifra o que `cifrarCampo` produziu.
 *
 * Valor adulterado, formato desconhecido ou etiqueta encurtada lançam — nunca
 * devolvem lixo. O tamanho da etiqueta é EXIGIDO: por padrão o GCM aceita
 * etiquetas mais curtas, e cada byte a menos facilita forjar um valor.
 */
export function decifrarCampo(cifrado: string): string {
  const partes = cifrado.split(':')

  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new Error('Valor cifrado em formato desconhecido.')
  }

  const [, ivHex, etiquetaHex, conteudoHex] = partes

  if (etiquetaHex!.length !== TAMANHO_ETIQUETA * 2) {
    throw new Error('Etiqueta de autenticação com tamanho inválido.')
  }

  const decifra = createDecipheriv(ALGORITMO, chave(), Buffer.from(ivHex!, 'hex'), {
    authTagLength: TAMANHO_ETIQUETA,
  })
  decifra.setAuthTag(Buffer.from(etiquetaHex!, 'hex'))

  return Buffer.concat([
    decifra.update(Buffer.from(conteudoHex!, 'hex')),
    decifra.final(),
  ]).toString('utf8')
}

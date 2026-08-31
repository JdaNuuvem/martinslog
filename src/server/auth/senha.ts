import { hash, hashSync, verify } from '@node-rs/argon2'

/**
 * Hash e verificação de senha com argon2id. Nunca use MD5, SHA ou bcrypt
 * improvisado — argon2id é o algoritmo exigido para credenciais nesta
 * plataforma.
 *
 * `algorithm: 2` corresponde a `Algorithm.Argon2id` de `@node-rs/argon2`.
 * Usamos o literal numérico (em vez do enum) porque o pacote declara
 * `Algorithm` como `const enum` ambiente, inacessível com
 * `isolatedModules: true` (exigido pelo Next.js/SWC).
 */
const ARGON2ID = 2
const OPCOES = { algorithm: ARGON2ID }

export async function hashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES)
}

export async function verificarSenha(hash: string, senha: string): Promise<boolean> {
  return verify(hash, senha, OPCOES)
}

/**
 * Hash argon2id fixo (dummy), usado quando o e-mail informado no login não
 * existe. Verificar a senha contra este hash gasta um tempo semelhante ao de
 * uma verificação real, evitando que a diferença de tempo de resposta revele
 * se o e-mail existe na base (ataque de enumeração por timing).
 */
export const HASH_DUMMY = hashSync('senha-dummy-para-mitigar-timing-attack', OPCOES)

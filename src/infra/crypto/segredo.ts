import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * Cifra de segredos de terceiros guardados por nós — hoje, a chave de API do
 * Resend de cada conta.
 *
 * Guardar chave de terceiro em texto puro transforma um vazamento do banco
 * no comprometimento da conta Resend de todos os clientes: quem obtém a
 * chave envia e-mail em nome deles, com o domínio deles. Cifrar não impede
 * o vazamento do banco, mas impede que ele baste.
 *
 * AES-256-GCM: além de cifrar, autentica. Um valor adulterado no banco falha
 * na decifragem em vez de virar lixo silencioso.
 *
 * A chave mestra vem de `SECRET_ENCRYPTION_KEY` e **nunca** tem valor padrão.
 * Um padrão embutido no código seria o mesmo que não cifrar, porque estaria
 * publicado junto com o repositório.
 */

const ALGORITMO = 'aes-256-gcm'
const TAMANHO_IV = 12
const TAMANHO_SAL = 16

function chaveMestra(sal: Buffer): Buffer {
  const segredo = process.env.SECRET_ENCRYPTION_KEY

  if (!segredo || segredo.length < 32) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela, segredos de terceiros não podem ser guardados com segurança.',
    )
  }

  // Deriva por scrypt em vez de usar a variável direto: uma chave escolhida
  // por humano tem entropia baixa, e a derivação encarece o ataque de força
  // bruta sobre o material cifrado.
  return scryptSync(segredo, sal, 32)
}

/**
 * Cifra um segredo. A saída carrega sal, IV e tag de autenticação junto,
 * separados por `:`, para que a decifragem não dependa de nada guardado à
 * parte — um campo só no banco basta.
 */
export function cifrar(texto: string): string {
  const sal = randomBytes(TAMANHO_SAL)
  const iv = randomBytes(TAMANHO_IV)
  const cifra = createCipheriv(ALGORITMO, chaveMestra(sal), iv)

  const conteudo = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()

  return [sal.toString('hex'), iv.toString('hex'), tag.toString('hex'), conteudo.toString('hex')].join(
    ':',
  )
}

/** Decifra o que `cifrar` produziu. Valor adulterado lança, nunca devolve lixo. */
export function decifrar(cifrado: string): string {
  const partes = cifrado.split(':')
  if (partes.length !== 4) {
    throw new Error('Formato de segredo cifrado inválido.')
  }

  const [salHex, ivHex, tagHex, conteudoHex] = partes as [string, string, string, string]
  const decifra = createDecipheriv(
    ALGORITMO,
    chaveMestra(Buffer.from(salHex, 'hex')),
    Buffer.from(ivHex, 'hex'),
  )
  decifra.setAuthTag(Buffer.from(tagHex, 'hex'))

  return Buffer.concat([
    decifra.update(Buffer.from(conteudoHex, 'hex')),
    decifra.final(),
  ]).toString('utf8')
}

/**
 * Dica visível de uma chave, para a tela confirmar *qual* chave está
 * conectada sem nunca devolver a chave. Mostra o prefixo do provedor e os
 * quatro últimos caracteres — o suficiente para o dono reconhecer a dele.
 */
export function dicaDaChave(chave: string): string {
  const limpa = chave.trim()
  if (limpa.length <= 8) return '••••'
  return `${limpa.slice(0, 4)}••••${limpa.slice(-4)}`
}

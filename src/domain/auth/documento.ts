/**
 * Validação de CPF/CNPJ por dígito verificador e normalização de documentos.
 * Módulo de domínio puro: nenhuma dependência de I/O.
 */

export function normalizarDocumento(doc: string): string {
  return doc.replace(/\D/g, '')
}

function todosDigitosIguais(digitos: string): boolean {
  return digitos.split('').every((d) => d === digitos[0])
}

export function validarCpf(cpf: string): boolean {
  const digitos = normalizarDocumento(cpf)

  if (digitos.length !== 11 || todosDigitosIguais(digitos)) {
    return false
  }

  const numeros = digitos.split('').map(Number)

  function calcularDigito(base: number[]): number {
    let soma = 0
    let multiplicador = base.length + 1
    for (const n of base) {
      soma += n * multiplicador
      multiplicador -= 1
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const digito1 = calcularDigito(numeros.slice(0, 9))
  const digito2 = calcularDigito(numeros.slice(0, 10))

  return digito1 === numeros[9] && digito2 === numeros[10]
}

export function validarCnpj(cnpj: string): boolean {
  const digitos = normalizarDocumento(cnpj)

  if (digitos.length !== 14 || todosDigitosIguais(digitos)) {
    return false
  }

  const numeros = digitos.split('').map(Number)

  function calcularDigito(base: number[]): number {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < base.length; i += 1) {
      soma += (base[i] ?? 0) * (pesos[i] ?? 0)
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const digito1 = calcularDigito(numeros.slice(0, 12))
  const digito2 = calcularDigito(numeros.slice(0, 13))
  const digitoVerificador1 = numeros[12]
  const digitoVerificador2 = numeros[13]

  return digito1 === digitoVerificador1 && digito2 === digitoVerificador2
}

/**
 * CPF com pontos e hífen, a partir dos onze dígitos.
 *
 * Serve à tela e à exportação: na tela, é como o operador reconhece um CPF; no
 * CSV, os dígitos crus o Excel lê como NÚMERO e come o zero à esquerda, enquanto
 * formatado vira texto e sai inteiro.
 */
export function formatarCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`
}

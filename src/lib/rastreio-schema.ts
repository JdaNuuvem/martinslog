import { z } from 'zod'
import { validarCodigoRastreio } from '@/domain/shipment/codigo-rastreio'
import type { CodigoEvento } from '@/domain/simulacao/tipos'

/**
 * Normaliza o que o cliente digita (espaços, hífens, minúsculas) e delega a
 * validação ao domínio, que confere formato e dígito verificador. Assim o
 * campo do formulário rejeita erro de digitação antes da ida ao servidor,
 * sem duplicar a regra do código.
 */
/**
 * Limpa o que de fato chega quando alguém cola um código.
 *
 * `\s` do JavaScript cobre espaço comum, NBSP e BOM — e **não** cobre o que
 * sobrevive a um copiar-colar de mensagem formatada: espaço de largura zero,
 * marca de direção do texto, hífen suave, juntador de palavras. Do mesmo modo,
 * só o hífen ASCII era removido, enquanto o iOS produz travessão por
 * "pontuação inteligente". Cada um desses caracteres invisíveis fazia um
 * código correto receber "esse código não parece válido" — a mensagem que
 * devolve ao comprador a culpa por um caractere que ele não vê.
 *
 * A troca de letra por dígito parecida é segura porque o formato é rígido: duas
 * letras, nove dígitos, `BR`. `O` no lugar de zero, `I` no lugar de um e `S`
 * no lugar de cinco só são trocados no MEIO, onde só pode haver dígito — o
 * prefixo e o `BR` do fim ficam intocados.
 */
function limpar(bruto: string): string {
  const semInvisivel = bruto
    .replace(/[\s­​-‏⁠﻿]/g, '')
    .replace(/[-‐-―−]/g, '')
    .toUpperCase()

  // Sobra só letra e dígito: ponto final colado, aspas curvas e parênteses
  // saem aqui.
  const soAlfanumerico = semInvisivel.replace(/[^A-Z0-9]/g, '')

  const partes = /^([A-Z]{2})([A-Z0-9]{9})(BR)$/.exec(soAlfanumerico)
  if (!partes) return soAlfanumerico

  const meio = partes[2]!.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5')
  return `${partes[1]}${meio}${partes[3]}`
}

export const codigoRastreioSchema = z
  .string()
  .trim()
  .transform(limpar)
  .refine(validarCodigoRastreio, 'Código de rastreio inválido')

export type EventoRastreio = {
  sequencia: number
  codigo: CodigoEvento | string
  /** Linha destacada da timeline; a descrição é o texto de apoio. */
  titulo: string
  descricao: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  cidade: string
  uf: string
  ocorridoEm: string
}

export type RastreioResposta = {
  codigoRastreio: string
  /** Derivado do último evento já ocorrido — nunca do campo escrito à mão. */
  status: string
  servico: string
  prazoDias: number
  criadoEm: string
  eventos: EventoRastreio[]
}

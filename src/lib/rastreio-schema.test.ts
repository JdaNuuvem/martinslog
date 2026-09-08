import { describe, expect, it } from 'vitest'
import { codigoRastreioSchema } from './rastreio-schema'

/**
 * O que de fato chega no campo de rastreio.
 *
 * O comprador não digita o código: ele cola o pedaço da mensagem. E o que vem
 * colado de um SMS ou de um WhatsApp carrega caracteres que ninguém vê —
 * espaço de largura zero, marca de direção, hífen suave — além de travessão
 * onde havia hífen, porque o iOS troca por "pontuação inteligente".
 *
 * Cada um deles fazia um código CORRETO ser recusado com "esse código não
 * parece válido", que devolve ao comprador a culpa por um caractere invisível.
 * Estes casos existem para que essa recusa não volte.
 */

const VALIDO = 'EC000008137BR'

describe('normalização do código colado', () => {
  const aceitos: [string, string][] = [
    ['exatamente como é', VALIDO],
    ['minúsculo', 'ec000008137br'],
    ['com espaços', 'EC 000008137 BR'],
    ['com hífen ASCII', 'EC-00000813-7BR'],
    ['com espaço duro', 'EC 000008137 BR'],
    ['com BOM na frente', '﻿EC000008137BR'],
    ['com quebra de linha no fim', 'EC000008137BR\n'],
    ['com espaço de largura zero', 'EC​000008137​BR'],
    ['com marca de direção do texto', '‎EC000008137BR'],
    ['com hífen suave', 'EC­000008137BR'],
    ['com juntador de palavras', 'EC⁠000008137BR'],
    ['com hífen não-quebrável', 'EC‑000008137‑BR'],
    ['com travessão do iOS', 'EC–000008137—BR'],
    ['entre aspas curvas', '“EC000008137BR”'],
    ['com ponto final colado', 'EC000008137BR.'],
    ['com letra O no lugar do zero', 'ECOOOOO8137BR'],
    ['com letra I no lugar do um', 'EC00000８137BR'.replace('８', '8').replace('1', 'I')],
  ]

  for (const [nome, entrada] of aceitos) {
    it(`aceita ${nome}`, () => {
      const r = codigoRastreioSchema.safeParse(entrada)
      expect(r.success, `recusou: ${JSON.stringify(entrada)}`).toBe(true)
      if (r.success) expect(r.data).toBe(VALIDO)
    })
  }

  /*
    A limpeza não pode virar adivinhação. Um código com dígito verificador
    errado continua sendo recusado — é assim que o campo pega erro de digitação
    antes de gastar uma consulta.
  */
  const recusados: [string, string][] = [
    ['dígito verificador errado', 'EC000008131BR'],
    ['dígitos a menos', 'EC00000813BR'],
    ['sufixo errado', 'EC000008137US'],
    ['vazio', ''],
    ['só texto', 'meu pedido'],
  ]

  for (const [nome, entrada] of recusados) {
    it(`recusa ${nome}`, () => {
      expect(codigoRastreioSchema.safeParse(entrada).success).toBe(false)
    })
  }
})

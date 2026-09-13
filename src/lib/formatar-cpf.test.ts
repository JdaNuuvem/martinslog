import { describe, expect, it } from 'vitest'
import { formatarCpf } from './formatar-cpf'

describe('formatarCpf', () => {
  it('põe pontos e hífen nos onze dígitos', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25')
  })

  it('preserva o zero à esquerda', () => {
    expect(formatarCpf('01234567890')).toBe('012.345.678-90')
  })
})

import { describe, expect, it } from 'vitest'
import { escalasDaRota, hubDaUf } from './corredor'

const rotulo = (locais: { cidade: string; uf: string }[]) =>
  locais.map((l) => `${l.cidade}/${l.uf}`)

describe('escalasDaRota', () => {
  it('sobe o litoral do Ceará ao Rio Grande do Sul sem atravessar a Amazônia', () => {
    const escalas = escalasDaRota({ cidade: 'Fortaleza', uf: 'CE' }, { cidade: 'Porto Alegre', uf: 'RS' }, 4)

    expect(escalas.length).toBeGreaterThan(0)
    expect(rotulo(escalas)).not.toContain('Manaus/AM')
    expect(rotulo(escalas)).not.toContain('Rio Branco/AC')
  })

  it('devolve as escalas na ordem da viagem, e não na de proximidade da reta', () => {
    const escalas = escalasDaRota({ cidade: 'Fortaleza', uf: 'CE' }, { cidade: 'Porto Alegre', uf: 'RS' }, 4)

    // Indo para o sul, cada escala fica mais ao sul que a anterior.
    const latitudes = escalas.map((escala) => hubDaUf(escala.uf)!.lat)
    const decrescente = latitudes.every((lat, i) => i === 0 || lat <= latitudes[i - 1]!)

    expect(decrescente).toBe(true)
  })

  it('inverte a ordem quando a viagem é no sentido contrário', () => {
    const subindo = escalasDaRota({ cidade: 'Fortaleza', uf: 'CE' }, { cidade: 'Porto Alegre', uf: 'RS' }, 3)
    const descendo = escalasDaRota({ cidade: 'Porto Alegre', uf: 'RS' }, { cidade: 'Fortaleza', uf: 'CE' }, 3)

    expect(rotulo(descendo)).toEqual([...rotulo(subindo)].reverse())
  })

  it('não inventa escala em trecho curto', () => {
    expect(escalasDaRota({ cidade: 'Santos', uf: 'SP' }, { cidade: 'Campinas', uf: 'SP' }, 3)).toEqual([])
    expect(escalasDaRota({ cidade: 'Niterói', uf: 'RJ' }, { cidade: 'São Paulo', uf: 'SP' }, 3)).toEqual([])
  })

  it('respeita o número de escalas pedido', () => {
    const uma = escalasDaRota({ cidade: 'Fortaleza', uf: 'CE' }, { cidade: 'Porto Alegre', uf: 'RS' }, 1)
    const nenhuma = escalasDaRota({ cidade: 'Fortaleza', uf: 'CE' }, { cidade: 'Porto Alegre', uf: 'RS' }, 0)

    expect(uma).toHaveLength(1)
    expect(nenhuma).toEqual([])
  })

  it('não passa pela origem nem pelo destino como se fossem escala', () => {
    const escalas = escalasDaRota({ cidade: 'Sobral', uf: 'CE' }, { cidade: 'Caxias do Sul', uf: 'RS' }, 5)

    expect(rotulo(escalas)).not.toContain('Fortaleza/CE')
    expect(rotulo(escalas)).not.toContain('Porto Alegre/RS')
  })

  it('sem hub para a UF, não arrisca palpite', () => {
    expect(escalasDaRota({ cidade: 'Lisboa', uf: 'XX' }, { cidade: 'Porto Alegre', uf: 'RS' }, 3)).toEqual([])
  })

  it('atravessa o país de leste a oeste passando pelo centro', () => {
    const escalas = escalasDaRota({ cidade: 'Recife', uf: 'PE' }, { cidade: 'Cuiabá', uf: 'MT' }, 3)

    expect(escalas.length).toBeGreaterThan(0)
    // Nada de descer até o Sul para ir do Nordeste ao Centro-Oeste.
    expect(rotulo(escalas)).not.toContain('Porto Alegre/RS')
    expect(rotulo(escalas)).not.toContain('Florianópolis/SC')
  })
})

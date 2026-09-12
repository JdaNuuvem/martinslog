import { ViaCepProvider } from './viacep'
import { BrasilApiProvider } from './brasilapi'
import { GeoComReserva } from './com-reserva'
import { FakeGeoProvider } from './fake'
import { GeoProvider } from './provider'

/**
 * ViaCEP na frente, BrasilAPI como reserva. O porquê da ordem e de cada
 * desfecho está em `com-reserva.ts`; em resumo, o ViaCEP devolve logradouro e
 * bairro (que a reserva deixa nulos nos CEPs de cidade inteira), e a reserva
 * cobre o buraco do ViaCEP nos CEPs gerais de município.
 */
const geoProvider: GeoProvider =
  process.env.NODE_ENV === 'test'
    ? new FakeGeoProvider()
    : new GeoComReserva(new ViaCepProvider(), new BrasilApiProvider())

export type { GeoProvider, EnderecoCep } from './provider'
export { ViaCepProvider } from './viacep'
export { BrasilApiProvider } from './brasilapi'
export { GeoComReserva } from './com-reserva'
export { FakeGeoProvider } from './fake'
export { geoProvider }

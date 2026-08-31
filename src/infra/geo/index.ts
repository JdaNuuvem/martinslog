import { ViaCepProvider } from './viacep'
import { FakeGeoProvider } from './fake'
import { GeoProvider } from './provider'

const geoProvider: GeoProvider = process.env.NODE_ENV === 'test' ? new FakeGeoProvider() : new ViaCepProvider()

export { GeoProvider, EnderecoCep } from './provider'
export { ViaCepProvider } from './viacep'
export { FakeGeoProvider } from './fake'
export { geoProvider }

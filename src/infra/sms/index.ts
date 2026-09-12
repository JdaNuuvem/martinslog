import { FakeSmsProvider } from './fake'
import type { SmsProvider } from './provider'
import { ProvedorRegistrado } from './registrado'
import { SmsDevProvider } from './smsdev'

/**
 * Fornecedores que sabemos falar.
 *
 * A chave é o valor de `SMS_PROVEDOR` no ambiente, e é a mesma que fica
 * gravada em `MensagemEnvio.provedor` — assim o histórico diz por onde a
 * mensagem saiu mesmo depois de uma troca de fornecedor.
 */
const CATALOGO: Record<string, () => SmsProvider> = {
  smsdev: () => new SmsDevProvider(),
}

function escolher(): SmsProvider {
  if (process.env.NODE_ENV === 'test') return new FakeSmsProvider()

  const nome = (process.env.SMS_PROVEDOR ?? '').trim().toLowerCase()
  const construir = CATALOGO[nome]

  /*
    Nome desconhecido cai no registrado, e não estoura. Derrubar a aplicação
    inteira por causa de uma variável de ambiente errada trocaria uma
    notificação que não sai por um site que não abre — e o histórico registra
    `registrado`, que denuncia a configuração sem custar o produto.
  */
  return construir ? construir() : new ProvedorRegistrado()
}

/**
 * Provedor de SMS ativo.
 *
 * Em teste é sempre o falso — nenhuma suíte deve mandar mensagem de verdade
 * nem depender de rede. Fora de teste, e enquanto não houver fornecedor
 * contratado, é o que registra no log: o canal inteiro roda e só a última
 * milha não sai.
 *
 * Trocar de fornecedor é acrescentar uma classe que implemente `SmsProvider`
 * e apontá-la aqui. Nada fora desta pasta sabe qual é — foi para isso que a
 * interface existe, já que a escolha do provedor ainda está em aberto.
 */
export const smsProvider: SmsProvider = escolher()

export type { SmsProvider, SmsParaEnviar, ResultadoSms, CredenciaisSms } from './provider'
export { FakeSmsProvider } from './fake'
export { ProvedorRegistrado } from './registrado'
export { SmsDevProvider } from './smsdev'

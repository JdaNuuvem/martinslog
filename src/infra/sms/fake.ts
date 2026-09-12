import type { CredenciaisSms, ResultadoSms, SmsParaEnviar, SmsProvider } from './provider'

export type SmsCapturado = { para: string; texto: string; credenciais: CredenciaisSms }

/**
 * Provedor de teste. Guarda o que seria enviado, para a suíte conferir o
 * conteúdo em vez de apenas o fato de ter chamado.
 *
 * `falharProxima` existe porque o caminho de falha é o que menos se testa e o
 * que mais quebra: sem uma forma de provocar recusa, a retentativa e o
 * registro de erro nunca são exercidos.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly nome = 'fake'

  readonly enviados: SmsCapturado[] = []
  falharProxima: { mensagem: string; retentavel: boolean } | null = null

  async enviar(credenciais: CredenciaisSms, sms: SmsParaEnviar): Promise<ResultadoSms> {
    if (this.falharProxima) {
      const falha = this.falharProxima
      this.falharProxima = null
      return { ok: false, mensagem: falha.mensagem, retentavel: falha.retentavel, codigo: 'FAKE' }
    }

    this.enviados.push({ para: sms.para, texto: sms.texto, credenciais })
    return { ok: true, idExterno: `fake-${this.enviados.length}` }
  }

  limpar(): void {
    this.enviados.length = 0
    this.falharProxima = null
  }
}

import type { EmailParaEnviar, EmailProvider, ResultadoEnvio } from './provider'

/**
 * Provedor de e-mail para os testes: guarda o que seria enviado em memória e
 * não faz nenhuma requisição. Assim a suíte nunca depende de rede nem gasta
 * cota de ninguém.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly enviados: { chaveApi: string; remetente: string; email: EmailParaEnviar }[] = []
  falharCom: Error | null = null

  async enviar(
    chaveApi: string,
    remetente: string,
    email: EmailParaEnviar,
  ): Promise<ResultadoEnvio> {
    if (this.falharCom) throw this.falharCom
    this.enviados.push({ chaveApi, remetente, email })
    return { id: `fake-${this.enviados.length}` }
  }
}

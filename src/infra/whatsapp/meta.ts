import { enviarTemplate, type ResultadoEnvio } from './cloud-api'
import type { CredenciaisWhatsapp, MensagemWhatsapp, WhatsappProvider } from './provider'

/**
 * A API oficial da Meta, atrás do contrato comum.
 *
 * Só embrulha `cloud-api.ts`, que continua sendo quem fala com a Meta — este
 * arquivo existe para que a escolha do provedor caiba em um `switch` e não
 * espalhe `if (provedor === ...)` pelo serviço.
 */
export class MetaProvider implements WhatsappProvider {
  readonly nome = 'meta'

  async enviar(
    credenciais: CredenciaisWhatsapp,
    mensagem: MensagemWhatsapp,
  ): Promise<ResultadoEnvio> {
    if (credenciais.tipo !== 'META') {
      return {
        ok: false,
        codigo: null,
        mensagem: 'Credencial da Meta esperada, veio outra.',
        retentavel: false,
        statusHttp: null,
      }
    }

    if (!mensagem.template) {
      /*
        Fora da janela de 24h a Meta só aceita template aprovado — texto livre
        é recusado. Chegar aqui sem template significa que a loja trocou de
        provedor e os textos da Evolution não têm equivalente aprovado. Não é
        retentável: repetir não aprova template nenhum.
      */
      return {
        ok: false,
        codigo: null,
        mensagem:
          'A API oficial exige um template aprovado pela Meta, e este evento não tem um.',
        retentavel: false,
        statusHttp: null,
      }
    }

    return enviarTemplate({
      phoneNumberId: credenciais.phoneNumberId,
      token: credenciais.token,
      para: mensagem.para,
      nomeTemplate: mensagem.template.nome,
      idioma: mensagem.template.idioma,
      parametros: mensagem.template.parametros,
    })
  }
}

import type { CredenciaisSms, ResultadoSms, SmsParaEnviar, SmsProvider } from './provider'

/**
 * Provedor que grava a mensagem no log em vez de enviá-la.
 *
 * Existe para o canal poder ser ligado e observado **antes** de haver
 * contrato com fornecedor nenhum. O caminho inteiro roda de verdade — a
 * mensagem é montada, enfileirada, o texto é composto com os dados do envio e
 * o histórico registra o resultado. Só a última milha não sai.
 *
 * Isso muda o que se descobre no dia da troca. Com um provedor de mentira que
 * apenas responde "ok", o primeiro texto errado, telefone malformado ou
 * variável vazia só aparece quando já está custando dinheiro por mensagem.
 * Aqui eles aparecem no log, de graça.
 *
 * Nunca é o provedor ativo em produção: `index.ts` só o escolhe quando não há
 * fornecedor configurado, e o histórico marca por onde a mensagem saiu.
 */
export class ProvedorRegistrado implements SmsProvider {
  readonly nome = 'registrado'

  async enviar(_credenciais: CredenciaisSms, sms: SmsParaEnviar): Promise<ResultadoSms> {
    console.info('[sms:registrado] mensagem não enviada — nenhum provedor configurado', {
      para: sms.para,
      caracteres: sms.texto.length,
      /*
        O texto vai truncado. Ele carrega o nome do comprador e o código de
        rastreio dele, e log de produção costuma ir parar em ferramenta de
        terceiro — registrar a mensagem inteira transformaria diagnóstico em
        vazamento de dado de cliente.
      */
      inicio: sms.texto.slice(0, 40),
    })

    return { ok: true, idExterno: `registrado-${Date.now()}` }
  }
}

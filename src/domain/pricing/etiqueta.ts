/**
 * O que a plataforma cobra para gerar uma etiqueta.
 *
 * O frete continua sendo calculado pela tabela de preço e aparece na
 * etiqueta e no rastreio — é o valor do serviço de transporte. Ele **não é**
 * o que sai da carteira: o cliente paga um valor fixo por etiqueta gerada, e
 * é esse valor que vira lançamento no extrato.
 *
 * Os dois números vivem separados em `Shipment` (`precoFreteCentavos` e
 * `precoCobradoCentavos`) porque respondem a perguntas diferentes: quanto o
 * transporte custaria, e quanto foi debitado. Derivar um do outro exigiria
 * saber a política de preço vigente na data do envio, que é exatamente o que
 * muda com o tempo.
 */
export const PRECO_ETIQUETA_CENTAVOS = 100

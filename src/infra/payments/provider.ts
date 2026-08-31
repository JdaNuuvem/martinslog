/**
 * Cobrança gerada por um provedor de pagamento (Pix). `id` identifica a
 * cobrança junto ao provedor; `qrCode` é o payload a exibir/copiar;
 * `expiraEm` é quando a cobrança deixa de poder ser paga.
 */
export interface CobrancaPix {
  id: string
  qrCode: string
  expiraEm: Date
}

/**
 * Contrato que qualquer provedor de pagamento Pix implementa — simulado
 * hoje, real amanhã. Quem chama `criarCobranca` nunca sabe (nem precisa
 * saber) qual implementação está por trás.
 */
export interface PaymentProvider {
  criarCobranca(valorCentavos: number): Promise<CobrancaPix>
}

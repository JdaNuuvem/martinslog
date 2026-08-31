import { TransicaoInvalidaError } from '../errors'

export type StatusShipment =
  | 'PENDING'
  | 'RELEASED'
  | 'GENERATED'
  | 'POSTED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'LOST'

/**
 * Grafo de transições permitidas do envio.
 *
 * Além do fluxo linear PENDING → RELEASED → GENERATED → POSTED → DELIVERED,
 * a partir de POSTED o envio pode ser extraviado (LOST) — conforme
 * docs/superpowers/specs/2026-08-31-simulacao-transporte.md seção 5, o
 * evento EXTRAVIADO produz o status LOST. A devolução ao remetente
 * (evento DEVOLVIDO) resulta em status DELIVERED (com marcação de
 * devolução tratada fora desta máquina de estados), então não exige
 * status adicional aqui.
 *
 * Até GENERATED o envio pode ser cancelado (CANCELLED). A partir de
 * POSTED o cancelamento não é mais permitido — ver podeCancelar.
 */
export const transicoesValidas: Readonly<Record<StatusShipment, readonly StatusShipment[]>> = {
  PENDING: ['RELEASED', 'CANCELLED'],
  RELEASED: ['GENERATED', 'CANCELLED'],
  GENERATED: ['POSTED', 'CANCELLED'],
  POSTED: ['DELIVERED', 'LOST'],
  DELIVERED: [],
  CANCELLED: [],
  LOST: [],
}

export function garantirTransicao(de: StatusShipment, para: StatusShipment): void {
  const destinosPermitidos = transicoesValidas[de]
  if (!destinosPermitidos.includes(para)) {
    throw new TransicaoInvalidaError(
      `Transição inválida de envio: não é possível ir de ${de} para ${para}`,
    )
  }
}

export function podeCancelar(status: StatusShipment): boolean {
  return status === 'PENDING' || status === 'RELEASED' || status === 'GENERATED'
}

export function deveEstornar(de: StatusShipment, para: StatusShipment): boolean {
  const foiPago = de === 'RELEASED' || de === 'GENERATED' || de === 'POSTED'
  const encerramentoComEstorno = para === 'CANCELLED' || para === 'LOST'
  return foiPago && encerramentoComEstorno
}

import { statusDoEvento } from '@/domain/simulacao/roteiro'
import type { StatusShipment } from '@/domain/shipment/estados'

/**
 * Traduz o código do último evento visível para o status do envio, caindo no
 * status persistido quando o código não tem tradução.
 *
 * O caso coberto é o do **código órfão**: uma etapa que a conta criou, que
 * gerou eventos e depois saiu do catálogo. `statusDoEvento` lança nesse caso,
 * de propósito — é o certo em quem gera a timeline. Em quem a lê, não: numa
 * listagem, deixar a exceção subir derruba a tela inteira por causa de um
 * único envio, e o cliente perde o acesso a tudo. Status atrasado continua
 * verdadeiro; tela em branco não ajuda ninguém.
 *
 * Vive num módulo próprio porque três leituras precisam exatamente da mesma
 * regra — a listagem de rastreio, a de etiquetas e a consulta pública. Regra
 * de tradução duplicada é regra que divergirá.
 */
export function derivarStatusVisivel(
  codigo: string | null | undefined,
  persistido: StatusShipment,
  statusPorCodigo?: Readonly<Record<string, StatusShipment>>,
): StatusShipment {
  if (!codigo) {
    return persistido
  }

  try {
    return statusDoEvento(codigo, statusPorCodigo)
  } catch {
    return persistido
  }
}

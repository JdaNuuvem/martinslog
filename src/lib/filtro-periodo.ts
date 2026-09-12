/**
 * Período dos filtros de lead, lido de parâmetros `aaaa-mm-dd` da URL.
 *
 * Mora aqui, e não dentro da página, porque a tela de leads e a exportação CSV
 * precisam aplicar EXATAMENTE a mesma regra. Se cada uma convertesse a data do
 * seu jeito, o arquivo exportado não bateria com a lista que o admin estava
 * vendo.
 *
 * O fuso é o de Brasília: quem escolhe "30/09" no painel quer dizer o dia 30 no
 * horário da operação, não em UTC. E `fimDoDia` empurra o limite superior para
 * o último instante do dia — sem isso, "até 30/09" pararia na meia-noite e
 * deixaria o próprio dia 30 de fora.
 */
export function dataDoParametro(
  valor: string | null | undefined,
  fimDoDia = false,
): Date | undefined {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined
  const horario = fimDoDia ? '23:59:59.999' : '00:00:00.000'
  const data = new Date(`${valor}T${horario}-03:00`)
  return Number.isNaN(data.getTime()) ? undefined : data
}

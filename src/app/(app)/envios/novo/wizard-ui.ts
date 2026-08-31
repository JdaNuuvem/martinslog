/**
 * Classes e helpers de UI compartilhados entre as etapas do fluxo de novo
 * envio, para não repetir os mesmos literais em cada arquivo de etapa.
 */
export const classeCampo =
  'w-full rounded-lg border border-borda-campo bg-superficie-card px-3 py-2 text-sm text-texto-principal focus:border-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export const classeBotaoPrimario =
  'rounded-pilula bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60'

export const classeBotaoSecundario =
  'rounded-pilula border border-borda-campo px-5 py-2.5 text-sm font-semibold text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

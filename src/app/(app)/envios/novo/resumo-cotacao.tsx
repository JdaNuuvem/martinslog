'use client'

import type { MedidasCotacao, OpcaoCotacaoResposta } from './cotacao-step'
import { formatarReais } from './wizard-ui'

export function formatarCep(cep: string): string {
  const digitos = cep.replace(/\D/g, '')
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : cep
}

/** Dois CEPs são "o mesmo" independentemente de máscara/espaços. */
export function mesmoCep(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\D/g, '') === b.replace(/\D/g, '')
}

function formatarPeso(pesoG: number): string {
  return pesoG >= 1000 ? `${(pesoG / 1000).toLocaleString('pt-BR')} kg` : `${pesoG} g`
}

const ROTULO_FORMATO: Record<MedidasCotacao['formato'], string> = {
  CAIXA: 'Caixa',
  ROLO: 'Rolo',
  ENVELOPE: 'Envelope',
}

/**
 * Resumo do que foi cotado na etapa 1, exibido nas etapas seguintes para o
 * usuário não perder de vista rota, medidas, serviço e preço enquanto
 * escolhe os endereços. É só leitura: a fonte da verdade do preço continua
 * sendo o servidor na etapa de revisão.
 */
export function ResumoCotacao({
  medidas,
  opcao,
  destaque,
}: {
  medidas: MedidasCotacao | null
  opcao: OpcaoCotacaoResposta | null
  destaque?: 'origem' | 'destino'
}) {
  if (!medidas && !opcao) {
    return null
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-superficie-bloco p-4 text-sm sm:grid-cols-4">
      {medidas && (
        <>
          <div className={destaque === 'origem' ? 'rounded-md bg-brand-bg px-2 py-1' : undefined}>
            <dt className="text-xs text-texto-secundario">CEP de origem</dt>
            <dd className="font-semibold text-texto-principal">{formatarCep(medidas.cepOrigem)}</dd>
          </div>
          <div className={destaque === 'destino' ? 'rounded-md bg-brand-bg px-2 py-1' : undefined}>
            <dt className="text-xs text-texto-secundario">CEP de destino</dt>
            <dd className="font-semibold text-texto-principal">{formatarCep(medidas.cepDestino)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-secundario">Peso</dt>
            <dd className="font-semibold text-texto-principal">{formatarPeso(medidas.pesoG)}</dd>
          </div>
          <div>
            <dt className="text-xs text-texto-secundario">Volume</dt>
            <dd className="font-semibold text-texto-principal">
              {medidas.alturaCm} × {medidas.larguraCm} × {medidas.comprimentoCm} cm ·{' '}
              {ROTULO_FORMATO[medidas.formato]}
            </dd>
          </div>
        </>
      )}
      {opcao && (
        <>
          <div className="col-span-2">
            <dt className="text-xs text-texto-secundario">Serviço escolhido</dt>
            <dd className="font-semibold text-texto-principal">
              {opcao.carrierNome} — {opcao.servicoNome} ({opcao.prazoDias} dias úteis)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-secundario">Frete</dt>
            <dd className="font-semibold text-texto-principal">{formatarReais(opcao.precoFinalCentavos)}</dd>
          </div>
        </>
      )}
    </dl>
  )
}

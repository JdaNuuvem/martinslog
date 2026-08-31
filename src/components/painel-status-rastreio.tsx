'use client'

import { ConstrutorTemplateRastreio } from './construtor-template-rastreio'

/**
 * Configuração do rastreio da conta.
 *
 * Tudo acontece no fluxo: o texto de cada etapa, quando ela acontece e quais
 * etapas existem. Antes esta página tinha três superfícies concorrentes — o
 * fluxo, um formulário de status avulso e uma lista de status padrão — e era
 * preciso descobrir qual delas mexia em quê. Um fluxo com nós editáveis diz
 * sozinho o que cada coisa faz, e não há mais um lugar onde o efeito de uma
 * mudança seja invisível.
 */
export function PainelStatusRastreio() {
  return (
    <div className="mx-auto flex max-w-conteudo flex-col gap-6 py-8">
      <header>
        <h1 className="text-2xl font-bold text-texto-principal">Rastreio</h1>
        <p className="mt-1 text-sm text-texto-secundario">
          Monte o percurso que o seu cliente acompanha e escreva o texto de cada etapa.
        </p>
      </header>

      <ConstrutorTemplateRastreio />
    </div>
  )
}

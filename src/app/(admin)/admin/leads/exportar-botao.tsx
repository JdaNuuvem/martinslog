'use client'

import { useState } from 'react'

type Busca = {
  busca?: string
  loja?: string
  origem?: string
  desde?: string
  ate?: string
  pagina?: string
}

/**
 * Link de exportação CSV, com a caixa de "CPF completo".
 *
 * Componente à parte, e cliente, porque a caixa muda o link sem recarregar a
 * página — e a página de leads é um Server Component, que não tem estado.
 */
export function ExportarLeadsBotao({ parametros }: { parametros: Busca }) {
  const [cpfCompleto, setCpfCompleto] = useState(false)

  /*
    Só os filtros da tela — nunca `pagina`, e nunca repassar `cpfCompleto` da
    própria URL da página. Sem essa lista fechada, abrir
    `/admin/leads?cpfCompleto=true` geraria um link de CPF completo com a
    caixa desmarcada: a caixa precisa ser a única forma de ligar isso.
  */
  const query = new URLSearchParams()
  for (const chave of ['busca', 'loja', 'origem', 'desde', 'ate'] as const) {
    const valor = parametros[chave]
    if (valor) query.set(chave, valor)
  }
  if (cpfCompleto) query.set('cpfCompleto', 'true')

  return (
    <div className="flex flex-col items-end gap-1">
      <a
        href={`/api/admin/leads/exportar?${query.toString()}`}
        className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Exportar CSV
      </a>
      <label className="flex items-center gap-2 text-detalhe text-texto-secundario">
        <input
          type="checkbox"
          checked={cpfCompleto}
          onChange={(evento) => setCpfCompleto(evento.currentTarget.checked)}
        />
        incluir CPF completo
      </label>
      <p className="max-w-[16rem] text-right text-detalhe text-texto-secundario">
        O arquivo sai do sistema e não há como recolhê-lo. A exportação fica registrada.
      </p>
    </div>
  )
}

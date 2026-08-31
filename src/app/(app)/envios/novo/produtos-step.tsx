'use client'

import { classeBotaoPrimario, classeBotaoSecundario, classeCampo } from './wizard-ui'

export type ProdutoLinha = {
  nome: string
  quantidade: string
  valorUnitarioReais: string
}

export function novaLinhaProduto(): ProdutoLinha {
  return { nome: '', quantidade: '1', valorUnitarioReais: '' }
}

/** Converte as linhas do formulário (strings) para o formato que `POST /api/envios` espera. */
export function produtosParaEnvio(produtos: ProdutoLinha[]) {
  return produtos
    .filter((p) => p.nome.trim().length > 0)
    .map((p) => ({
      nome: p.nome.trim(),
      quantidade: Math.max(1, Math.round(Number(p.quantidade) || 1)),
      valorUnitarioCentavos: Math.round(Number(p.valorUnitarioReais.replace(',', '.')) * 100) || 0,
    }))
}

type Props = {
  produtos: ProdutoLinha[]
  setProdutos: (atualizar: (atual: ProdutoLinha[]) => ProdutoLinha[]) => void
  onVoltar: () => void
  onContinuar: () => void
}

/** Etapa 4: declaração de conteúdo (produtos, quantidade e valor unitário). */
export function ProdutosStep({ produtos, setProdutos, onVoltar, onContinuar }: Props) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-texto-principal">Declaração de conteúdo</legend>
        {produtos.map((produto, indice) => (
          <div key={indice} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`produto-nome-${indice}`} className="text-xs font-medium text-texto-secundario">
                Produto
              </label>
              <input
                id={`produto-nome-${indice}`}
                className={classeCampo}
                value={produto.nome}
                onChange={(e) =>
                  setProdutos((atual) => atual.map((p, i) => (i === indice ? { ...p, nome: e.target.value } : p)))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`produto-qtd-${indice}`} className="text-xs font-medium text-texto-secundario">
                Quantidade
              </label>
              <input
                id={`produto-qtd-${indice}`}
                type="number"
                min={1}
                className={classeCampo}
                value={produto.quantidade}
                onChange={(e) =>
                  setProdutos((atual) =>
                    atual.map((p, i) => (i === indice ? { ...p, quantidade: e.target.value } : p)),
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`produto-valor-${indice}`} className="text-xs font-medium text-texto-secundario">
                Valor unitário (R$)
              </label>
              <input
                id={`produto-valor-${indice}`}
                className={classeCampo}
                value={produto.valorUnitarioReais}
                onChange={(e) =>
                  setProdutos((atual) =>
                    atual.map((p, i) => (i === indice ? { ...p, valorUnitarioReais: e.target.value } : p)),
                  )
                }
              />
            </div>
            <button
              type="button"
              onClick={() => setProdutos((atual) => atual.filter((_, i) => i !== indice))}
              disabled={produtos.length <= 1}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-erro hover:bg-erro-fundo disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Remover produto ${indice + 1}`}
            >
              Remover
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setProdutos((atual) => [...atual, novaLinhaProduto()])}
          className={`${classeBotaoSecundario} self-start`}
        >
          Adicionar produto
        </button>
      </fieldset>

      <div className="flex justify-between">
        <button type="button" onClick={onVoltar} className={classeBotaoSecundario}>
          Voltar
        </button>
        <button
          type="button"
          disabled={produtosParaEnvio(produtos).length === 0}
          onClick={onContinuar}
          className={classeBotaoPrimario}
        >
          Continuar
        </button>
      </div>
    </section>
  )
}

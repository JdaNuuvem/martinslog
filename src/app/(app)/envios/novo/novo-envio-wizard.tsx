'use client'

import { useState } from 'react'
import type { EnderecoResposta } from '@/lib/endereco-schema'
import { SeletorEndereco } from './endereco-seletor'
import { CotacaoStep } from './cotacao-step'
import { novaLinhaProduto, ProdutosStep, produtosParaEnvio, type ProdutoLinha } from './produtos-step'
import { RevisaoStep } from './revisao-step'
import { classeBotaoPrimario, classeBotaoSecundario } from './wizard-ui'

type Etapa = 'cotacao' | 'remetente' | 'destinatario' | 'produtos' | 'revisao'

const ETAPAS: readonly { chave: Etapa; rotulo: string }[] = [
  { chave: 'cotacao', rotulo: 'Cotação' },
  { chave: 'remetente', rotulo: 'Remetente' },
  { chave: 'destinatario', rotulo: 'Destinatário' },
  { chave: 'produtos', rotulo: 'Produtos' },
  { chave: 'revisao', rotulo: 'Revisão' },
]

/**
 * Fluxo de criação de envio em etapas: cotação → remetente → destinatário
 * → produtos (declaração de conteúdo) → revisão → confirmar. Cada etapa é
 * um componente próprio (`cotacao-step.tsx`, `endereco-seletor.tsx`,
 * `produtos-step.tsx`, `revisao-step.tsx`) — este arquivo só guarda o
 * estado compartilhado entre etapas e decide qual delas está visível. O
 * preço só é lido do servidor (nunca calculado ou enviado pelo cliente): a
 * revisão busca a prévia em `GET /api/envios` e o "Confirmar" manda só
 * `quoteId`/`servicoId`/endereços/produtos para `POST /api/envios`.
 */
export function NovoEnvioWizard({
  quoteIdInicial,
  servicoIdInicial,
}: {
  quoteIdInicial?: string
  servicoIdInicial?: string
}) {
  const [etapa, setEtapa] = useState<Etapa>(quoteIdInicial ? 'remetente' : 'cotacao')

  const [quoteId, setQuoteId] = useState<string | null>(quoteIdInicial ?? null)
  const [servicoId, setServicoId] = useState<string | null>(servicoIdInicial ?? null)

  const [remetente, setRemetente] = useState<EnderecoResposta | null>(null)
  const [destinatario, setDestinatario] = useState<EnderecoResposta | null>(null)

  const [produtos, setProdutos] = useState<ProdutoLinha[]>([novaLinhaProduto()])

  const [envioConcluidoId, setEnvioConcluidoId] = useState<string | null>(null)

  if (envioConcluidoId) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-xl bg-superficie-card p-8 text-center">
        <h1 className="text-xl font-bold text-texto-principal">Envio criado e pago!</h1>
        <p className="text-sm text-texto-secundario">
          O envio <span className="font-mono">{envioConcluidoId}</span> foi confirmado. A etiqueta será
          gerada em seguida.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Etapas" className="flex flex-wrap gap-2 text-xs font-semibold text-texto-secundario">
        {ETAPAS.map(({ chave, rotulo }, indice) => (
          <span
            key={chave}
            aria-current={etapa === chave ? 'step' : undefined}
            className={`rounded-pilula px-3 py-1 ${etapa === chave ? 'bg-brand text-white' : 'bg-superficie-bloco'}`}
          >
            {indice + 1}. {rotulo}
          </span>
        ))}
      </nav>

      {etapa === 'cotacao' && (
        <CotacaoStep
          quoteId={quoteId}
          servicoId={servicoId}
          onQuoteId={setQuoteId}
          onServicoId={setServicoId}
          onContinuar={() => setEtapa('remetente')}
        />
      )}

      {etapa === 'remetente' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <SeletorEndereco tipo="REMETENTE" titulo="Remetente" selecionado={remetente} onSelecionar={setRemetente} />
          <div className="flex justify-between">
            <button type="button" onClick={() => setEtapa('cotacao')} className={classeBotaoSecundario}>
              Voltar
            </button>
            <button
              type="button"
              disabled={!remetente}
              onClick={() => setEtapa('destinatario')}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'destinatario' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <SeletorEndereco
            tipo="DESTINATARIO"
            titulo="Destinatário"
            selecionado={destinatario}
            onSelecionar={setDestinatario}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setEtapa('remetente')} className={classeBotaoSecundario}>
              Voltar
            </button>
            <button
              type="button"
              disabled={!destinatario}
              onClick={() => setEtapa('produtos')}
              className={classeBotaoPrimario}
            >
              Continuar
            </button>
          </div>
        </section>
      )}

      {etapa === 'produtos' && (
        <ProdutosStep
          produtos={produtos}
          setProdutos={setProdutos}
          onVoltar={() => setEtapa('destinatario')}
          onContinuar={() => setEtapa('revisao')}
        />
      )}

      {etapa === 'revisao' && quoteId && servicoId && remetente && destinatario && (
        <RevisaoStep
          quoteId={quoteId}
          servicoId={servicoId}
          remetente={remetente}
          destinatario={destinatario}
          produtos={produtos}
          onVoltar={() => setEtapa('produtos')}
          onConcluido={setEnvioConcluidoId}
        />
      )}
    </div>
  )
}

// Reexportado para quem só precisa montar o corpo de `POST /api/envios`
// fora deste wizard (ex.: testes de integração de outra camada).
export { produtosParaEnvio }

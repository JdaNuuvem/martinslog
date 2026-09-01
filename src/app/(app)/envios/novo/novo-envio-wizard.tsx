'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EnderecoResposta } from '@/lib/endereco-schema'
import { SeletorEndereco } from './endereco-seletor'
import { CotacaoStep, type MedidasCotacao, type OpcaoCotacaoResposta } from './cotacao-step'
import { ResumoCotacao } from './resumo-cotacao'
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
  const router = useRouter()
  const [etapa, setEtapa] = useState<Etapa>(quoteIdInicial ? 'remetente' : 'cotacao')

  const [quoteId, setQuoteId] = useState<string | null>(quoteIdInicial ?? null)
  const [servicoId, setServicoId] = useState<string | null>(servicoIdInicial ?? null)

  /*
    O que foi cotado na etapa 1 continua visível nas etapas seguintes: as
    medidas e o serviço escolhido viram um resumo no topo, e os CEPs guiam a
    escolha dos endereços. Quando o wizard já nasce com `quoteIdInicial`
    (visitante que cotou na home), nada disso existe aqui — o resumo
    simplesmente não aparece.
  */
  const [medidas, setMedidas] = useState<MedidasCotacao | null>(null)
  const [opcao, setOpcao] = useState<OpcaoCotacaoResposta | null>(null)

  /*
    Quem chega com `quoteId` na URL pulou a etapa 1 aqui dentro — cotou na
    home. A cotação é relida do servidor para que as etapas de endereço
    saibam quais CEPs foram cotados e o resumo apareça do mesmo jeito. Se a
    releitura falhar (cotação expirada, de outra sessão), o wizard segue sem
    resumo: quem manda no preço continua sendo a revisão.
  */
  useEffect(() => {
    if (!quoteIdInicial) return

    let cancelado = false
    void (async () => {
      try {
        const resposta = await fetch(`/api/cotacao?quoteId=${encodeURIComponent(quoteIdInicial)}`)
        if (!resposta.ok || cancelado) return
        const { cotacao } = (await resposta.json()) as {
          cotacao: MedidasCotacao & { opcoes: OpcaoCotacaoResposta[] }
        }
        if (cancelado) return

        setMedidas({
          cepOrigem: cotacao.cepOrigem,
          cepDestino: cotacao.cepDestino,
          pesoG: cotacao.pesoG,
          alturaCm: cotacao.alturaCm,
          larguraCm: cotacao.larguraCm,
          comprimentoCm: cotacao.comprimentoCm,
          formato: cotacao.formato,
        })
        const escolhida = cotacao.opcoes.find((o) => o.servicoId === servicoIdInicial)
        if (escolhida) setOpcao(escolhida)
      } catch {
        // Rede fora: sem resumo, o wizard ainda funciona.
      }
    })()

    return () => {
      cancelado = true
    }
  }, [quoteIdInicial, servicoIdInicial])

  const [remetente, setRemetente] = useState<EnderecoResposta | null>(null)
  const [destinatario, setDestinatario] = useState<EnderecoResposta | null>(null)

  const [produtos, setProdutos] = useState<ProdutoLinha[]>([novaLinhaProduto()])

  const [envioConcluidoId, setEnvioConcluidoId] = useState<string | null>(null)

  /*
    Pagou, acabou: o pagamento já emite a etiqueta dentro de `pagarEnvio`
    (`emitirEtiquetaAposPagamento`), então quando o `POST /api/envios`
    responde 201 a etiqueta existe e tem código de rastreio. A tela de
    "criado e pago" que ficava aqui era um beco — o cliente lia que a
    etiqueta "será gerada em seguida" e tinha que ir procurá-la na aba
    Etiquetas por conta própria. Agora ele cai direto nela.

    `replace`, e não `push`: voltar para um wizard cujo envio já foi pago só
    levaria a uma segunda cobrança confusa.
  */
  useEffect(() => {
    if (envioConcluidoId) {
      router.replace(`/etiquetas/${envioConcluidoId}`)
    }
  }, [envioConcluidoId, router])

  if (envioConcluidoId) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-xl bg-superficie-card p-8 text-center">
        <h1 className="text-xl font-bold text-texto-principal">Envio pago e etiqueta gerada!</h1>
        <p className="text-sm text-texto-secundario">Abrindo a etiqueta…</p>
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
          onMedidas={setMedidas}
          onOpcao={(escolhida) => {
            setOpcao(escolhida)
            setServicoId(escolhida.servicoId)
          }}
          onContinuar={() => setEtapa('remetente')}
        />
      )}

      {etapa === 'remetente' && (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <ResumoCotacao medidas={medidas} opcao={opcao} destaque="origem" />
          <SeletorEndereco
            tipo="REMETENTE"
            titulo="Remetente"
            selecionado={remetente}
            onSelecionar={setRemetente}
            cepCotado={medidas?.cepOrigem}
          />
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
          <ResumoCotacao medidas={medidas} opcao={opcao} destaque="destino" />
          <SeletorEndereco
            tipo="DESTINATARIO"
            titulo="Destinatário"
            selecionado={destinatario}
            onSelecionar={setDestinatario}
            cepCotado={medidas?.cepDestino}
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

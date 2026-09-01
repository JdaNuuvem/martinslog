import Link from 'next/link'
import type { ReactNode } from 'react'
import type { OpcaoCotacaoResposta } from '@/lib/cotacao-schema'

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatarPrazo(prazoDias: number): string {
  return prazoDias === 1 ? '1 dia útil' : `${prazoDias} dias úteis`
}

/**
 * Para onde o cartão leva.
 *
 * A cotação da home tem só os dois CEPs e as medidas — falta remetente,
 * destinatário e conteúdo declarado, que ninguém pode adivinhar pelo
 * cliente. Então o clique não paga nada aqui: entrega a cotação já escolhida
 * ao fluxo de envio, que abre direto na etapa de remetente (o wizard pula a
 * etapa de cotação quando recebe `quoteId`) e termina no pagamento em
 * créditos.
 *
 * Visitante não perde a cotação ao entrar: o destino vai como parâmetro para
 * o login, que volta para cá depois de autenticar.
 */
export function destinoDaOpcao(quoteId: string, servicoId: string, autenticado: boolean): string {
  const fluxo = `/envios/novo?quoteId=${encodeURIComponent(quoteId)}&servicoId=${encodeURIComponent(servicoId)}`
  return autenticado ? fluxo : `/login?destino=${encodeURIComponent(fluxo)}`
}

type OpcaoFreteCardProps = {
  opcao: OpcaoCotacaoResposta
  quoteId: string
  autenticado: boolean
  /**
   * Chamado quando um visitante escolhe esta opção. Quem renderiza a lista
   * abre o cadastro sem tirar a cotação da tela; sem o callback, o cartão
   * volta a ser um link para o login.
   */
  aoEscolherComoVisitante?: (destino: string) => void
}

export function OpcaoFreteCard({
  opcao,
  quoteId,
  autenticado,
  aoEscolherComoVisitante,
}: OpcaoFreteCardProps) {
  if (!opcao.disponivel) {
    return (
      <li
        data-testid="opcao-frete"
        data-disponivel="false"
        className="flex flex-col gap-2 rounded-xl bg-superficie-bloco p-4 opacity-60 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-semibold text-texto-secundario">{opcao.servicoNome}</p>
          <p className="text-sm text-texto-secundario">{opcao.carrierNome}</p>
          {opcao.observacao ? <p className="mt-1 text-sm text-texto-secundario">{opcao.observacao}</p> : null}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-texto-secundario">Indisponível</span>
      </li>
    )
  }

  return (
    <li
      data-testid="opcao-frete"
      data-disponivel="true"
      /*
        Elevação sozinha, sem borda. A combinação anterior (borda fina +
        sombra) deixava a superfície indecisa entre ter aresta e flutuar; o
        cartão de cotação é conteúdo destacado do fundo, então flutua. O
        hover reforça a elevação e a marca sem mexer em layout — animar
        largura ou padding aqui causaria tremor na lista inteira.
      */
      className="rounded-cartao bg-superficie-card shadow-elevado transition-shadow hover:shadow-flutuante"
    >
      {/*
        O cartão inteiro é o alvo do clique, e não um botão "contratar" no
        canto: o preço e o prazo são o que a pessoa está comparando, então
        são eles que devem ser clicáveis. Um link (e não um `onClick` num
        `div`) para continuar valendo o que se espera de um link — abrir em
        outra aba, foco pelo teclado, leitor de tela anunciando destino.
      */}
      <Alvo
        opcao={opcao}
        quoteId={quoteId}
        autenticado={autenticado}
        aoEscolherComoVisitante={aoEscolherComoVisitante}
      >
        <div className="min-w-0">
          <p className="font-semibold text-texto-principal">{opcao.servicoNome}</p>
          <p className="text-sm text-texto-secundario">{opcao.carrierNome}</p>
          <p className="mt-1 text-sm text-texto-secundario">Entrega em {formatarPrazo(opcao.prazoDias)}</p>
        </div>

        <div className="flex flex-col items-start gap-1 sm:items-end">
          {opcao.descontoPercentual > 0 ? (
            <span className="rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-bold text-brand-texto">
              {opcao.descontoPercentual}% OFF
            </span>
          ) : null}
          {opcao.descontoCentavos > 0 ? (
            <span
              data-testid="opcao-frete-preco-balcao"
              className="text-sm text-texto-riscado line-through"
              aria-label={`Preço de balcão: ${formatarReais(opcao.precoBalcaoCentavos)}`}
            >
              {formatarReais(opcao.precoBalcaoCentavos)}
            </span>
          ) : null}
          <span data-testid="opcao-frete-preco" className="text-2xl font-extrabold text-brand-texto">
            {formatarReais(opcao.precoFinalCentavos)}
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-brand-texto">
            Gerar etiqueta →
          </span>
        </div>
      </Alvo>
    </li>
  )
}

/**
 * O elemento clicável do cartão: link ou botão, conforme o destino.
 *
 * Autenticado vai para o fluxo de envio, e isso é navegação — link, com tudo
 * o que se espera dele: abrir em outra aba, foco por teclado, leitor de tela
 * anunciando para onde vai.
 *
 * Visitante abre o cadastro na mesma página, e isso é ação — botão. Um link
 * que não navega mente para quem usa teclado ou leitor de tela, e prometeria
 * "abrir em nova aba" um diálogo que não existe lá.
 */
function Alvo({
  opcao,
  quoteId,
  autenticado,
  aoEscolherComoVisitante,
  children,
}: OpcaoFreteCardProps & { children: ReactNode }) {
  const rotulo = `Contratar ${opcao.carrierNome} ${opcao.servicoNome} por ${formatarReais(opcao.precoFinalCentavos)}`
  const classe =
    'flex w-full flex-col gap-3 rounded-cartao p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-row sm:items-center sm:justify-between'

  if (!autenticado && aoEscolherComoVisitante) {
    return (
      <button
        type="button"
        data-testid="opcao-frete-link"
        aria-label={rotulo}
        onClick={() => aoEscolherComoVisitante(destinoDaOpcao(quoteId, opcao.servicoId, true))}
        className={classe}
      >
        {children}
      </button>
    )
  }

  return (
    <Link
      href={destinoDaOpcao(quoteId, opcao.servicoId, autenticado)}
      data-testid="opcao-frete-link"
      aria-label={rotulo}
      className={classe}
    >
      {children}
    </Link>
  )
}

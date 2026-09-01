'use client'

import Link from 'next/link'
import { useEffect, useState, type RefObject } from 'react'
import { IconeCarteira, IconeMenu, IconeSair, IconeSino } from './icones'
import { SIDEBAR_ID } from './sidebar'
import { useLogout } from './usar-logout'

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Saldo real da carteira, para o atalho da topbar.
 *
 * Até aqui o valor era a string `R$ 0,00` escrita no código: quem tinha
 * R$ 165 lia zero em todas as telas, e o número mais visível do produto era
 * o único sempre errado. Pior que não mostrar saldo nenhum — o cliente
 * poderia recarregar sem precisar, ou concluir que um pagamento sumiu.
 *
 * Busca uma vez, na montagem do shell, e não a cada navegação: a topbar
 * pertence ao layout e sobrevive à troca de página. Falha de rede devolve
 * `null`, que a interface mostra como reticências — nunca como zero, que
 * seria repetir o mesmo erro por outro caminho.
 */
function useSaldo(autenticado: boolean): number | null {
  const [saldoCentavos, setSaldoCentavos] = useState<number | null>(null)

  useEffect(() => {
    if (!autenticado) {
      return
    }

    let ativo = true

    void (async () => {
      try {
        const resposta = await fetch('/api/carteira/saldo')
        if (!resposta.ok) {
          return
        }
        const dados = (await resposta.json()) as { saldoCentavos?: number }
        if (ativo && typeof dados.saldoCentavos === 'number') {
          setSaldoCentavos(dados.saldoCentavos)
        }
      } catch {
        // Silêncio proposital: saldo indisponível não é motivo para poluir a
        // tela de erro. O atalho continua levando à carteira, onde a falha
        // aparece com a mensagem certa.
      }
    })()

    return () => {
      ativo = false
    }
  }, [autenticado])

  return saldoCentavos
}

type TopbarProps = {
  nomeUsuario: string
  menuAberto: boolean
  onAlternarMenu: () => void
  /** Alvo para o qual a sidebar devolve o foco ao fechar. */
  botaoMenuRef?: RefObject<HTMLButtonElement | null>
  /**
   * A calculadora pública usa este mesmo shell para visitantes sem sessão
   * (nome fixo "VISITANTE"). Sem esta flag o botão "Sair" apareceria para
   * quem nunca entrou — clicável, mas sem sessão nenhuma para encerrar.
   */
  autenticado: boolean
}

/**
 * Topbar do shell autenticado. O saldo é um elemento de navegação — verde,
 * sublinhado e clicável — não um enfeite. A carteira só nasce na Task 11;
 * até lá o link aponta para `/carteira`, que exibe a página "Em breve".
 */
export function Topbar({ nomeUsuario, menuAberto, onAlternarMenu, botaoMenuRef, autenticado }: TopbarProps) {
  const { sair, saindo } = useLogout()
  const saldoCentavos = useSaldo(autenticado)

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-topbar items-center justify-between border-b border-superficie-bloco bg-superficie-card px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          ref={botaoMenuRef}
          onClick={onAlternarMenu}
          aria-label={menuAberto ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
          aria-controls={SIDEBAR_ID}
          aria-expanded={menuAberto}
          className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:hidden"
        >
          <IconeMenu />
        </button>
        <span className="text-sm font-bold uppercase tracking-wide text-texto-principal">
          {nomeUsuario}
        </span>
        {/*
          Visitante não tem carteira: mostrar "R$ 0,00" para quem não entrou
          descreve um saldo que não existe. O bloco inteiro só aparece para
          quem está autenticado.
        */}
        {autenticado ? (
          <>
            <IconeCarteira className="text-texto-secundario" />
            <Link
              href="/carteira"
              className="text-sm font-bold text-brand-texto underline underline-offset-2 hover:text-brand-light"
            >
              {saldoCentavos === null ? '···' : formatarReais(saldoCentavos)}
            </Link>
          </>
        ) : null}
      </div>

      <span className="text-lg font-extrabold tracking-tight text-texto-principal">Frete</span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Notificações"
          className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <IconeSino />
        </button>

        {/*
         * Escondido em mobile: a topbar já está apertada com nome, saldo e
         * sino nessa largura, e "Sair" com rótulo visível espremeria o
         * resto. No menu retrátil (`Sidebar`) o mesmo botão aparece com
         * espaço de sobra, então a ação não desaparece — só muda de lugar.
         */}
        {autenticado ? (
          <button
            type="button"
            onClick={sair}
            disabled={saindo}
            aria-busy={saindo}
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 lg:flex"
          >
            <IconeSair />
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
        ) : null}
      </div>
    </header>
  )
}

import Link from 'next/link'
import { IconeCarteira, IconeMenu, IconeSino } from './icones'
import { SIDEBAR_ID } from './sidebar'

type TopbarProps = {
  nomeUsuario: string
  menuAberto: boolean
  onAlternarMenu: () => void
}

/**
 * Topbar do shell autenticado. O saldo é um elemento de navegação — verde,
 * sublinhado e clicável — não um enfeite. A carteira só nasce na Task 11;
 * até lá o link aponta para `/carteira`, que exibe a página "Em breve".
 */
export function Topbar({ nomeUsuario, menuAberto, onAlternarMenu }: TopbarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-topbar items-center justify-between border-b border-superficie-bloco bg-superficie-card px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
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
        <IconeCarteira className="text-texto-secundario" />
        <Link
          href="/carteira"
          className="text-sm font-bold text-brand-texto underline underline-offset-2 hover:text-brand-light"
        >
          R$ 0,00
        </Link>
      </div>

      <span className="text-lg font-extrabold tracking-tight text-texto-principal">Frete</span>

      <button
        type="button"
        aria-label="Notificações"
        className="rounded-lg p-2 text-texto-principal hover:bg-superficie-bloco focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <IconeSino />
      </button>
    </header>
  )
}

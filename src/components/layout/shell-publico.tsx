import type { ReactNode } from 'react'

/**
 * Moldura das páginas abertas a quem não tem conta — hoje, só o rastreio.
 *
 * Não é o `AppShell`. Ali existe a navegação do vendedor — calculadora,
 * etiquetas, carteira, integrações —, e o destinatário de uma encomenda não
 * é vendedor: mostrar esse menu a ele expõe a área do produto que não lhe
 * pertence e convida a clicar em telas que vão recusá-lo.
 *
 * Quem chega aqui veio de um código de rastreio, e a única coisa que precisa
 * é acompanhar a encomenda.
 */
export function ShellPublico({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-superficie-pagina">
      <header className="flex h-topbar items-center justify-center border-b border-superficie-bloco bg-superficie-card px-4">
        <span className="text-lg font-extrabold tracking-tight text-texto-principal">Frete</span>
      </header>

      <main className="mx-auto min-w-0 max-w-conteudo px-4 pb-12 pt-8">{children}</main>
    </div>
  )
}

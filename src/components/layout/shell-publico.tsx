import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Moldura das páginas abertas a quem não tem conta: a calculadora e o
 * rastreio.
 *
 * Não é o `AppShell`. Ali existe a navegação do vendedor — calculadora,
 * etiquetas, carteira, integrações —, e nem todo visitante é vendedor:
 * mostrar esse menu a quem veio de um código de rastreio expõe a área do
 * produto que não lhe pertence e convida a clicar em telas que vão recusá-lo.
 *
 * O que esta moldura precisa fazer, e antes não fazia, é **dizer de quem ela
 * é**. O cabeçalho anterior era a palavra "Frete" centrada, sem logotipo, sem
 * cor e sem volta para o site: quem clicava em martinslog.net e caía aqui
 * tinha todos os motivos para achar que havia trocado de empresa — e então
 * digitava o CEP em uma página que não se identificava. A paleta e o traço de
 * estrada são os mesmos da landing, de propósito.
 */
export function ShellPublico({
  children,
  hero,
}: {
  children: ReactNode
  /**
   * Faixa de marca acima do conteúdo. É opcional porque só a calculadora
   * precisa se apresentar: quem chega ao rastreio já sabe o que veio fazer,
   * e uma chamada de venda no topo do "onde está minha encomenda" só atrasa
   * a resposta.
   */
  hero?: { eyebrow: string; titulo: ReactNode; apoio: string }
}) {
  return (
    <div className="flex min-h-screen flex-col bg-superficie-pagina">
      <header className="bg-sidebar">
        <div className="mx-auto flex h-topbar max-w-5xl items-center justify-between gap-4 px-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.webp" alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
            <span className="truncate text-dado font-extrabold tracking-tight text-white sm:text-base">
              MARTINS<span className="text-sidebar-marcador">LOG</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-4">
            {/* Escondido no celular: com quatro itens a barra quebra, e este é
                o único que tem atalho em outro lugar (o rodapé). */}
            <Link
              href="/rastrear"
              className="hidden rounded px-2 py-1 text-dado font-medium text-sidebar-texto hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:block"
            >
              Rastrear
            </Link>
            <Link
              href="/login"
              className="rounded px-2 py-1 text-dado font-medium text-sidebar-texto hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Entrar
            </Link>
            {/*
              Menor no celular. Somando marca, "Entrar" e este botão no tamanho
              de desktop, a barra passa de 320px de largura e o conteúdo
              transborda para fora da tela — que é onde a régua horizontal
              aparece e a página inteira ganha cara de quebrada.
            */}
            <Link
              href="/cadastro"
              className="shrink-0 rounded-pilula bg-destaque px-3 py-1.5 text-rotulo font-bold text-white transition hover:bg-destaque-escuro focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-4 sm:py-2 sm:text-dado"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      {hero ? (
        <div className="relative overflow-hidden bg-sidebar">
          {/* Decoração: fora da árvore de leitura e sem interceptar clique. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 1200 320"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path
              d="M-60 320C220 240 380 150 700 96 900 62 1080 46 1300 40"
              fill="none"
              stroke="#ffffff"
              strokeWidth="90"
              opacity="0.045"
            />
            <path
              d="M-60 320C220 240 380 150 700 96 900 62 1080 46 1300 40"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeDasharray="20 28"
              opacity="0.22"
            />
            <path
              d="M-60 360C220 280 380 190 700 136 900 102 1080 86 1300 80"
              fill="none"
              stroke="#e8323c"
              strokeWidth="2.5"
              strokeDasharray="14 30"
              opacity="0.32"
            />
          </svg>

          {/* O padding de baixo é grande porque o conteúdo sobe por cima dele
              (`-mt-16`): é o que faz o cartão flutuar sobre a faixa, como o
              cartão de rastreio da landing. */}
          <div className="relative mx-auto max-w-5xl px-4 pb-24 pt-10 sm:pt-12">
            <p className="flex items-center gap-2 text-rotulo font-bold uppercase text-sidebar-marcador">
              <span aria-hidden="true" className="block h-0.5 w-6 bg-sidebar-marcador" />
              {hero.eyebrow}
            </p>
            <h1 className="mt-3 max-w-2xl text-display font-black text-white sm:text-hero">
              {hero.titulo}
            </h1>
            <p className="mt-3 max-w-xl text-corpo text-[#b9c4d6]">{hero.apoio}</p>
          </div>
        </div>
      ) : null}

      <main
        className={`mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pb-secao ${
          hero ? '-mt-16' : 'pt-8'
        }`}
      >
        {children}
      </main>

      <footer className="mt-secao bg-sidebar">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-5 text-dado text-[#8fa0bc] sm:flex-row sm:items-center sm:justify-between">
          <p>MARTINS LOG E TRANSPORTES LTDA</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              href="https://martinslog.net"
              className="rounded hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              martinslog.net
            </a>
            <a
              href="https://martinslog.net/#ajuda"
              className="rounded hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Central de Ajuda
            </a>
            <Link
              href="/rastrear"
              className="rounded hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Rastrear encomenda
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

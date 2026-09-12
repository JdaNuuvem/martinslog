import type { ReactNode } from 'react'

/**
 * Moldura das telas de entrada e cadastro.
 *
 * Antes as duas eram um formulário solto no fundo cinza, encostado no topo da
 * janela e com dois terços da tela vazios abaixo — sem superfície própria,
 * sem centro, sem começo nem fim visíveis. Aqui elas ganham um cartão
 * centrado nos dois eixos: é a única coisa na tela, então é ela que deve
 * ocupar o centro óptico.
 *
 * O fundo é o azul da marca, com o mesmo traço de estrada que atravessa
 * martinslog.net — é a primeira tela que alguém vê do produto, e um cinza
 * neutro não diz de quem ela é. O cartão branco por cima mantém o formulário
 * na superfície clara de sempre, onde os contrastes de campo e de erro já
 * estão medidos.
 */
export default function LayoutAutenticacao({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar px-5 py-secao">
      {/*
        Decoração: fica fora da árvore de leitura (`aria-hidden`) e não
        intercepta clique, para não roubar nada do formulário.
      */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <path
          d="M-80 900C240 700 180 480 520 320 720 226 900 140 1280 90"
          fill="none"
          stroke="#ffffff"
          strokeWidth="120"
          opacity="0.04"
        />
        <path
          d="M-80 900C240 700 180 480 520 320 720 226 900 140 1280 90"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeDasharray="26 34"
          opacity="0.22"
        />
        <path
          d="M-120 960C200 760 140 540 480 380 680 286 860 200 1240 150"
          fill="none"
          stroke="#e8323c"
          strokeWidth="3"
          strokeDasharray="18 40"
          opacity="0.3"
        />
      </svg>

      <div className="relative flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.webp" alt="" width={44} height={44} className="h-11 w-11 object-contain" />
          <span className="text-2xl font-extrabold uppercase tracking-tight text-white">
            Martins<span className="text-sidebar-marcador">Log</span>
          </span>
        </div>

        <div className="rounded-painel bg-superficie-card p-8 shadow-elevado">{children}</div>
      </div>
    </div>
  )
}

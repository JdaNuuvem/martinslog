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
 * Cartão com elevação e sem borda, como o resto do sistema.
 */
export default function LayoutAutenticacao({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-superficie-pagina px-5 py-secao">
      <div className="w-full max-w-md rounded-painel bg-superficie-card p-8 shadow-elevado">
        {children}
      </div>
    </div>
  )
}

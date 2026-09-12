import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Atendemos apenas o Brasil — Martins Log',
  robots: { index: false, follow: false },
}

/**
 * O que um visitante de fora do Brasil vê.
 *
 * Diz o motivo em vez de mostrar erro. Quem chega aqui não fez nada errado — a
 * empresa simplesmente não opera na região dele, e uma tela de "acesso negado"
 * sugeriria bloqueio por conduta.
 *
 * O caminho para o rastreio fica visível porque ele continua funcionando de
 * qualquer lugar: um comprador brasileiro em viagem precisa acompanhar a
 * encomenda dele.
 */
export default function ForaDoBrasil() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-superficie px-6 py-16">
      <div className="max-w-leitura text-center">
        <p className="text-dado font-semibold uppercase tracking-wide text-brand-texto">
          Martins Log
        </p>
        <h1 className="mt-4 text-titulo font-bold text-texto-principal">
          Atendemos apenas o Brasil
        </h1>
        <p className="mt-4 text-corpo text-texto-secundario">
          Somos uma transportadora de cargas com operação exclusivamente em território brasileiro,
          então o nosso site fica disponível apenas para acessos do Brasil.
        </p>
        <p className="mt-6 text-corpo text-texto-secundario">
          Se você tem uma encomenda a caminho, o rastreio continua aberto de qualquer lugar:
        </p>
        <a
          href="/rastrear"
          className="mt-4 inline-block rounded-lg bg-brand px-5 py-3 font-medium text-white transition hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Rastrear encomenda
        </a>
        <p className="mt-10 text-dado text-texto-secundario">
          Se você está no Brasil e viu esta página, pode ser a sua rede saindo por outro país — uma
          VPN, por exemplo. Desligue e tente de novo.
        </p>
      </div>
    </main>
  )
}

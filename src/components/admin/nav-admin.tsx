'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Navegação entre as telas de administração.
 *
 * A lateral do aplicativo lista o que o LOJISTA usa — calcular, etiquetas,
 * perfil. Dentro de `/admin` ela continua ali, e não leva a lugar nenhum daqui:
 * quem entrava em Pedidos só voltava para Envios digitando o endereço à mão.
 *
 * Fica em uma faixa que rola na horizontal no celular, em vez de virar mais um
 * menu: são doze destinos curtos, e empilhá-los empurraria o conteúdo da tela
 * para baixo da dobra em todo carregamento.
 */
const ITENS = [
  { rotulo: 'Painel', href: '/admin' },
  { rotulo: 'Pedidos', href: '/admin/pedidos' },
  { rotulo: 'Envios', href: '/admin/envios' },
  { rotulo: 'Mensagens', href: '/admin/mensagens' },
  { rotulo: 'Webhooks', href: '/admin/webhooks' },
  { rotulo: 'Cotações', href: '/admin/cotacoes' },
  { rotulo: 'Usuários', href: '/admin/usuarios' },
  { rotulo: 'Tabelas', href: '/admin/tabelas' },
  { rotulo: 'Serviços', href: '/admin/servicos' },
  { rotulo: 'Status de rastreio', href: '/admin/status-rastreio' },
  { rotulo: 'Simulação', href: '/admin/simulacao' },
  { rotulo: 'Auditoria', href: '/admin/auditoria' },
] as const

export function NavAdmin() {
  const pathname = usePathname()

  /*
    O item destacado é o de rota mais LONGA que casa com a página atual. Um
    `startsWith` solto destacaria "Painel" em toda tela, já que `/admin` é
    prefixo de todas — e a navegação diria que o usuário está em dois lugares.
  */
  const ativo = ITENS.map((item) => item.href)
    .filter((href) =>
      href === '/admin' ? pathname === '/admin' : pathname === href || pathname?.startsWith(`${href}/`),
    )
    .sort((a, b) => b.length - a.length)[0]

  return (
    <nav
      aria-label="Navegação da administração"
      className="-mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8"
    >
      <ul className="flex w-max gap-2">
        {ITENS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.href === ativo ? 'page' : undefined}
              className={`block whitespace-nowrap rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                item.href === ativo
                  ? 'bg-brand text-white'
                  : 'bg-superficie-card text-texto-principal hover:bg-superficie-bloco'
              }`}
            >
              {item.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

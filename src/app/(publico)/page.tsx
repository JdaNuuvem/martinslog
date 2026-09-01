import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/app-shell'
import { CalculadoraForm } from '@/components/calculadora-form'
import { lerSessaoDoServidor } from '@/server/auth/sessao-servidor'

/**
 * Calculadora de frete — área do vendedor, não do destinatário.
 *
 * Era aberta a visitantes, e com ela vinha a navegação inteira do produto:
 * etiquetas, carteira, integrações, convites. Quem só recebeu um código de
 * rastreio via a área de trabalho de um lojista, com telas que iriam recusá-lo
 * ao primeiro clique.
 *
 * A única coisa pública é o rastreio (`/r/[codigo]` e `/rastrear`), que usa o
 * `ShellPublico`, sem a navegação de vendedor. Quem chega aqui sem conta vai
 * para o cadastro.
 */
export default async function PaginaCalculadora() {
  const sessao = await lerSessaoDoServidor()

  if (!sessao) {
    redirect('/login')
  }

  return (
    <AppShell nomeUsuario={sessao.nome} autenticado>
      <CalculadoraForm autenticado />
    </AppShell>
  )
}

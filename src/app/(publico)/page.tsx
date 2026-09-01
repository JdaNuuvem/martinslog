import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { ShellPublico } from '@/components/layout/shell-publico'
import { CalculadoraForm } from '@/components/calculadora-form'
import { lerSessaoDoServidor } from '@/server/auth/sessao-servidor'

/**
 * Calculadora de frete — a porta de entrada, aberta a quem ainda não tem
 * conta.
 *
 * A moldura muda com a sessão, e é essa a diferença que importa:
 *
 * - **Visitante** recebe o `ShellPublico`: calculadora e nada mais. A
 *   navegação de vendedor (etiquetas, carteira, integrações, convites) some,
 *   porque ela só oferece telas que recusariam quem não tem conta — foi o
 *   motivo de a página ter sido fechada antes. Fechar resolvia o menu errado
 *   ao custo de perder quem chega para comparar preço, que é o começo de
 *   toda venda.
 * - **Autenticado** recebe o `AppShell` completo, como sempre.
 *
 * Quando um visitante escolhe um frete, o cadastro abre em cima da própria
 * cotação (`ModalCadastro`, disparado pela lista) e o leva ao fluxo de envio
 * com o serviço já escolhido.
 */
export default async function PaginaCalculadora() {
  const sessao = await lerSessaoDoServidor()

  if (sessao) {
    return (
      <AppShell nomeUsuario={sessao.nome} autenticado>
        <CalculadoraForm autenticado />
      </AppShell>
    )
  }

  return (
    <ShellPublico>
      <div className="flex flex-col gap-bloco">
        <CalculadoraForm />

        <p className="text-dado text-texto-secundario">
          Já tem conta?{' '}
          <Link
            href="/login"
            className="font-medium text-brand-texto underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Entrar
          </Link>
        </p>
      </div>
    </ShellPublico>
  )
}

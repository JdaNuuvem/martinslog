import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { CalculadoraForm } from '@/components/calculadora-form'
import { lerSessaoDoServidor } from '@/server/auth/sessao-servidor'

/**
 * Única rota que atende tanto visitante quanto usuário autenticado com o
 * mesmo shell: a calculadora funciona sem login. Por isso, ao contrário do
 * layout do grupo `(app)`, aqui a sessão é lida sem redirecionar — só para
 * decidir se a topbar mostra o nome real e o botão "Sair" (autenticado) ou
 * "VISITANTE" sem ele.
 */
export default async function PaginaCalculadora() {
  const sessao = await lerSessaoDoServidor()

  return (
    <AppShell nomeUsuario={sessao?.nome} autenticado={!!sessao}>
      <div className="flex flex-col gap-4">
        <CalculadoraForm autenticado={!!sessao} />
        {/* Quem recebeu um código de rastreio por mensagem e caiu na home
            precisa achar o caminho — este link discreto é a porta de
            entrada dedicada em `/rastrear`. */}
        <p className="text-center text-sm text-texto-secundario">
          Já comprou de um vendedor e recebeu um código?{' '}
          <Link href="/rastrear" className="font-medium text-brand-texto underline underline-offset-2">
            Rastreie seu pedido
          </Link>
        </p>
      </div>
    </AppShell>
  )
}

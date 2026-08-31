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
      <CalculadoraForm />
    </AppShell>
  )
}

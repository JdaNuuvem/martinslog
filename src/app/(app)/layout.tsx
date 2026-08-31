import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/app-shell'
import { lerSessaoDoServidor } from '@/server/auth/sessao-servidor'

/**
 * Guarda de todas as rotas autenticadas.
 *
 * Fica no layout do grupo `(app)`, e não em cada página, para que uma rota
 * nova nasça protegida: esquecer a guarda é fácil, e o custo do esquecimento
 * é uma tela da área logada servida a quem não entrou.
 *
 * Sem isso, `/etiquetas` renderizava o shell inteiro — abas, busca e
 * navegação — para um visitante, e só falhava na chamada da API, com um
 * "Não foi possível carregar suas etiquetas" que descreve mal o problema
 * real: a pessoa não está autenticada.
 *
 * A verificação acontece no servidor, antes de qualquer HTML sair. Esconder
 * a interface no cliente não protegeria nada — as rotas de API têm a própria
 * checagem, e é ela que impede o acesso aos dados; esta guarda existe para
 * não desenhar uma tela que não deveria existir para quem a vê.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await lerSessaoDoServidor()

  if (!sessao) {
    redirect('/login')
  }

  return <AppShell nomeUsuario={sessao.nome}>{children}</AppShell>
}

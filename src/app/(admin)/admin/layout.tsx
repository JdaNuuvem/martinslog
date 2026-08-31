import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import { NextRequest } from 'next/server'
import { AppShell } from '@/components/layout/app-shell'
import { exigirAdmin } from '@/server/admin/guarda'

/**
 * Guarda de toda a área `/admin`. A checagem acontece no servidor, antes de
 * qualquer conteúdo ser renderizado — esconder o link do painel na interface
 * não é proteção, e cada rota de `/api/admin` repete a mesma guarda por
 * conta própria, porque quem chama a API não passa por aqui.
 *
 * Quem não é administrador recebe a página 404 padrão, não uma tela de
 * "acesso negado": negar com 403 confirmaria que existe um painel neste
 * endereço.
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const cabecalhos = await headers()
  const requisicao = new NextRequest('http://localhost/admin', { headers: cabecalhos })

  const guarda = await exigirAdmin(requisicao)
  if (!guarda.autorizado) {
    notFound()
  }

  return (
    <AppShell nomeUsuario="ADMINISTRAÇÃO">
      <div className="flex flex-col gap-6">{children}</div>
    </AppShell>
  )
}

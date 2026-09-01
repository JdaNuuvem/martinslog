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
      {/*
        `gap-secao` entre os blocos da página, e não o `gap-6` uniforme de
        antes: espaçamento igual em toda parte apaga a informação de o que
        pertence a quê. Dentro de cada seção os itens continuam próximos; é a
        distância entre seções que diz onde um assunto termina.
      */}
      <div className="flex flex-col gap-secao">{children}</div>
    </AppShell>
  )
}

import { notFound } from 'next/navigation'
import { GerenciadorTemplates } from '@/components/conversas/templates/gerenciador-templates'
import { exigirSessaoNaPagina } from '@/server/auth/sessao-servidor'

type Props = { searchParams: Promise<{ perfilId?: string }> }

export default async function PaginaTemplatesWhatsapp({ searchParams }: Props) {
  // Mesma guarda da caixa de entrada: templates só existem para quem atende pelo WhatsApp conectado.
  const sessao = await exigirSessaoNaPagina()
  if (sessao.papel !== 'ADMIN') notFound()

  const { perfilId } = await searchParams
  return <GerenciadorTemplates perfilIdInicial={perfilId ?? null} />
}

import { notFound } from 'next/navigation'
import { CaixaDeEntrada } from '@/components/conversas/caixa-de-entrada'
import { exigirSessaoNaPagina } from '@/server/auth/sessao-servidor'

type Props = { searchParams: Promise<{ perfilId?: string }> }

export default async function PaginaConversas({ searchParams }: Props) {
  /*
    Conversa de comprador é conteúdo de terceiro, e o WhatsApp conectado por
    QR code é só para administradores — as rotas `/api/whatsapp/*` recusam
    qualquer outra sessão.

    404 e não "acesso negado": confirmar que a tela existe já diria que a
    plataforma guarda conversas de WhatsApp.
  */
  const sessao = await exigirSessaoNaPagina()
  if (sessao.papel !== 'ADMIN') notFound()

  const { perfilId } = await searchParams
  return <CaixaDeEntrada perfilIdInicial={perfilId ?? null} />
}

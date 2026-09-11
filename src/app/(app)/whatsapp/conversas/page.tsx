import { notFound } from 'next/navigation'
import { ConversasWhatsapp } from '@/components/conversas-whatsapp'
import { exigirSessaoNaPagina } from '@/server/auth/sessao-servidor'

export default async function PaginaConversas() {
  /*
    Mesma regra da conexão: conversa de comprador é conteúdo de terceiro, e a
    Evolution inteira é só para administradores.

    404 e não "acesso negado": confirmar que a tela existe já diria que a
    plataforma guarda conversas de WhatsApp. A guarda de verdade está em
    `/api/evolution/conversas`, que responde 404 pelo mesmo motivo.
  */
  const sessao = await exigirSessaoNaPagina()
  if (sessao.papel !== 'ADMIN') notFound()

  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Conversas</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          O que os compradores escreveram para o número da loja. O robô responde sobre rastreio
          sozinho; quando você assume, ele para de falar naquela conversa.
        </p>
      </div>

      <ConversasWhatsapp />
    </div>
  )
}

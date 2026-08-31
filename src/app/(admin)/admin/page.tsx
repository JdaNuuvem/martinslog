import Link from 'next/link'
import { prisma } from '@/infra/db/client'

/**
 * Entrada da área administrativa: números do dia e os caminhos para as
 * telas. As seções ainda não construídas aparecem marcadas, para que a
 * ausência seja explícita em vez de parecer um link quebrado.
 */
export default async function PaginaAdmin() {
  const [regras, envios, usuarios, auditoria, webhooksNaFila, cotacoes, statusPadrao, servicos] =
    await Promise.all([
      prisma.priceRule.count(),
      prisma.shipment.count(),
      prisma.user.count(),
      prisma.auditLog.count(),
      // Só o que ainda vai ser tentado: entrega concluída ou desistida não é
      // trabalho pendente, e contá-la faria o número nunca baixar.
      prisma.webhookDelivery.count({
        where: { entregueEm: null, proximaTentativaEm: { not: null } },
      }),
      prisma.quote.count(),
      prisma.statusRastreio.count({ where: { userId: null } }),
      prisma.service.count({ where: { ativo: true } }),
    ])

  const cartoes = [
    { titulo: 'Regras de preço', valor: regras, href: '/admin/tabelas', pronto: true },
    { titulo: 'Webhooks na fila', valor: webhooksNaFila, href: '/admin/webhooks', pronto: true },
    { titulo: 'Envios', valor: envios, href: '/admin/envios', pronto: true },
    { titulo: 'Cotações', valor: cotacoes, href: '/admin/cotacoes', pronto: true },
    { titulo: 'Usuários', valor: usuarios, href: '/admin/usuarios', pronto: true },
    { titulo: 'Registros de auditoria', valor: auditoria, href: '/admin/auditoria', pronto: true },
    { titulo: 'Status de rastreio', valor: statusPadrao, href: '/admin/status-rastreio', pronto: true },
    { titulo: 'Serviços', valor: servicos, href: '/admin/servicos', pronto: true },
  ]

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Administração</h1>
        <p className="text-sm text-texto-secundario">
          Área restrita. Toda ação que mexe em dinheiro ou status fica registrada na auditoria.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map((cartao) =>
          cartao.pronto ? (
            <Link
              key={cartao.titulo}
              href={cartao.href}
              className="rounded-xl bg-superficie-card p-6 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <p className="text-xs uppercase text-texto-secundario">{cartao.titulo}</p>
              <p className="text-2xl font-bold text-texto-principal">{cartao.valor}</p>
              <p className="mt-2 text-sm font-medium text-brand-texto">Abrir</p>
            </Link>
          ) : (
            <div key={cartao.titulo} className="rounded-xl bg-superficie-card p-6">
              <p className="text-xs uppercase text-texto-secundario">{cartao.titulo}</p>
              <p className="text-2xl font-bold text-texto-principal">{cartao.valor}</p>
              <p className="mt-2 text-sm text-texto-secundario">Em construção</p>
            </div>
          ),
        )}
      </div>
    </>
  )
}

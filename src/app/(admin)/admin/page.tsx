import Link from 'next/link'
import { prisma } from '@/infra/db/client'
import { AtualizaSozinho } from '@/components/admin/atualiza-sozinho'
import { exigirAdminNaPagina } from '@/server/admin/guarda'

/** Os números do painel são de agora, não do último build. */
export const dynamic = 'force-dynamic'

type Cartao = {
  titulo: string
  valor: number
  href: string
  /** Recorte que muda a leitura do número — pendentes, falhas. */
  nota?: string
  /**
   * O recorte pede ação de alguém.
   *
   * Só quando é verdade: pintar de vermelho o que não é urgente ensina a
   * ignorar vermelho, e aí o alerta que importa passa despercebido.
   */
  atencao?: boolean
}

/**
 * Entrada da área administrativa.
 *
 * Os cartões vêm em três grupos, e a ordem é deliberada: primeiro o que muda
 * ao longo do dia e pede olho (pedido, envio, mensagem, fila), depois o que se
 * configura uma vez e fica (preço, serviço, status), por último a conta. Uma
 * grade única de dez cartões dá o mesmo peso ao pedido que chegou agora e à
 * tabela de preço que ninguém toca há um mês — e quem abre o painel para
 * trabalhar perde tempo procurando.
 */
export default async function PaginaAdmin() {
  await exigirAdminNaPagina()
  const [
    regras,
    envios,
    enviosSemCodigo,
    usuarios,
    auditoria,
    webhooksNaFila,
    cotacoes,
    statusPadrao,
    servicos,
    pedidos,
    pedidosPendentes,
    mensagens,
    mensagensFalhas,
  ] = await Promise.all([
    prisma.priceRule.count(),
    prisma.shipment.count(),
    /*
      Envio pago que ficou sem código de rastreio: a emissão tropeçou depois do
      pagamento. É o comprador que pagou e não tem o que acompanhar — o número
      que mais merece estar na primeira tela.
    */
    prisma.shipment.count({ where: { status: 'RELEASED', codigoRastreio: null } }),
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
    prisma.pedido.count(),
    // O pendente é o número que vale dinheiro: é a venda que ainda dá para
    // recuperar. Somado ao resto, ele desaparece.
    prisma.pedido.count({ where: { status: 'PENDENTE' } }),
    prisma.mensagemEnvio.count(),
    // `DESISTIU`, não `FALHA`: ver o comentário em `consulta-mensagens.ts`.
    // Contar `FALHA` mostrava "nenhuma falha" com a caixa cheia delas.
    prisma.mensagemEnvio.count({ where: { status: 'DESISTIU' } }),
  ])

  const grupos: { titulo: string; descricao: string; cartoes: Cartao[] }[] = [
    {
      titulo: 'O dia',
      descricao: 'O que muda a toda hora e pede olho.',
      cartoes: [
        {
          titulo: 'Pedidos',
          valor: pedidos,
          href: '/admin/pedidos',
          nota: `${pedidosPendentes.toLocaleString('pt-BR')} aguardando pagamento`,
        },
        {
          titulo: 'Envios',
          valor: envios,
          href: '/admin/envios',
          nota:
            enviosSemCodigo > 0
              ? `${enviosSemCodigo.toLocaleString('pt-BR')} pagos sem código de rastreio`
              : undefined,
          atencao: enviosSemCodigo > 0,
        },
        {
          titulo: 'Mensagens',
          valor: mensagens,
          href: '/admin/mensagens',
          nota:
            mensagensFalhas > 0
              ? `${mensagensFalhas.toLocaleString('pt-BR')} não chegaram`
              : 'nenhuma falha',
          atencao: mensagensFalhas > 0,
        },
        {
          titulo: 'Webhooks na fila',
          valor: webhooksNaFila,
          href: '/admin/webhooks',
          nota: webhooksNaFila > 0 ? 'aguardando entrega' : 'fila vazia',
        },
      ],
    },
    {
      titulo: 'Como o frete é calculado',
      descricao: 'Ajustado de vez em quando; muda o preço de todo mundo.',
      cartoes: [
        { titulo: 'Regras de preço', valor: regras, href: '/admin/tabelas' },
        { titulo: 'Serviços ativos', valor: servicos, href: '/admin/servicos' },
        { titulo: 'Status de rastreio', valor: statusPadrao, href: '/admin/status-rastreio' },
        { titulo: 'Cotações', valor: cotacoes, href: '/admin/cotacoes' },
      ],
    },
    {
      titulo: 'Contas e histórico',
      descricao: 'Quem tem acesso e o que foi feito.',
      cartoes: [
        { titulo: 'Usuários', valor: usuarios, href: '/admin/usuarios' },
        { titulo: 'Registros de auditoria', valor: auditoria, href: '/admin/auditoria' },
      ],
    },
  ]

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Administração</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Todas as lojas em um lugar. Toda ação que mexe em dinheiro ou status fica registrada na
          auditoria.
        </p>
        <AtualizaSozinho segundos={60} />
      </div>

      {grupos.map((grupo) => (
        <section key={grupo.titulo} className="flex flex-col gap-3">
          <div>
            <h2 className="text-subtitulo font-semibold text-texto-principal">{grupo.titulo}</h2>
            <p className="text-dado text-texto-secundario">{grupo.descricao}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {grupo.cartoes.map((cartao) => (
              <Link
                key={cartao.titulo}
                href={cartao.href}
                className="group flex flex-col rounded-xl bg-superficie-card p-5 transition hover:bg-superficie-bloco focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <p className="text-rotulo uppercase text-texto-secundario">{cartao.titulo}</p>
                <p className="text-titulo font-bold leading-tight text-texto-principal">
                  {cartao.valor.toLocaleString('pt-BR')}
                </p>
                {cartao.nota ? (
                  <p
                    className={`mt-1 text-dado ${cartao.atencao ? 'font-medium text-erro' : 'text-texto-secundario'}`}
                  >
                    {cartao.nota}
                  </p>
                ) : null}
                <p className="mt-auto pt-3 text-sm font-medium text-brand-texto">Abrir →</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { obterUsuario } from '@/server/admin/usuarios'
import { AjusteSaldoForm } from '@/components/admin/ajuste-saldo-form'
import { CriarEtiquetaForm } from '@/components/admin/criar-etiqueta-form'
import { AcoesEtiqueta } from '@/components/admin/acoes-etiqueta'
import { PapelAcessoForm } from '@/components/admin/papel-acesso-form'

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR')
}

/**
 * Ficha de um usuário: dados, saldo com extrato, etiquetas e as ações
 * administrativas sobre ambos.
 *
 * Extrato e etiquetas aparecem ao lado dos formulários de propósito — quem
 * vai creditar R$ 200 precisa ver o que já foi creditado antes, na mesma
 * tela, para não repetir um ajuste que já existe.
 */
export default async function PaginaUsuario({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const usuario = await obterUsuario(id)

  if (!usuario) {
    notFound()
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/usuarios"
          className="text-sm text-texto-secundario focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          ← Usuários
        </Link>
        <h1 className="text-2xl font-bold text-texto-principal">{usuario.nome}</h1>
        <p className="text-sm text-texto-secundario">
          {usuario.email} · {usuario.documento}
          {usuario.telefone ? ` · ${usuario.telefone}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-superficie-card p-6">
          <p className="text-xs uppercase text-texto-secundario">Saldo atual</p>
          <p className="text-2xl font-bold text-texto-principal">{reais(usuario.saldoCentavos)}</p>
        </div>
        <div className="rounded-xl bg-superficie-card p-6">
          <p className="text-xs uppercase text-texto-secundario">Etiquetas</p>
          <p className="text-2xl font-bold text-texto-principal">{usuario.envios}</p>
        </div>
        <div className="rounded-xl bg-superficie-card p-6">
          <p className="text-xs uppercase text-texto-secundario">Conta desde</p>
          <p className="text-2xl font-bold text-texto-principal">
            {usuario.criadoEm.toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>

      <PapelAcessoForm userId={usuario.id} />

      <AjusteSaldoForm userId={usuario.id} saldoCentavos={usuario.saldoCentavos} />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Últimos lançamentos</h2>
        {usuario.extrato.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum lançamento nesta carteira.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Quando</th>
                  <th scope="col" className="py-2 pr-4">Tipo</th>
                  <th scope="col" className="py-2 pr-4">Valor</th>
                  <th scope="col" className="py-2 pr-4">Saldo depois</th>
                  <th scope="col" className="py-2">Descrição</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {usuario.extrato.map((entrada) => (
                  <tr key={entrada.id} className="border-t border-borda-campo">
                    <td className="py-2 pr-4">{dataHora(entrada.criadoEm)}</td>
                    <td className="py-2 pr-4">{entrada.tipo === 'CREDITO' ? 'Crédito' : 'Débito'}</td>
                    <td className="py-2 pr-4">
                      {entrada.tipo === 'CREDITO' ? '+' : '−'} {reais(entrada.valorCentavos)}
                    </td>
                    <td className="py-2 pr-4">{reais(entrada.saldoAposCentavos)}</td>
                    <td className="py-2">{entrada.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CriarEtiquetaForm userId={usuario.id} />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Etiquetas do cliente</h2>
        {usuario.etiquetas.length === 0 ? (
          <p className="text-sm text-texto-secundario">Este cliente ainda não tem etiquetas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="text-xs uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Criada em</th>
                  <th scope="col" className="py-2 pr-4">Código</th>
                  <th scope="col" className="py-2 pr-4">Situação</th>
                  <th scope="col" className="py-2 pr-4">Destinatário</th>
                  <th scope="col" className="py-2 pr-4">Valor</th>
                  <th scope="col" className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {usuario.etiquetas.map((etiqueta) => (
                  <tr key={etiqueta.id} className="border-t border-borda-campo">
                    <td className="py-2 pr-4">{dataHora(etiqueta.criadoEm)}</td>
                    <td className="py-2 pr-4">{etiqueta.codigoRastreio ?? '—'}</td>
                    <td className="py-2 pr-4">{etiqueta.status}</td>
                    <td className="py-2 pr-4">{etiqueta.destinatarioNome}</td>
                    <td className="py-2 pr-4">{reais(etiqueta.precoCobradoCentavos)}</td>
                    <td className="py-2">
                      <AcoesEtiqueta shipmentId={etiqueta.id} status={etiqueta.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

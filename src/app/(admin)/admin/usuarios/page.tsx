import Link from 'next/link'
import { listarUsuarios } from '@/server/admin/usuarios'

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function data(valor: Date): string {
  return valor.toLocaleDateString('pt-BR')
}

/**
 * Lista de usuários do painel, com busca por nome, e-mail ou documento.
 *
 * A busca é um formulário GET comum, sem JavaScript: o termo fica na URL,
 * então o resultado é linkável e sobrevive ao recarregar — o que importa em
 * um painel onde alguém cola o endereço em um chamado de suporte.
 */
export default async function PaginaUsuarios({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string }>
}) {
  const { busca = '' } = await searchParams
  const usuarios = await listarUsuarios(busca)

  return (
    <>
      <div>
        <h1 className="text-titulo font-bold text-texto-principal">Usuários</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Saldo e etiquetas de cada conta. Toda alteração feita aqui fica registrada na auditoria.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-superficie-card p-6">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Buscar por nome, e-mail ou documento</span>
          <input
            type="search"
            name="busca"
            defaultValue={busca}
            placeholder="maria, maria@exemplo.com ou 12345678901"
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Buscar
        </button>
      </form>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          {usuarios.length} {usuarios.length === 1 ? 'conta encontrada' : 'contas encontradas'}
        </h2>

        {usuarios.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Nenhuma conta corresponde a esta busca.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-dado">
              <thead className="text-rotulo uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Nome</th>
                  <th scope="col" className="py-2 pr-4">E-mail</th>
                  <th scope="col" className="py-2 pr-4">Documento</th>
                  <th scope="col" className="py-2 pr-4">Saldo</th>
                  <th scope="col" className="py-2 pr-4">Etiquetas</th>
                  <th scope="col" className="py-2 pr-4">Desde</th>
                  <th scope="col" className="py-2" />
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {usuarios.map((usuario) => (
                  <tr key={usuario.id} className="border-t border-borda-campo">
                    <td className="py-2 pr-4">
                      {usuario.nome}
                      {usuario.papel === 'ADMIN' ? (
                        <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                          admin
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">{usuario.email}</td>
                    <td className="py-2 pr-4">{usuario.documento}</td>
                    <td className="py-2 pr-4">{reais(usuario.saldoCentavos)}</td>
                    <td className="py-2 pr-4">{usuario.envios}</td>
                    <td className="py-2 pr-4">{data(usuario.criadoEm)}</td>
                    <td className="py-2">
                      <Link
                        href={`/admin/usuarios/${usuario.id}`}
                        className="text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        Abrir
                      </Link>
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

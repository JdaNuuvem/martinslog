import { prisma } from '@/infra/db/client'
import { ImportarTabelaForm } from '@/components/admin/importar-tabela-form'

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function cep(valor: number): string {
  const texto = String(valor).padStart(8, '0')
  return `${texto.slice(0, 5)}-${texto.slice(5)}`
}

/**
 * Tabelas de preço vigentes, agrupadas por serviço, com a importação por
 * CSV logo acima. A listagem existe para conferir o que entrou: sem ela, a
 * importação é um envio às cegas.
 */
export default async function PaginaTabelas() {
  const regras = await prisma.priceRule.findMany({
    include: { service: { select: { codigo: true, nome: true } } },
    orderBy: [{ serviceId: 'asc' }, { pesoMinG: 'asc' }],
  })

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-texto-principal">Tabelas de preço</h1>
        <p className="text-sm text-texto-secundario">
          {regras.length} {regras.length === 1 ? 'regra vigente' : 'regras vigentes'}.
        </p>
      </div>

      <ImportarTabelaForm />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Regras vigentes</h2>

        {regras.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            Nenhuma regra cadastrada. Importe um arquivo para começar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Serviço</th>
                  <th scope="col" className="py-2 pr-4">CEP origem</th>
                  <th scope="col" className="py-2 pr-4">CEP destino</th>
                  <th scope="col" className="py-2 pr-4">Peso (g)</th>
                  <th scope="col" className="py-2 pr-4">Balcão</th>
                  <th scope="col" className="py-2 pr-4">Venda</th>
                  <th scope="col" className="py-2 pr-4">Prazo</th>
                  <th scope="col" className="py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {regras.map((regra) => (
                  <tr key={regra.id} className="border-t border-borda-campo">
                    <td className="py-2 pr-4">{regra.service.codigo}</td>
                    <td className="py-2 pr-4">
                      {cep(regra.cepOrigemIni)} — {cep(regra.cepOrigemFim)}
                    </td>
                    <td className="py-2 pr-4">
                      {cep(regra.cepDestinoIni)} — {cep(regra.cepDestinoFim)}
                    </td>
                    <td className="py-2 pr-4">
                      {regra.pesoMinG} — {regra.pesoMaxG}
                    </td>
                    <td className="py-2 pr-4">{reais(regra.precoBalcaoCentavos)}</td>
                    <td className="py-2 pr-4">{reais(regra.precoVendaCentavos)}</td>
                    <td className="py-2 pr-4">
                      {regra.prazoDias} {regra.prazoDias === 1 ? 'dia' : 'dias'}
                    </td>
                    <td className="py-2">
                      {regra.ativo ? (
                        <span className="rounded-pilula bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-texto">
                          Ativa
                        </span>
                      ) : (
                        <span className="rounded-pilula bg-superficie-bloco px-2 py-0.5 text-xs font-medium text-texto-secundario">
                          Inativa
                        </span>
                      )}
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

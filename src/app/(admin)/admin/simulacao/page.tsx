import Link from 'next/link'
import { prisma } from '@/infra/db/client'
import { FatorVelocidadeForm } from '@/components/admin/fator-velocidade-form'
import { obterConfigSimulacao } from '@/server/simulacao-config'

const LIMITE_ENVIOS = 30

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Painel da simulação de transporte: a velocidade global e os envios em
 * curso, com o caminho para os controles de cada um.
 *
 * Só aparecem envios que já têm código de rastreio, porque antes da emissão
 * não existe linha do tempo para operar.
 */
export default async function PaginaSimulacao() {
  const [config, envios] = await Promise.all([
    obterConfigSimulacao(),
    prisma.shipment.findMany({
      where: { codigoRastreio: { not: null } },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE_ENVIOS,
      select: {
        id: true,
        codigoRastreio: true,
        status: true,
        cenario: true,
        fatorSimulacao: true,
        criadoEm: true,
        service: { select: { nome: true } },
      },
    }),
  ])

  return (
    <>
      <div>
        <h1 className="text-titulo font-bold text-texto-principal">Simulação de transporte</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          A linha do tempo de cada envio nasce inteira na emissão da etiqueta, já datada no
          futuro. Nada roda em segundo plano: a consulta simplesmente mostra o que já venceu.
        </p>
      </div>

      <FatorVelocidadeForm fatorAtual={config.fatorVelocidade} />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <div>
          <h2 className="text-subtitulo font-semibold text-texto-principal">Envios com rastreio</h2>
          <p className="text-sm text-texto-secundario">
            {envios.length === 0
              ? 'Nenhum envio emitido ainda.'
              : `Últimos ${envios.length} envios emitidos.`}
          </p>
        </div>

        {envios.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-dado">
              <thead className="text-rotulo uppercase text-texto-secundario">
                <tr>
                  <th scope="col" className="py-2 pr-4">Código</th>
                  <th scope="col" className="py-2 pr-4">Serviço</th>
                  <th scope="col" className="py-2 pr-4">Situação</th>
                  <th scope="col" className="py-2 pr-4">Cenário</th>
                  <th scope="col" className="py-2 pr-4">Fator</th>
                  <th scope="col" className="py-2 pr-4">Criado</th>
                  <th scope="col" className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="text-texto-principal">
                {envios.map((envio) => (
                  <tr key={envio.id} className="border-t border-borda-campo">
                    <td className="py-2 pr-4 font-mono text-xs">{envio.codigoRastreio}</td>
                    <td className="py-2 pr-4">{envio.service.nome}</td>
                    <td className="py-2 pr-4">{envio.status}</td>
                    <td className="py-2 pr-4">{envio.cenario}</td>
                    <td className="py-2 pr-4">{envio.fatorSimulacao}×</td>
                    <td className="py-2 pr-4">{dataHora(envio.criadoEm)}</td>
                    <td className="py-2">
                      <Link
                        href={`/admin/simulacao/${envio.id}`}
                        className="font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  )
}

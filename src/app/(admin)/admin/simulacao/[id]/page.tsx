import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/infra/db/client'
import { PainelSimulacaoEnvio } from '@/components/admin/painel-simulacao-envio'
import { codigosPadraoDoMotor } from '@/domain/simulacao/roteiro'
import { catalogoDoUsuario } from '@/server/status-rastreio-service'

function dataHora(valor: Date): string {
  return valor.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

/**
 * Linha do tempo de um envio na visão administrativa, com passado e futuro
 * separados visualmente.
 *
 * É a única tela do sistema que mostra evento futuro — o cliente nunca vê o
 * que ainda não aconteceu, nem esmaecido (spec seção 7). Aqui o futuro
 * aparece justamente porque quem opera precisa saber o que vai acontecer e
 * quando, para decidir se antecipa ou troca o cenário.
 */
export default async function PaginaSimulacaoEnvio({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const agora = new Date()

  const envio = await prisma.shipment.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      codigoRastreio: true,
      status: true,
      cenario: true,
      fatorSimulacao: true,
      simulacaoIniciadaEm: true,
      service: { select: { nome: true, prazoBase: true } },
      trackingEvents: { orderBy: { sequencia: 'asc' } },
    },
  })

  if (!envio) {
    notFound()
  }

  // Os códigos que "aplicar status agora" pode oferecer: os do motor mais os
  // que a conta dona do envio criou. Oferecer um código fora dessa lista daria
  // um erro só na hora de aplicar.
  const catalogo = await catalogoDoUsuario(envio.userId)
  const codigosDisponiveis = [
    ...new Set([...codigosPadraoDoMotor(), ...catalogo.etapasExtras.map((e) => e.codigo)]),
  ]

  const passados = envio.trackingEvents.filter((e) => e.ocorridoEm <= agora)
  const futuros = envio.trackingEvents.filter((e) => e.ocorridoEm > agora)

  const resumo = [
    { rotulo: 'Código', valor: envio.codigoRastreio ?? '—' },
    { rotulo: 'Serviço', valor: envio.service.nome },
    { rotulo: 'Situação', valor: envio.status },
    { rotulo: 'Cenário', valor: envio.cenario },
    { rotulo: 'Fator', valor: `${envio.fatorSimulacao}×` },
    {
      rotulo: 'Simulação iniciada',
      valor: envio.simulacaoIniciadaEm ? dataHora(envio.simulacaoIniciadaEm) : '—',
    },
  ]

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/simulacao"
          className="text-sm font-medium text-brand-texto focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          ← Simulação
        </Link>
        <h1 className="text-titulo font-bold text-texto-principal">
          {envio.codigoRastreio ?? 'Envio sem código'}
        </h1>
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-xl bg-superficie-card p-6 sm:grid-cols-3">
        {resumo.map((item) => (
          <div key={item.rotulo}>
            <p className="text-rotulo uppercase text-texto-secundario">{item.rotulo}</p>
            <p className="text-sm font-medium text-texto-principal">{item.valor}</p>
          </div>
        ))}
      </section>

      <PainelSimulacaoEnvio
        shipmentId={envio.id}
        cenarioAtual={envio.cenario}
        temEventoPendente={futuros.length > 0}
        codigosDisponiveis={codigosDisponiveis}
      />

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          Ocorridos <span className="text-texto-secundario">({passados.length})</span>
        </h2>
        <p className="text-sm text-texto-secundario">
          O cliente já pode ter visto estes eventos. Trocar o cenário não os altera.
        </p>

        {passados.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum evento ocorreu ainda.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {[...passados].reverse().map((evento) => (
              <li key={evento.id} className="border-l-2 border-brand pl-4">
                <p className="text-sm font-medium text-texto-principal">
                  {evento.titulo}
                  {evento.forcado ? (
                    <span className="ml-2 rounded-pilula bg-brand-bg px-2 py-0.5 text-xs text-brand-texto">
                      forçado
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-texto-secundario">{evento.descricao}</p>
                <p className="text-xs text-texto-secundario">
                  {dataHora(evento.ocorridoEm)} · {evento.cidade}/{evento.uf}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-bloco p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          Ainda por acontecer <span className="text-texto-secundario">({futuros.length})</span>
        </h2>
        <p className="text-sm text-texto-secundario">
          Visível só aqui. O cliente nunca vê evento futuro, nem esmaecido.
        </p>

        {futuros.length === 0 ? (
          <p className="text-sm text-texto-secundario">
            A linha do tempo chegou ao fim para este envio.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {futuros.map((evento) => (
              <li key={evento.id} className="border-l-2 border-borda-campo pl-4">
                <p className="text-sm font-medium text-texto-principal">{evento.titulo}</p>
                <p className="text-xs text-texto-secundario">
                  {dataHora(evento.ocorridoEm)} · {evento.cidade}/{evento.uf} · offset{' '}
                  {evento.offsetMinutos} min de simulação
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

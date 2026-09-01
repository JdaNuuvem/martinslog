import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import { gerarRoteiroDeTemplate } from '@/domain/rastreio/template-rastreio'
import { calcularOcorridoEm } from '@/domain/simulacao/roteiro'
import type { LocalidadeSimulacao } from '@/domain/simulacao/tipos'
import { obterTemplate } from './template-rastreio-service'

/**
 * Reescreve a linha do tempo dos envios já emitidos com o template ativo da
 * conta.
 *
 * A emissão grava a timeline inteira de uma vez (ver
 * `emitir-etiqueta-service`), então um template ligado depois só valeria para
 * etiquetas novas. Esta função existe para o caso em que a conta quer o
 * percurso personalizado valendo também para o que já saiu.
 *
 * **É uma reescrita retroativa, e isso tem preço**: um rastreio que o
 * destinatário já consultou pode passar a mostrar outras etapas, e até um
 * status anterior ao que ele viu. Por isso só roda a pedido explícito da
 * conta — nunca como efeito colateral de salvar o template.
 *
 * O relógio da simulação **não** é reiniciado: cada envio mantém o
 * `simulacaoIniciadaEm` e o `fatorSimulacao` da própria emissão, e as datas
 * novas saem dos offsets do template sobre essa mesma origem. Reiniciar
 * jogaria para o futuro envios que já estão em trânsito.
 *
 * Envios cancelados ficam de fora: o percurso deles terminou, e reescrevê-lo
 * inventaria movimentação para uma encomenda que não anda mais.
 */
export async function reaplicarTemplateNosEnvios(userId: string): Promise<number> {
  const template = await obterTemplate(userId)

  if (!template?.ativo) {
    throw new ValorInvalidoError('Nenhum template ativo para esta conta.')
  }

  const envios = await prisma.shipment.findMany({
    where: {
      userId,
      codigoRastreio: { not: null },
      simulacaoIniciadaEm: { not: null },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      remetente: true,
      destinatario: true,
      simulacaoIniciadaEm: true,
      fatorSimulacao: true,
    },
  })

  let reescritos = 0

  for (const envio of envios) {
    const origem = localidade(envio.remetente)
    const destino = localidade(envio.destinatario)

    // Envio sem cidade/UF no endereço copiado não tem como alimentar o
    // roteiro. Pular é melhor que abortar o lote inteiro: um registro
    // estranho não pode impedir a conta de aplicar o próprio percurso.
    if (!origem || !destino || !envio.simulacaoIniciadaEm) {
      continue
    }

    const roteiro = gerarRoteiroDeTemplate(template.passos, origem, destino)
    const fator = envio.fatorSimulacao ?? 1
    const iniciadaEm = envio.simulacaoIniciadaEm

    // Uma transação por envio: um envio termina com a timeline velha ou com a
    // nova, nunca com as duas misturadas. Uma transação única para o lote
    // inteiro seguraria locks em todos os envios da conta enquanto roda.
    await prisma.$transaction(async (tx) => {
      await tx.trackingEvent.deleteMany({ where: { shipmentId: envio.id } })
      await tx.trackingEvent.createMany({
        data: roteiro.map((evento) => ({
          shipmentId: envio.id,
          sequencia: evento.sequencia,
          offsetMinutos: evento.offsetMinutos,
          codigo: evento.codigo,
          status: evento.codigo,
          titulo: evento.titulo,
          descricao: evento.descricao,
          unidadeOrigem: evento.unidadeOrigem,
          unidadeDestino: evento.unidadeDestino,
          cidade: evento.cidade,
          uf: evento.uf,
          ocorridoEm: calcularOcorridoEm(iniciadaEm, evento.offsetMinutos, fator),
        })),
      })
    })

    reescritos += 1
  }

  return reescritos
}

/** Cidade e UF do endereço copiado no envio, ou `null` se não houver. */
function localidade(endereco: unknown): LocalidadeSimulacao | null {
  const registro = endereco as { cidade?: unknown; uf?: unknown } | null

  if (typeof registro?.cidade !== 'string' || typeof registro?.uf !== 'string') {
    return null
  }

  return { cidade: registro.cidade, uf: registro.uf }
}

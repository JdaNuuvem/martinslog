import { prisma } from '@/infra/db/client'
import { registrarLead, type EntradaLead } from './lead-service'

/**
 * Carga inicial da base de leads a partir do que já está no banco.
 *
 * A base passa a ser alimentada na escrita, mas tudo que aconteceu antes de ela
 * existir ficou de fora — e é a maior parte. Esta carga percorre pedidos, envios
 * e conversas já gravados e os apresenta ao mesmo `registrarLead` que roda ao
 * vivo. Chama a função de produção, não uma cópia: se a regra de identidade
 * mudar, a carga muda junto.
 *
 * A ORDEM CRONOLÓGICA importa: reproduz a mesma sequência de fusões que teria
 * acontecido ao vivo.
 *
 * É idempotente: a trava de duplicata em `LeadOrigem` recusa a aparição já
 * registrada, então rodar de novo não duplica linha nem soma total — e uma carga
 * interrompida pode ser retomada do começo.
 */

type Destinatario = {
  nome?: string
  email?: string
  telefone?: string
  documento?: string
}

export type ResultadoCarga = {
  processadas: number
  semChave: number
  falhas: number
}

/** Ordem de tipo para desempatar aparições com o mesmo instante. */
const ORDEM_TIPO: Readonly<Record<EntradaLead['tipo'], number>> = {
  PEDIDO_PENDENTE: 0,
  PEDIDO_PAGO: 1,
  ENVIO: 2,
  CONVERSA: 3,
}

function idDaOrigem(entrada: EntradaLead): string {
  return entrada.pedidoId ?? entrada.shipmentId ?? entrada.conversaId ?? ''
}

/**
 * Todas as aparições do histórico, em ordem cronológica estável.
 *
 * O desempate por tipo e por id existe porque a carga inicial costuma ter
 * muitas linhas com o mesmo instante. Sem ele, duas execuções processariam o
 * empate em ordens diferentes e poderiam escolher sobreviventes diferentes na
 * fusão.
 */
export async function coletarAparicoes(): Promise<EntradaLead[]> {
  const pedidos = await prisma.pedido.findMany({
    select: {
      id: true,
      perfilId: true,
      status: true,
      clienteNome: true,
      clienteFone: true,
      clienteEmail: true,
      valorCentavos: true,
      criadoEm: true,
      pagoEm: true,
    },
  })

  const envios = await prisma.shipment.findMany({
    where: { sandbox: false, codigoRastreio: { not: null } },
    select: { id: true, perfilId: true, destinatario: true, geradoEm: true, criadoEm: true },
  })

  const conversas = await prisma.conversa.findMany({
    select: { id: true, perfilId: true, contato: true, nomeContato: true, criadoEm: true },
  })

  const entradas: EntradaLead[] = [
    /*
      `pagoEm`, e não o status atual: ele só é gravado, nunca apagado. Um
      pedido pago e depois cancelado foi registrado como PAGO pelo fluxo ao
      vivo; olhar só o status faria a carga perder esse valor.
    */
    ...pedidos.map((p): EntradaLead => ({
      tipo: p.pagoEm ? 'PEDIDO_PAGO' : 'PEDIDO_PENDENTE',
      perfilId: p.perfilId,
      pedidoId: p.id,
      ocorridoEm: p.criadoEm,
      nome: p.clienteNome,
      email: p.clienteEmail,
      telefone: p.clienteFone,
      valorCentavos: p.pagoEm ? p.valorCentavos : 0,
    })),
    ...envios.map((e): EntradaLead => {
      const destinatario = (e.destinatario as Destinatario | null) ?? {}
      return {
        tipo: 'ENVIO',
        perfilId: e.perfilId,
        shipmentId: e.id,
        ocorridoEm: e.geradoEm ?? e.criadoEm,
        nome: destinatario.nome,
        email: destinatario.email,
        telefone: destinatario.telefone,
        cpf: destinatario.documento,
      }
    }),
    ...conversas.map((c): EntradaLead => ({
      tipo: 'CONVERSA',
      perfilId: c.perfilId,
      conversaId: c.id,
      ocorridoEm: c.criadoEm,
      nome: c.nomeContato,
      telefone: c.contato,
    })),
  ]

  return entradas.sort(
    (a, b) =>
      a.ocorridoEm.getTime() - b.ocorridoEm.getTime() ||
      ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo] ||
      idDaOrigem(a).localeCompare(idDaOrigem(b)),
  )
}

/**
 * Processa todo o histórico e devolve quantas aparições entraram, quantas não
 * tinham chave utilizável e quantas FALHARAM.
 *
 * Uma aparição que falha não leva as seguintes junto — a próxima execução a
 * reencontra. Mas a falha é CONTADA e devolvida: uma carga que pula em silêncio
 * termina parecendo completa, e sem o segredo da impressão digital ela pularia
 * todo envio com CPF, que é a origem mais importante.
 *
 * O log registra só o tipo e os ids da origem, nunca a entrada inteira: ela
 * carrega CPF, telefone e e-mail em claro, e log não é lugar de dado pessoal.
 */
export async function carregarLeads(): Promise<ResultadoCarga> {
  const entradas = await coletarAparicoes()

  let processadas = 0
  let semChave = 0
  let falhas = 0

  for (const entrada of entradas) {
    try {
      const id = await registrarLead(entrada)
      if (id === null) semChave += 1
    } catch (error) {
      falhas += 1
      console.error('Falha ao processar aparição na carga de leads', {
        tipo: entrada.tipo,
        pedidoId: entrada.pedidoId ?? null,
        shipmentId: entrada.shipmentId ?? null,
        conversaId: entrada.conversaId ?? null,
        cause: error,
      })
    }
    processadas += 1
  }

  return { processadas, semChave, falhas }
}

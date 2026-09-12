import type { OrigemLead, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { cifrarCampo } from '@/infra/crypto/campo'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from '@/domain/lead/identidade'

/**
 * A base de leads da plataforma.
 *
 * Uma pessoa, uma linha — ainda que ela tenha comprado em três lojas. É a
 * diferença entre "quem são nossos compradores" e "quantas linhas de pedido
 * existem", e nenhuma tabela respondia a primeira pergunta.
 */

export type EntradaLead = {
  tipo: OrigemLead
  perfilId?: string | null
  pedidoId?: string | null
  shipmentId?: string | null
  conversaId?: string | null
  ocorridoEm: Date
  nome?: string | null
  email?: string | null
  telefone?: string | null
  cpf?: string | null
  valorCentavos?: number
}

/** Nome vindo destas origens tem precedência sobre o das outras. */
const ORIGENS_COM_NOME_CONFIAVEL: readonly OrigemLead[] = ['ENVIO', 'PEDIDO_PAGO', 'PEDIDO_PENDENTE']

/**
 * Registra uma aparição da pessoa, criando, atualizando ou fundindo leads.
 *
 * Devolve o id do lead, ou `null` quando a entrada não trouxe CPF, telefone
 * nem e-mail — sem nenhuma chave não há como reconhecer essa pessoa da
 * próxima vez, e um lead que nunca casa com nada só engorda a base.
 */
export async function registrarLead(entrada: EntradaLead): Promise<string | null> {
  const cpf = normalizarCpf(entrada.cpf)
  const telefone = normalizarTelefoneLead(entrada.telefone)
  const email = normalizarEmail(entrada.email)

  if (!cpf && !telefone && !email) return null

  const cpfHash = cpf ? impressaoDigitalCpf(cpf) : null

  /*
    UMA nova tentativa quando duas aparições da mesma pessoa nova correm juntas.

    Não é hipótese: o aviso de pagamento já documenta, em `sms-service`, que o
    pedido marcado PAGO e o envio pago chegam com segundos de diferença. As
    duas transações procuram, não acham ninguém e tentam criar o mesmo lead —
    a segunda bate na chave única, e a transação dela aborta. Sem a nova
    tentativa, o chamador registra o erro no log e aquela aparição some da
    base. Na segunda tentativa a procura já encontra o lead que a primeira
    criou, e a aparição é somada a ele.

    Uma tentativa só: se falhar de novo, o problema não é corrida, e insistir
    esconderia o defeito real.
  */
  try {
    return await registrarNaTransacao(entrada, { cpf, cpfHash, telefone, email })
  } catch (erro) {
    if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') {
      return registrarNaTransacao(entrada, { cpf, cpfHash, telefone, email })
    }
    throw erro
  }
}

async function registrarNaTransacao(
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const { cpf, cpfHash, telefone, email } = chaves

  return prisma.$transaction(async (tx) => {
    /*
      TODOS os leads que casam com QUALQUER chave, não só o primeiro.

      Procurar só até o primeiro acerto deixa a fusão sem efeito no caso que
      ela existe para resolver: a pessoa que chamou no WhatsApp (telefone) e
      depois fez um envio (CPF) tem dois leads, e o envio que traz os dois
      dados casa pelo CPF, encontra o lead do CPF, confere que o dono do CPF
      é ele mesmo — e nunca descobre o gêmeo do telefone.
    */
    const candidatos = await leadsQueCasam(tx, { cpfHash, telefone, email })

    const leadId =
      candidatos.length === 0
        ? await criarLead(tx, entrada, { cpf, cpfHash, telefone, email })
        : await consolidar(tx, candidatos, entrada, { cpf, cpfHash, telefone, email })

    await registrarOrigem(tx, leadId, entrada)

    return leadId
  })
}

type Chaves = {
  cpfHash: string | null
  telefone: string | null
  email: string | null
}

type Tx = Prisma.TransactionClient

/**
 * Todos os leads que casam com alguma das chaves, sem repetir.
 *
 * Devolve uma lista, e não o primeiro acerto, porque é a lista que revela a
 * duplicata: dois leads aqui significam a mesma pessoa que entrou na base por
 * dois caminhos diferentes, e é isso que `consolidar` conserta.
 *
 * A busca por chave é exata nas três: as colunas são únicas, e o que decide
 * se dois valores são "o mesmo" já foi resolvido na normalização.
 *
 * O `orderBy` tem três níveis, e não um só. Com contato empatado, sobrevive
 * o que entrou na base primeiro (`criadoEm`); `id` fecha a ordem total, pois
 * dois leads podem até empatar em `criadoEm`. Sem esse desempate, uma carga
 * inicial com horários iguais — ou dois eventos que aconteceram ao mesmo
 * tempo — faria o Postgres devolver as linhas empatadas em ordem arbitrária,
 * e o sobrevivente da fusão viraria sorteio a cada execução; e esse id pode
 * já estar referenciado em outro lugar que leu a base antes.
 */
async function leadsQueCasam(tx: Tx, chaves: Chaves) {
  const achados = await tx.lead.findMany({
    where: {
      OR: [
        ...(chaves.cpfHash ? [{ cpfHash: chaves.cpfHash }] : []),
        ...(chaves.telefone ? [{ telefoneNormalizado: chaves.telefone }] : []),
        ...(chaves.email ? [{ emailNormalizado: chaves.email }] : []),
      ],
    },
    orderBy: [{ primeiroContatoEm: 'asc' }, { criadoEm: 'asc' }, { id: 'asc' }],
  })

  return achados
}

type Candidato = Awaited<ReturnType<typeof leadsQueCasam>>[number]

async function criarLead(tx: Tx, entrada: EntradaLead, chaves: Chaves & { cpf: string | null }) {
  const lead = await tx.lead.create({
    data: {
      nome: entrada.nome?.trim() || null,
      email: entrada.email?.trim() || null,
      emailNormalizado: chaves.email,
      telefone: entrada.telefone?.trim() || null,
      telefoneNormalizado: chaves.telefone,
      cpfHash: chaves.cpfHash,
      cpfCifrado: chaves.cpf ? cifrarCampo(chaves.cpf) : null,
      primeiroContatoEm: entrada.ocorridoEm,
      ultimoContatoEm: entrada.ocorridoEm,
    },
  })

  return lead.id
}

/**
 * Reduz os candidatos a um lead só e escreve nele o que a aparição trouxe.
 *
 * O ALVO é o primeiro da ordem (contato mais antigo) ENTRE os candidatos
 * COMPATÍVEIS com o CPF da entrada — `cpfHash` nulo, ou igual ao da entrada.
 * Sem CPF na entrada, todos são compatíveis e vale o primeiro da ordem puro e
 * simples, como sempre foi.
 *
 * Não basta pegar sempre o primeiro da ordem, ignorando o CPF: um candidato
 * mais antigo que carrega o CPF de OUTRA pessoa — e só casou pelo telefone
 * compartilhado — não pode virar o dono da aparição de quem tem o CPF da
 * entrada. Isso jogaria a origem na pessoa errada. E não basta ir direto no
 * dono do CPF, ignorando a ordem: isso faria o CPF vencer mesmo quando não
 * há conflito nenhum, quebrando a regra de que o de contato mais antigo
 * sobrevive.
 *
 * Quando a entrada tem CPF e NENHUM candidato é compatível — todos têm CPF
 * preenchido e diferente do da entrada — não há alvo possível: cair em
 * `candidatos[0]` jogaria a origem (e o valor do pedido) na pessoa errada só
 * porque ela compartilha telefone ou e-mail com o dono do CPF novo. Nesse
 * caso a função cria um lead novo para o CPF, e não funde nada.
 *
 * Nem todo candidato é fundido no alvo. Um candidato entra em duas checagens
 * de "pessoa distinta": contra o CPF da PRÓPRIA ENTRADA, e contra o CPF já
 * acumulado no alvo. As duas são necessárias — só a segunda deixaria uma
 * fusão transitiva desviar a aparição: um candidato com CPF diferente do da
 * entrada, mas que casa por telefone/e-mail e chega antes do dono do CPF na
 * lista, seria fundido no alvo (que ainda não tinha CPF) antes de a fusão
 * seguinte descobrir o conflito — e o CPF que "vence" no alvo acaba sendo o
 * do candidato errado, não o da entrada.
 *
 * O alvo é relido após cada fusão, porque ele pode ter ganhado um `cpfHash`
 * do absorvido — e esse CPF novo pode entrar em conflito com o próximo
 * candidato da lista.
 */
async function consolidar(
  tx: Tx,
  candidatos: Candidato[],
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const compativelComEntrada = (c: Candidato) =>
    chaves.cpfHash === null || c.cpfHash === null || c.cpfHash === chaves.cpfHash

  const alvoCompativel = candidatos.find(compativelComEntrada)

  if (chaves.cpfHash !== null && !alvoCompativel) {
    return criarLeadParaCpfSemCandidatoCompativel(tx, entrada, chaves)
  }

  const alvo = alvoCompativel ?? candidatos[0]!
  const alvoId = alvo.id
  let alvoCpfHash = alvo.cpfHash

  for (const candidato of candidatos) {
    if (candidato.id === alvoId) continue

    const pessoasDistintas =
      (chaves.cpfHash !== null &&
        candidato.cpfHash !== null &&
        candidato.cpfHash !== chaves.cpfHash) ||
      (alvoCpfHash !== null && candidato.cpfHash !== null && alvoCpfHash !== candidato.cpfHash)
    if (pessoasDistintas) continue

    await fundir(tx, alvoId, candidato.id)

    const atualizado = await tx.lead.findUniqueOrThrow({
      where: { id: alvoId },
      select: { cpfHash: true },
    })
    alvoCpfHash = atualizado.cpfHash
  }

  return aplicarDados(tx, alvoId, entrada, chaves)
}

/**
 * Cria um lead novo para o dono de um CPF sem candidato compatível.
 *
 * Telefone e e-mail só entram no lead novo se nenhum OUTRO lead já os
 * segurar — é exatamente esse compartilhamento que fez a busca encontrar
 * candidatos incompatíveis em primeiro lugar, e gravar por cima bateria na
 * chave única deles.
 */
async function criarLeadParaCpfSemCandidatoCompativel(
  tx: Tx,
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const emailLivre = chaves.email ? await valorLivre(tx, 'emailNormalizado', chaves.email) : false
  const telefoneLivre = chaves.telefone
    ? await valorLivre(tx, 'telefoneNormalizado', chaves.telefone)
    : false

  const lead = await tx.lead.create({
    data: {
      nome: entrada.nome?.trim() || null,
      email: emailLivre ? entrada.email?.trim() || null : null,
      emailNormalizado: emailLivre ? chaves.email : null,
      telefone: telefoneLivre ? entrada.telefone?.trim() || null : null,
      telefoneNormalizado: telefoneLivre ? chaves.telefone : null,
      cpfHash: chaves.cpfHash,
      cpfCifrado: chaves.cpf ? cifrarCampo(chaves.cpf) : null,
      primeiroContatoEm: entrada.ocorridoEm,
      ultimoContatoEm: entrada.ocorridoEm,
    },
  })

  return lead.id
}

/**
 * Junta dois leads que são a mesma pessoa. O `sobrevivente` fica; o
 * `absorvido` deixa de existir.
 *
 * A ORDEM importa: `emailNormalizado`, `telefoneNormalizado` e `cpfHash` são
 * únicos, então copiar o telefone do absorvido para o sobrevivente enquanto
 * os dois existem viola a restrição e aborta a transação inteira. Por isso o
 * absorvido é lido, depois apagado, e só então os valores são reatribuídos.
 *
 * O `cpfHash` (e o `cpfCifrado` junto) entra na mesma regra de "preenche só
 * se estiver vazio" que os outros campos — e não pode ficar de fora dela.
 * Sem copiar o CPF do absorvido, um lead só com telefone que absorve um lead
 * com CPF e e-mail perderia o CPF na fusão; o próximo pedido com aquele CPF
 * não encontraria mais nenhum lead com ele e recriaria a duplicata que a
 * fusão devia ter eliminado.
 */
async function fundir(tx: Tx, sobreviventeId: string, absorvidoId: string): Promise<void> {
  const absorvido = await tx.lead.findUniqueOrThrow({ where: { id: absorvidoId } })
  const sobrevivente = await tx.lead.findUniqueOrThrow({ where: { id: sobreviventeId } })

  await tx.leadOrigem.updateMany({
    where: { leadId: absorvidoId },
    data: { leadId: sobreviventeId },
  })

  await tx.lead.delete({ where: { id: absorvidoId } })

  /*
    totalPedidos não é soma. Cada lead pode ter contado o MESMO pedido — um
    pedido pendente registrado num lead só com telefone e o mesmo pedido,
    já pago, registrado noutro lead só com e-mail — antes de a fusão revelar
    que eram a mesma pessoa. Somar os dois totais contaria esse pedido duas
    vezes. Por isso o total é recalculado do zero, contando `pedidoId`
    distintos entre as origens (já movidas para o sobrevivente) de pedido.
  */
  const origensDePedido = await tx.leadOrigem.findMany({
    where: { leadId: sobreviventeId, tipo: { in: ['PEDIDO_PENDENTE', 'PEDIDO_PAGO'] } },
    select: { pedidoId: true },
  })
  const totalPedidos = new Set(origensDePedido.map((o) => o.pedidoId)).size

  await tx.lead.update({
    where: { id: sobreviventeId },
    data: {
      nome: sobrevivente.nome ?? absorvido.nome,
      email: sobrevivente.email ?? absorvido.email,
      emailNormalizado: sobrevivente.emailNormalizado ?? absorvido.emailNormalizado,
      telefone: sobrevivente.telefone ?? absorvido.telefone,
      telefoneNormalizado: sobrevivente.telefoneNormalizado ?? absorvido.telefoneNormalizado,
      cpfHash: sobrevivente.cpfHash ?? absorvido.cpfHash,
      cpfCifrado: sobrevivente.cpfCifrado ?? absorvido.cpfCifrado,
      totalPedidos,
      // ENVIO e PEDIDO_PAGO têm chave de idempotência global (shipmentId e
      // pedidoId não se repetem entre leads diferentes), então somar os dois
      // lados aqui não conta nada duas vezes — diferente de totalPedidos.
      totalEnvios: sobrevivente.totalEnvios + absorvido.totalEnvios,
      valorTotalCentavos: sobrevivente.valorTotalCentavos + absorvido.valorTotalCentavos,
      primeiroContatoEm:
        absorvido.primeiroContatoEm < sobrevivente.primeiroContatoEm
          ? absorvido.primeiroContatoEm
          : sobrevivente.primeiroContatoEm,
      ultimoContatoEm:
        absorvido.ultimoContatoEm > sobrevivente.ultimoContatoEm
          ? absorvido.ultimoContatoEm
          : sobrevivente.ultimoContatoEm,
    },
  })
}

/**
 * Verdadeiro quando nenhum lead já segura este valor normalizado — ou nenhum
 * OUTRO lead, quando `excetoLeadId` é passado.
 *
 * Usada em dois lugares: ao criar um lead novo (sem `excetoLeadId`, porque
 * o lead ainda não existe) e ao preencher um campo vazio de um lead que já
 * existe, onde um candidato pulado por `consolidar` — pessoa distinta, CPF
 * diferente — pode mesmo assim compartilhar telefone ou e-mail com ele.
 * Gravar por cima sem checar bateria na restrição única daquele outro lead e
 * abortaria a transação inteira.
 */
async function valorLivre(
  tx: Tx,
  campo: 'emailNormalizado' | 'telefoneNormalizado' | 'cpfHash',
  valor: string,
  excetoLeadId?: string,
): Promise<boolean> {
  const outro = await tx.lead.findFirst({
    where: excetoLeadId ? { [campo]: valor, NOT: { id: excetoLeadId } } : { [campo]: valor },
  })
  return outro === null
}

/**
 * Escreve no lead o que a aparição nova trouxe.
 *
 * A regra é conservadora: campo vazio é preenchido, campo preenchido fica
 * como está. Sem ela o último a chegar sempre vence e o nome do lead oscila
 * a cada mensagem de WhatsApp. As exceções estão comentadas onde valem.
 */
async function aplicarDados(
  tx: Tx,
  leadId: string,
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const atual = await tx.lead.findUniqueOrThrow({ where: { id: leadId } })

  /*
    O nome do envio ou do pedido vence o da conversa mesmo quando já há um
    nome gravado: o do envio foi digitado para uma etiqueta, e o da conversa
    é o apelido que a pessoa escolheu no WhatsApp — costuma ter emoji e
    raramente é o nome civil.
  */
  const nomeNovo = entrada.nome?.trim() || null
  const nomeVence =
    nomeNovo !== null && (atual.nome === null || ORIGENS_COM_NOME_CONFIAVEL.includes(entrada.tipo))

  // Só preenche um campo vazio se nenhum outro lead já segurar aquele valor
  // (ver `valorLivre`). Campo já preenchido nunca é reavaliado aqui.
  const emailLivre =
    !atual.emailNormalizado && chaves.email
      ? await valorLivre(tx, 'emailNormalizado', chaves.email, leadId)
      : false
  const telefoneLivre =
    !atual.telefoneNormalizado && chaves.telefone
      ? await valorLivre(tx, 'telefoneNormalizado', chaves.telefone, leadId)
      : false
  // O CPF, uma vez conhecido, nunca é trocado: ele é a chave de identidade,
  // e trocá-lo transformaria o lead em outra pessoa. Só entra quando o atual
  // está vazio.
  const cpfHashLivre =
    !atual.cpfHash && chaves.cpfHash
      ? await valorLivre(tx, 'cpfHash', chaves.cpfHash, leadId)
      : false

  await tx.lead.update({
    where: { id: leadId },
    data: {
      nome: nomeVence ? nomeNovo : atual.nome,
      email: emailLivre ? entrada.email?.trim() || null : atual.email,
      emailNormalizado: emailLivre ? chaves.email : atual.emailNormalizado,
      telefone: telefoneLivre ? entrada.telefone?.trim() || null : atual.telefone,
      telefoneNormalizado: telefoneLivre ? chaves.telefone : atual.telefoneNormalizado,
      cpfHash: cpfHashLivre ? chaves.cpfHash : atual.cpfHash,
      cpfCifrado: cpfHashLivre && chaves.cpf ? cifrarCampo(chaves.cpf) : atual.cpfCifrado,
      primeiroContatoEm:
        entrada.ocorridoEm < atual.primeiroContatoEm ? entrada.ocorridoEm : atual.primeiroContatoEm,
      ultimoContatoEm:
        entrada.ocorridoEm > atual.ultimoContatoEm ? entrada.ocorridoEm : atual.ultimoContatoEm,
    },
  })

  return leadId
}

/**
 * Grava a aparição e soma os totais.
 *
 * Os totais só sobem quando a origem é NOVA — assim reprocessar um pedido não
 * conta a compra duas vezes.
 *
 * **`createMany` com `skipDuplicates`, e não `create` com `try/catch`.** É a
 * diferença entre funcionar e perder dado em silêncio. No Postgres, um comando
 * que falha dentro de uma transação ABORTA a transação inteira: capturar o
 * `P2002` e seguir em frente não desfaz o erro, e o `COMMIT` que o Prisma
 * emite no fim vira `ROLLBACK` sem avisar ninguém. A atualização do lead feita
 * segundos antes, na mesma transação, iria junto.
 *
 * `skipDuplicates` emite `ON CONFLICT DO NOTHING`: a linha repetida é
 * ignorada sem erro, a transação continua viva, e `count` diz se a origem era
 * nova. A cláusula respeita o índice `NULLS NOT DISTINCT` (Postgres 15+).
 */
async function registrarOrigem(tx: Tx, leadId: string, entrada: EntradaLead): Promise<void> {
  const { count } = await tx.leadOrigem.createMany({
    data: [
      {
        leadId,
        tipo: entrada.tipo,
        perfilId: entrada.perfilId ?? null,
        pedidoId: entrada.pedidoId ?? null,
        shipmentId: entrada.shipmentId ?? null,
        conversaId: entrada.conversaId ?? null,
        ocorridoEm: entrada.ocorridoEm,
      },
    ],
    skipDuplicates: true,
  })

  // Origem já registrada: é o caminho normal da carga inicial ao ser
  // retomada, e nada mais deve acontecer — nem os totais podem subir.
  if (count === 0) return

  /*
    Um `pedidoId` pode gerar duas origens: uma como PEDIDO_PENDENTE e, depois,
    outra como PEDIDO_PAGO — o índice de idempotência inclui o `tipo`, então
    são linhas distintas e as duas passam pelo `count === 1` acima. Sem esta
    checagem, `totalPedidos` subiria duas vezes para o mesmo pedido no fluxo
    ao vivo — e divergiria da carga inicial (Task 5), que vê o pedido já pago
    e gera uma origem só. O mesmo lead teria totais diferentes conforme a
    aparição veio da carga ou do fluxo ao vivo.

    `valorTotalCentavos` não tem esse problema: só PEDIDO_PAGO carrega valor,
    então não há soma dupla de dinheiro a evitar. `totalEnvios` também não
    muda aqui.
  */
  const ehPrimeiraOrigemDoPedido =
    entrada.pedidoId === null || entrada.pedidoId === undefined
      ? true
      : (await tx.leadOrigem.count({ where: { leadId, pedidoId: entrada.pedidoId } })) === 1

  await tx.lead.update({
    where: { id: leadId },
    data: {
      totalPedidos:
        (entrada.tipo === 'PEDIDO_PAGO' || entrada.tipo === 'PEDIDO_PENDENTE') &&
        ehPrimeiraOrigemDoPedido
          ? { increment: 1 }
          : undefined,
      totalEnvios: entrada.tipo === 'ENVIO' ? { increment: 1 } : undefined,
      // Só PEDIDO_PAGO carrega valor de compra de verdade; um valor vindo de
      // outro tipo de origem não deveria existir, mas a checagem explícita
      // evita que um `valorCentavos` incidental de ENVIO ou CONVERSA some.
      valorTotalCentavos:
        entrada.tipo === 'PEDIDO_PAGO' && entrada.valorCentavos
          ? { increment: entrada.valorCentavos }
          : undefined,
    },
  })
}

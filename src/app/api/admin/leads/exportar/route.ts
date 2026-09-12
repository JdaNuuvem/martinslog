import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { exigirAdmin } from '@/server/admin/guarda'
import { decifrarCampo } from '@/infra/crypto/campo'
import { listarLeads, TETO_EXPORTACAO, type FiltroLeads } from '@/server/admin/consulta-leads'
import { dataDoParametro } from '@/lib/filtro-periodo'
import { ORIGENS, buscaLeadsSchema } from '@/lib/leads-schema'

/**
 * `GET /api/admin/leads/exportar` — a base filtrada, em CSV.
 *
 * O CPF sai MASCARADO por padrão. Sair completo exige `cpfCompleto=true`, que
 * na tela é uma caixa que diz o que está fazendo.
 *
 * Toda exportação grava `AuditLog` com o número de linhas e os filtros
 * usados. Quando o arquivo sai do sistema ninguém mais controla onde ele
 * para — o registro é a única forma de responder depois quem levou esses
 * dados e quando.
 */

/** Escapa um campo para CSV, protegendo contra injeção de fórmula. */
function celula(valor: string | number | null): string {
  const texto = String(valor ?? '')

  /*
    Um valor começando por `=`, `+`, `-`, `@`, tabulação (`\t`) ou retorno de
    carro (`\r`) é interpretado como FÓRMULA pelo Excel e pelo Google Sheets
    ao abrir o arquivo — os dois últimos porque o programa ignora espaço em
    branco antes de procurar o sinal de fórmula. Um nome cadastrado como
    `=HYPERLINK(...)` vira código executado na máquina de quem abre a
    planilha — e o nome vem do comprador, que digitou o que quis no checkout.
    O apóstrofo à frente neutraliza isso.
  */
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto

  return `"${seguro.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const parametros = request.nextUrl.searchParams
  const cpfCompleto = parametros.get('cpfCompleto') === 'true'

  /*
    Os MESMOS filtros da tela, com os mesmos nomes de parâmetro (`busca`, `loja`,
    `origem`, `desde`, `ate`) e a mesma regra de data (`dataDoParametro`).

    Ler só busca e loja exportaria mais do que o admin estava vendo: quem filtra
    "pedidos não finalizados de setembro" e clica em exportar receberia a base
    inteira daquela loja, sem nada no arquivo dizendo que o filtro foi ignorado.

    `todas: true` — a exportação leva tudo que casa com o filtro, não a primeira
    página. Exportar cinquenta linhas de uma base de oito mil e chamar o arquivo
    de "leads.csv" seria entregar um recorte silencioso.
  */
  const origemBruta = parametros.get('origem') ?? ''
  const filtro: FiltroLeads = {
    busca: buscaLeadsSchema.parse(parametros.get('busca') ?? '') || undefined,
    perfilId: parametros.get('loja') || undefined,
    origem: (ORIGENS as readonly string[]).includes(origemBruta)
      ? (origemBruta as FiltroLeads['origem'])
      : undefined,
    desde: dataDoParametro(parametros.get('desde')),
    ate: dataDoParametro(parametros.get('ate'), true),
    todas: true,
  }

  try {
    const { leads, total } = await listarLeads(filtro)

    if (total > TETO_EXPORTACAO) {
      return NextResponse.json(
        {
          codigo: 'EXPORTACAO_GRANDE_DEMAIS',
          mensagem: `São ${total} leads e o limite por arquivo é ${TETO_EXPORTACAO}. Estreite o filtro por período ou por loja.`,
        },
        { status: 422 },
      )
    }

    const linhas = [
      ['Nome', 'E-mail', 'Telefone', 'CPF', 'Lojas', 'Pedidos', 'Envios', 'Valor total', 'Último contato']
        .map(celula)
        .join(','),
    ]

    /*
      Com CPF completo, decifra em LOTE e registra UMA linha de auditoria para
      a exportação inteira — a que já é gravada logo abaixo.

      Chamar `revelarCpf` por lead gravaria uma linha por pessoa: dez mil
      registros para uma exportação afogariam justamente o log que existe para
      ser lido. A linha do lote já responde quem exportou, quantos e com quais
      filtros, que é a pergunta que se faz depois.
    */
    const cpfPorLead = new Map<string, string>()

    if (cpfCompleto) {
      const cifrados = await prisma.lead.findMany({
        where: { id: { in: leads.map((l) => l.id) } },
        select: { id: true, cpfCifrado: true },
      })

      for (const registro of cifrados) {
        if (registro.cpfCifrado) cpfPorLead.set(registro.id, decifrarCampo(registro.cpfCifrado))
      }
    }

    for (const lead of leads) {
      const cpf = cpfCompleto
        ? (cpfPorLead.get(lead.id) ?? '')
        : (lead.cpfMascarado ?? '')

      linhas.push(
        [
          lead.nome,
          lead.email,
          lead.telefone,
          cpf,
          lead.lojas.join(' | '),
          lead.totalPedidos,
          lead.totalEnvios,
          (lead.valorTotalCentavos / 100).toFixed(2),
          lead.ultimoContatoEm,
        ]
          .map(celula)
          .join(','),
      )
    }

    /*
      A tabela que registra acesso a dado pessoal não pode guardar o próprio
      dado pessoal. Gravar `parametros.entries()` inteiro grava a `busca`
      crua — e o termo digitado costuma SER o CPF, o telefone ou o e-mail que
      a exportação existe para proteger. Um CPF sem cifra na auditoria é o
      mesmo problema que a cifra de campo resolve na tabela de leads, só que
      numa tabela sem essa proteção. Por isso só as chaves conhecidas entram,
      a busca vira um booleano, e `desde`/`ate` são o valor JÁ INTERPRETADO
      por `dataDoParametro` — nunca o texto cru da URL. Nada do que vai para
      `depois` chega direto da query string sem passar por uma validação
      antes.
    */
    await prisma.auditLog.create({
      data: {
        actorUserId: guarda.sessao.userId,
        acao: 'LEADS_EXPORTADOS',
        entidade: 'Lead',
        entidadeId: 'exportacao',
        depois: {
          linhas: leads.length,
          totalNaBase: total,
          cpfCompleto,
          filtros: {
            loja: filtro.perfilId ?? null,
            origem: filtro.origem ?? null,
            desde: filtro.desde?.toISOString() ?? null,
            ate: filtro.ate?.toISOString() ?? null,
            buscaInformada: Boolean(filtro.busca),
          },
        },
      },
    })

    return new NextResponse(linhas.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Erro inesperado ao exportar leads', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao exportar.' },
      { status: 500 },
    )
  }
}

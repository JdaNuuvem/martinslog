import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError } from '@/domain/errors'

/** Colunas exigidas, na ordem documentada para o arquivo de importação. */
const COLUNAS = [
  'servico',
  'cep_origem_ini',
  'cep_origem_fim',
  'cep_destino_ini',
  'cep_destino_fim',
  'peso_min_g',
  'peso_max_g',
  'preco_balcao',
  'preco_venda',
  'prazo_dias',
] as const

/**
 * Detecta o separador de colunas pelo cabeçalho.
 *
 * Planilha brasileira exporta com `;` justamente porque a vírgula é o
 * separador decimal do preço: com `,` nos dois papéis, `14,16` viraria duas
 * colunas. Aceitar os dois evita exigir que a pessoa edite o arquivo à mão
 * antes de importar.
 */
function detectarDelimitador(cabecalho: string): ';' | ',' {
  return cabecalho.includes(';') ? ';' : ','
}

export type LinhaTabela = {
  servico: string
  cepOrigemIni: number
  cepOrigemFim: number
  cepDestinoIni: number
  cepDestinoFim: number
  pesoMinG: number
  pesoMaxG: number
  precoBalcaoCentavos: number
  precoVendaCentavos: number
  prazoDias: number
}

/**
 * Converte preço em reais para centavos. Aceita vírgula ou ponto como
 * separador decimal, porque a planilha de origem é brasileira e o mesmo
 * arquivo costuma sair dos dois jeitos. A conversão é feita sobre a string,
 * não com aritmética de ponto flutuante: `14,16 * 100` em float dá
 * 1415,9999999999998, e um centavo perdido por linha vira divergência de
 * caixa.
 */
function paraCentavos(valor: string, numeroLinha: number, coluna: string): number {
  const normalizado = valor.replace(',', '.')

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalizado)) {
    throw new ArquivoInvalidoError(
      `Preço inválido em "${coluna}" na linha ${numeroLinha}: "${valor}". Use reais com até duas casas (ex.: 14,16).`,
    )
  }

  const [inteiros, decimais = ''] = normalizado.split('.')
  const centavos = Number(`${inteiros}${decimais.padEnd(2, '0')}`)

  if (centavos < 0) {
    throw new ArquivoInvalidoError(
      `Preço negativo em "${coluna}" na linha ${numeroLinha}: "${valor}".`,
    )
  }

  return centavos
}

function paraInteiro(valor: string, numeroLinha: number, coluna: string): number {
  if (!/^\d+$/.test(valor)) {
    throw new ArquivoInvalidoError(
      `Número inválido em "${coluna}" na linha ${numeroLinha}: "${valor}".`,
    )
  }

  return Number(valor)
}

/**
 * Lê o CSV inteiro e devolve as linhas já convertidas, ou lança na primeira
 * inconsistência informando o número da linha **no arquivo** (o cabeçalho é
 * a linha 1), que é o que a pessoa vê aberto na planilha.
 *
 * Função pura: não toca no banco. Assim a validação do arquivo pode ser
 * exercitada sem transação, e `importarTabela` só abre a transação com um
 * arquivo já inteiramente aceito.
 */
export function analisarTabelaCsv(conteudo: string): LinhaTabela[] {
  const linhas = conteudo.split(/\r?\n/)
  const delimitador = detectarDelimitador(linhas[0] ?? '')
  const cabecalho = (linhas[0] ?? '')
    .split(delimitador)
    .map((coluna) => coluna.trim().toLowerCase())

  const faltando = COLUNAS.filter((coluna) => !cabecalho.includes(coluna))
  if (faltando.length > 0) {
    throw new ArquivoInvalidoError(
      `Cabeçalho inválido. Coluna(s) ausente(s): ${faltando.join(', ')}.`,
    )
  }

  const indice = Object.fromEntries(
    COLUNAS.map((coluna) => [coluna, cabecalho.indexOf(coluna)]),
  ) as Record<(typeof COLUNAS)[number], number>

  const resultado: LinhaTabela[] = []

  for (let i = 1; i < linhas.length; i += 1) {
    const bruta = linhas[i] ?? ''
    const numeroLinha = i + 1

    // Linha em branco no fim do arquivo é resíduo de editor, não erro.
    if (bruta.trim() === '') continue

    const campos = bruta.split(delimitador).map((campo) => campo.trim())
    if (campos.length !== cabecalho.length) {
      throw new ArquivoInvalidoError(
        `Linha ${numeroLinha} tem ${campos.length} colunas; o cabeçalho tem ${cabecalho.length}.`,
      )
    }

    const campo = (coluna: (typeof COLUNAS)[number]): string => campos[indice[coluna]] ?? ''

    const servico = campo('servico')
    if (servico === '') {
      throw new ArquivoInvalidoError(`Serviço vazio na linha ${numeroLinha}.`)
    }

    const cepOrigemIni = paraInteiro(campo('cep_origem_ini'), numeroLinha, 'cep_origem_ini')
    const cepOrigemFim = paraInteiro(campo('cep_origem_fim'), numeroLinha, 'cep_origem_fim')
    const cepDestinoIni = paraInteiro(campo('cep_destino_ini'), numeroLinha, 'cep_destino_ini')
    const cepDestinoFim = paraInteiro(campo('cep_destino_fim'), numeroLinha, 'cep_destino_fim')
    const pesoMinG = paraInteiro(campo('peso_min_g'), numeroLinha, 'peso_min_g')
    const pesoMaxG = paraInteiro(campo('peso_max_g'), numeroLinha, 'peso_max_g')
    const prazoDias = paraInteiro(campo('prazo_dias'), numeroLinha, 'prazo_dias')

    if (cepOrigemIni > cepOrigemFim) {
      throw new ArquivoInvalidoError(
        `Faixa de CEP de origem invertida na linha ${numeroLinha}: ${cepOrigemIni} > ${cepOrigemFim}.`,
      )
    }
    if (cepDestinoIni > cepDestinoFim) {
      throw new ArquivoInvalidoError(
        `Faixa de CEP de destino invertida na linha ${numeroLinha}: ${cepDestinoIni} > ${cepDestinoFim}.`,
      )
    }
    if (pesoMinG >= pesoMaxG) {
      throw new ArquivoInvalidoError(
        `Faixa de peso inválida na linha ${numeroLinha}: mínimo ${pesoMinG} não é menor que o máximo ${pesoMaxG}.`,
      )
    }
    if (prazoDias < 1) {
      throw new ArquivoInvalidoError(
        `Prazo inválido na linha ${numeroLinha}: ${prazoDias}. O prazo mínimo é 1 dia.`,
      )
    }

    resultado.push({
      servico,
      cepOrigemIni,
      cepOrigemFim,
      cepDestinoIni,
      cepDestinoFim,
      pesoMinG,
      pesoMaxG,
      precoBalcaoCentavos: paraCentavos(campo('preco_balcao'), numeroLinha, 'preco_balcao'),
      precoVendaCentavos: paraCentavos(campo('preco_venda'), numeroLinha, 'preco_venda'),
      prazoDias,
    })
  }

  if (resultado.length === 0) {
    throw new ArquivoInvalidoError('O arquivo não tem nenhuma linha de dados.')
  }

  return resultado
}

export type ResultadoImportacao = {
  importadas: number
  servicos: string[]
}

/**
 * Importa a tabela de preço substituindo, por serviço, as regras anteriores.
 *
 * Duas garantias sustentam isso:
 * - **Tudo ou nada.** O arquivo é validado inteiro antes da transação, e a
 *   escrita acontece dentro de uma só transação. Tabela de preço importada
 *   pela metade é pior que nenhuma: cotação passaria a devolver preço de
 *   duas tabelas diferentes conforme a faixa.
 * - **Substituição, não acúmulo.** As regras antigas dos serviços presentes
 *   no arquivo são apagadas; sem isso, a faixa velha e a nova coexistiriam
 *   e a seleção de tarifa viraria loteria entre elas.
 *
 * O `AuditLog` guarda quantas regras entraram e quantas saíram, com o ator.
 */
export async function importarTabela(
  actorUserId: string,
  conteudo: string,
): Promise<ResultadoImportacao> {
  const linhas = analisarTabelaCsv(conteudo)

  const codigosServico = [...new Set(linhas.map((linha) => linha.servico))]
  const servicos = await prisma.service.findMany({
    where: { codigo: { in: codigosServico } },
    select: { id: true, codigo: true },
  })

  const idPorCodigo = new Map(servicos.map((servico) => [servico.codigo, servico.id]))
  const desconhecidos = codigosServico.filter((codigo) => !idPorCodigo.has(codigo))
  if (desconhecidos.length > 0) {
    throw new ArquivoInvalidoError(
      `Serviço não cadastrado: ${desconhecidos.join(', ')}. Cadastre o serviço antes de importar a tabela.`,
    )
  }

  const serviceIds = [...idPorCodigo.values()]

  return prisma.$transaction(async (tx) => {
    const { count: removidas } = await tx.priceRule.deleteMany({
      where: { serviceId: { in: serviceIds } },
    })

    await tx.priceRule.createMany({
      data: linhas.map((linha) => ({
        serviceId: idPorCodigo.get(linha.servico)!,
        cepOrigemIni: linha.cepOrigemIni,
        cepOrigemFim: linha.cepOrigemFim,
        cepDestinoIni: linha.cepDestinoIni,
        cepDestinoFim: linha.cepDestinoFim,
        pesoMinG: linha.pesoMinG,
        pesoMaxG: linha.pesoMaxG,
        precoBalcaoCentavos: linha.precoBalcaoCentavos,
        // O CSV não traz custo: o frete é próprio, e o que a operação
        // controla é o preço de venda. Guardar o mesmo valor mantém a
        // coluna consistente sem inventar uma margem que ninguém informou.
        precoCustoCentavos: linha.precoVendaCentavos,
        precoVendaCentavos: linha.precoVendaCentavos,
        prazoDias: linha.prazoDias,
        ativo: true,
      })),
    })

    await tx.auditLog.create({
      data: {
        actorUserId,
        acao: 'IMPORTAR_TABELA',
        entidade: 'PriceRule',
        entidadeId: serviceIds.join(','),
        antes: { regrasRemovidas: removidas },
        depois: { regrasImportadas: linhas.length, servicos: codigosServico },
      },
    })

    return { importadas: linhas.length, servicos: codigosServico }
  })
}

import { describe, expect, it } from 'vitest'
import type { Mensagem, Template } from './api'
import {
  agruparPorDia,
  digitosParaDiscagem,
  duracaoLegivel,
  escolherLoja,
  filtrarTemplates,
  horarioDaLista,
  iniciais,
  marcoDaConsulta,
  mensagensComTermo,
  mesclarConversas,
  mesclarMensagens,
  nomeDoContato,
  previaDaConversa,
  rotuloDoDia,
  segmentarTexto,
  substituirMensagem,
  tamanhoLegivel,
  telefoneFormatado,
  termoDaBarra,
  tipoDoArquivo,
  validarAnexo,
} from './formatadores'

/*
  Datas montadas no fuso local (construtor com ano/mês/dia) e convertidas para
  ISO: as funções leem o dia no fuso de quem está na tela, e o teste precisa
  passar igual numa máquina em São Paulo e num CI em UTC.
*/
const local = (d: number, h = 10, min = 0, mes = 8) => new Date(2026, mes, d, h, min).toISOString()
const AGORA = new Date(2026, 8, 13, 15, 0) // domingo, 13/09/2026

function msg(id: string, ocorridoEm: string, extra: Partial<Mensagem> = {}): Mensagem {
  return {
    id,
    autor: 'CLIENTE',
    tipo: 'TEXTO',
    texto: `texto ${id}`,
    midia: null,
    status: 'ENTREGUE',
    erro: null,
    ocorridoEm,
    ...extra,
  }
}

describe('horários', () => {
  it('lista: hoje em HH:mm, ontem por extenso, antes em dd/mm', () => {
    expect(horarioDaLista(local(13, 9, 5), AGORA)).toBe('09:05')
    expect(horarioDaLista(local(12, 23, 50), AGORA)).toBe('Ontem')
    expect(horarioDaLista(local(2, 8, 0), AGORA)).toBe('02/09')
  })

  it('ontem conta por meia-noite, não por 24 horas', () => {
    const logoDepoisDaMeiaNoite = new Date(2026, 8, 13, 0, 10)
    expect(horarioDaLista(local(12, 23, 50), logoDepoisDaMeiaNoite)).toBe('Ontem')
  })

  it('separador: Hoje, Ontem, dia da semana na última semana, data depois', () => {
    expect(rotuloDoDia(local(13), AGORA)).toBe('Hoje')
    expect(rotuloDoDia(local(12), AGORA)).toBe('Ontem')
    expect(rotuloDoDia(local(8), AGORA)).toBe('Terça-feira')
    expect(rotuloDoDia(local(1), AGORA)).toBe('01/09/2026')
  })

  it('duração em m:ss e h:mm:ss', () => {
    expect(duracaoLegivel(7)).toBe('0:07')
    expect(duracaoLegivel(65.9)).toBe('1:05')
    expect(duracaoLegivel(3723)).toBe('1:02:03')
    expect(duracaoLegivel(null)).toBe('0:00')
    expect(duracaoLegivel(Infinity)).toBe('0:00')
  })
})

describe('telefone e nome', () => {
  it('formata celular e fixo brasileiros', () => {
    expect(telefoneFormatado('5511987654321')).toBe('(11) 98765-4321')
    expect(telefoneFormatado('551133334444')).toBe('(11) 3333-4444')
  })

  it('número estrangeiro sai com + e os dígitos, sem adivinhar 55', () => {
    expect(telefoneFormatado('14155552671')).toBe('+14155552671')
  })

  it('discagem fica só com os dígitos', () => {
    expect(digitosParaDiscagem('+55 (11) 98765-4321')).toBe('5511987654321')
  })

  it('nome, depois telefone, depois "Contato" para quem só tem @lid', () => {
    expect(nomeDoContato({ nome: ' Ana ', telefone: '5511987654321' })).toBe('Ana')
    expect(nomeDoContato({ nome: null, telefone: '5511987654321' })).toBe('(11) 98765-4321')
    expect(nomeDoContato({ nome: '  ', telefone: null })).toBe('Contato')
  })

  it('iniciais da primeira e da última palavra', () => {
    expect(iniciais('maria da silva')).toBe('MS')
    expect(iniciais('Ana')).toBe('A')
    expect(iniciais('+55 11')).toBe('')
    expect(iniciais(null)).toBe('')
  })
})

describe('arquivos', () => {
  it('tamanho legível', () => {
    expect(tamanhoLegivel(532)).toBe('532 B')
    expect(tamanhoLegivel(12_800)).toBe('13 KB')
    expect(tamanhoLegivel(1_468_006)).toBe('1,4 MB')
    expect(tamanhoLegivel(null)).toBe('')
  })

  it('recusa acima de 16 MB e arquivo vazio', () => {
    expect(validarAnexo({ size: 16 * 1024 * 1024 })).toBeNull()
    expect(validarAnexo({ size: 16 * 1024 * 1024 + 1 })).toContain('16 MB')
    expect(validarAnexo({ size: 0 })).toContain('vazio')
  })

  it('tipo pelo mimetype', () => {
    expect(tipoDoArquivo('image/png')).toBe('IMAGEM')
    expect(tipoDoArquivo('video/mp4')).toBe('VIDEO')
    expect(tipoDoArquivo('audio/ogg')).toBe('AUDIO')
    expect(tipoDoArquivo('application/pdf')).toBe('DOCUMENTO')
  })

  it('prévia com ícone do tipo', () => {
    expect(previaDaConversa({ previa: null, previaTipo: 'AUDIO' })).toBe('🎤 Áudio')
    expect(previaDaConversa({ previa: 'olha', previaTipo: 'IMAGEM' })).toBe('📷 olha')
    expect(previaDaConversa({ previa: 'oi', previaTipo: 'TEXTO' })).toBe('oi')
  })
})

describe('agrupamento e merge de mensagens', () => {
  it('agrupa por dia de calendário mantendo a ordem', () => {
    const grupos = agruparPorDia(
      [msg('a', local(12, 23, 59)), msg('b', local(13, 0, 1)), msg('c', local(13, 14))],
      AGORA,
    )
    expect(grupos.map((g) => [g.rotulo, g.mensagens.map((m) => m.id)])).toEqual([
      ['Ontem', ['a']],
      ['Hoje', ['b', 'c']],
    ])
  })

  it('mescla sem duplicar, fica com a versão mais nova e ordena por horário', () => {
    const atuais = [msg('a', local(13, 10)), msg('b', local(13, 11), { status: 'ENTREGUE' })]
    const novas = [msg('b', local(13, 11), { status: 'LIDA' }), msg('c', local(13, 12)), msg('z', local(13, 9))]
    const resultado = mesclarMensagens(atuais, novas)
    expect(resultado.map((m) => m.id)).toEqual(['z', 'a', 'b', 'c'])
    expect(resultado.find((m) => m.id === 'b')?.status).toBe('LIDA')
  })

  it('mesmo horário mantém a ordem de chegada', () => {
    const t = local(13, 10)
    expect(mesclarMensagens([msg('x', t)], [msg('y', t)]).map((m) => m.id)).toEqual(['x', 'y'])
  })

  it('troca a otimista pela do servidor mesmo se a consulta periódica já a trouxe', () => {
    const doServidor = msg('srv', local(13, 10, 1), { autor: 'ATENDENTE', status: 'ENVIADA' })
    const tela = [msg('a', local(13, 9)), msg('local-1', local(13, 10, 2), { status: 'ENVIANDO' }), doServidor]
    expect(substituirMensagem(tela, 'local-1', doServidor).map((m) => m.id)).toEqual(['a', 'srv'])
  })

  it('marco da consulta ignora otimistas e relê uma janela do fim', () => {
    const lista = Array.from({ length: 30 }, (_, i) => msg(`m${i}`, local(13, 10, i)))
    expect(marcoDaConsulta(lista, 20)).toBe(lista[10]?.ocorridoEm)
    expect(marcoDaConsulta([msg('m0', local(13, 8)), msg('local-x', local(13, 9))], 20)).toBe(local(13, 8))
    expect(marcoDaConsulta([])).toBeUndefined()
  })

  it('mescla conversas pela mais recente primeiro', () => {
    const c = (id: string, ultimaMensagemEm: string) => ({
      id,
      jid: `${id}@s.whatsapp.net`,
      telefone: null,
      nome: id,
      fotoUrl: null,
      ultimaMensagemEm,
      previa: null,
      previaTipo: 'TEXTO' as const,
      naoLidas: 0,
      roboPausado: false,
    })
    const resultado = mesclarConversas([c('a', local(13, 9)), c('b', local(12))], [c('b', local(13, 11))])
    expect(resultado.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('loja inicial', () => {
  const lojas = [
    { perfilId: 'a', conectado: false },
    { perfilId: 'b', conectado: true },
  ]
  it('pedida no endereço, depois a primeira conectada, depois a primeira', () => {
    expect(escolherLoja(lojas, 'a')).toBe('a')
    expect(escolherLoja(lojas, 'inexistente')).toBe('b')
    expect(escolherLoja([{ perfilId: 'x', conectado: false }], null)).toBe('x')
    expect(escolherLoja([], null)).toBeNull()
  })
})

describe('busca', () => {
  it('encontra termo sem diferenciar acento e maiúscula, também no nome do arquivo', () => {
    const lista = [
      msg('a', local(13), { texto: 'Código de RASTREIO enviado' }),
      msg('b', local(13), { texto: null, tipo: 'DOCUMENTO', midia: { url: '/x', mimetype: 'application/pdf', nome: 'rastreio.pdf', tamanho: 1, duracao: null } }),
      msg('c', local(13), { texto: 'bom dia' }),
    ]
    expect(mensagensComTermo(lista, 'rastreío')).toEqual(['a', 'b'])
    expect(mensagensComTermo(lista, '  ')).toEqual([])
  })

  it('segmenta links e destaca o termo', () => {
    expect(segmentarTexto('veja https://martinslog.net/r/1. ok')).toEqual([
      { tipo: 'texto', valor: 'veja ', destaque: false },
      { tipo: 'link', valor: 'https://martinslog.net/r/1', destaque: false },
      { tipo: 'texto', valor: '. ok', destaque: false },
    ])
    expect(segmentarTexto('Olá olá', 'OLA')).toEqual([
      { tipo: 'texto', valor: 'Olá', destaque: true },
      { tipo: 'texto', valor: ' ', destaque: false },
      { tipo: 'texto', valor: 'olá', destaque: true },
    ])
  })
})

describe('filtro "/" de templates', () => {
  const t = (id: string, titulo: string, atalho: string | null, ordem: number): Template => ({
    id,
    titulo,
    atalho,
    texto: '',
    ordem,
  })
  const templates = [
    t('1', 'Saudação', 'oi', 2),
    t('2', 'Código de rastreio', 'rastreio', 1),
    t('3', 'Prazo de entrega', null, 0),
    t('4', 'Reenvio do rastreio', 'reenvio', 3),
  ]

  it('só abre com "/" no início e sem espaço', () => {
    expect(termoDaBarra('/')).toBe('')
    expect(termoDaBarra('/ras')).toBe('ras')
    expect(termoDaBarra('/rastreio chegou')).toBeNull()
    expect(termoDaBarra('oi /ras')).toBeNull()
  })

  it('sem termo lista tudo na ordem cadastrada', () => {
    expect(filtrarTemplates(templates, '').map((x) => x.id)).toEqual(['3', '2', '1', '4'])
  })

  it('atalho por prefixo vem antes de título por trecho', () => {
    // "reenvio" casa pelo atalho; "Prazo de entrega" e "Código de rastreio" pelo título.
    expect(filtrarTemplates(templates, 're').map((x) => x.id)).toEqual(['4', '3', '2'])
    expect(filtrarTemplates(templates, 'rastreio').map((x) => x.id)).toEqual(['2', '4'])
    expect(filtrarTemplates(templates, 'SAUDACAO').map((x) => x.id)).toEqual(['1'])
  })
})

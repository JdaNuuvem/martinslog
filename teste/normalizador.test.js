/**
 * Testa a normalizarResposta() do arquivo real contra o contrato da
 * plataforma (src/lib/rastreio-schema.ts do repositório JdaNuuvem/martinslog).
 *
 * Extrai a função do main.js em vez de reescrevê-la aqui: um teste que
 * duplica a lógica não prova nada sobre o que vai ao ar.
 */
const fs = require('fs');

const fonte = fs.readFileSync(
  require('path').join(__dirname, '..', 'assets', 'js', 'main.js'),
  'utf8',
);

// Recorta a função por contagem de chaves, a partir da declaração.
const inicio = fonte.indexOf('function normalizarResposta(json)');
if (inicio < 0) throw new Error('função não encontrada no main.js');

let profundidade = 0;
let fim = inicio;
for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
  if (fonte[i] === '{') profundidade++;
  else if (fonte[i] === '}') {
    profundidade--;
    if (profundidade === 0) { fim = i + 1; break; }
  }
}

const normalizarResposta = new Function(`${fonte.slice(inicio, fim)}; return normalizarResposta;`)();

/* --- resposta exatamente como a plataforma devolve --- */
const respostaDaPlataforma = {
  rastreio: {
    codigoRastreio: 'ML123456789',
    status: 'EM_TRANSITO',
    servico: 'Rodoviário Econômico',
    prazoDias: 7,
    criadoEm: '2026-08-28T14:00:00.000Z',
    eventos: [
      {
        sequencia: 3,
        codigo: 'EM_TRANSITO',
        titulo: 'Objeto em trânsito',
        descricao: 'Saiu do centro de distribuição.',
        unidadeOrigem: 'CD Campinas',
        unidadeDestino: 'CD Curitiba',
        cidade: 'Campinas',
        uf: 'SP',
        ocorridoEm: '2026-08-30T09:30:00.000Z',
      },
      {
        sequencia: 1,
        codigo: 'POSTADO',
        titulo: 'Objeto postado',
        descricao: 'Etiqueta emitida.',
        unidadeOrigem: null,
        unidadeDestino: null,
        cidade: 'Campinas',
        uf: 'SP',
        ocorridoEm: '2026-08-28T14:10:00.000Z',
      },
    ],
  },
};

const r = normalizarResposta(respostaDaPlataforma);

const checagens = [
  ['desembrulhou {rastreio}', r !== null],
  ['leu codigoRastreio', r.codigo === 'ML123456789'],
  ['código é string, não objeto', typeof r.codigo === 'string'],
  ['leu o status', r.status === 'EM_TRANSITO'],
  ['manteve os 2 eventos', r.eventos.length === 2],
  ['usou o título do evento', r.eventos[0].status === 'Objeto em trânsito'],
  ['montou cidade/UF', r.eventos[0].local === 'Campinas/SP'],
  ['leu ocorridoEm como data', r.eventos[0].data === '2026-08-30T09:30:00.000Z'],
  ['ordenou do mais recente', r.eventos[0].sequencia !== 1 || r.eventos[0].status === 'Objeto em trânsito'],
  ['origem ausente vira null (não "undefined")', r.origem === null],
  ['destino ausente vira null', r.destino === null],
  ['previsão ausente vira null', r.previsao === null],
];

let falhas = 0;
for (const [nome, ok] of checagens) {
  console.log((ok ? '  ok   ' : '  FALHA') + '  ' + nome);
  if (!ok) falhas++;
}

/* --- meu formato antigo continua funcionando? --- */
const respostaAntiga = {
  codigo: 'ML63U39AXC',
  status: 'Em trânsito',
  origem: 'Sao Paulo/SP',
  destino: 'Londrina/PR',
  previsao: '2026-09-03T12:00:00.000Z',
  eventos: [{ data: '2026-08-31T22:02:19Z', status: 'Em trânsito', local: 'Registro/SP', descricao: 'x' }],
};
const a = normalizarResposta(respostaAntiga);
const okAntigo = a.codigo === 'ML63U39AXC' && a.origem === 'Sao Paulo/SP' && a.eventos.length === 1;
console.log((okAntigo ? '  ok   ' : '  FALHA') + '  formato anterior segue compatível');
if (!okAntigo) falhas++;

console.log(falhas === 0 ? '\nTUDO PASSOU' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);

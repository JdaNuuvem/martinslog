/**
 * Testa a Central de Ajuda: a base de respostas e a busca que escolhe qual
 * delas entregar.
 *
 * A busca é a parte que erra em silêncio. Ela nunca lança exceção: quando o
 * gatilho está escrito com acento, ou quando duas perguntas disputam a mesma
 * palavra, o resultado é uma resposta plausível e errada — prazo de entrega
 * para quem perguntou de reembolso. Só um teste que faz a pergunta em
 * português de gente pega isso.
 *
 * Como no `normalizador.test.js`, as funções são recortadas do `main.js`
 * publicado em vez de reescritas aqui.
 *
 * Rode com:  node teste/ajuda.test.js
 */
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'main.js'), 'utf8');

/**
 * Recorta de `var BASE_AJUDA` até o fim de `function responder`.
 *
 * O trecho é contíguo no arquivo e traz junto os auxiliares — recortar cada
 * função isolada exigiria repetir aqui a ordem em que elas se chamam, que é
 * exatamente o que o teste não deve saber.
 */
function extrairModulo() {
  const inicio = fonte.indexOf('var BASE_AJUDA');
  if (inicio < 0) throw new Error('BASE_AJUDA não encontrada no main.js');

  const decl = fonte.indexOf('function responder(', inicio);
  if (decl < 0) throw new Error('função responder não encontrada no main.js');

  let profundidade = 0;
  for (let i = fonte.indexOf('{', decl); i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}') {
      profundidade--;
      if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }
  throw new Error('chaves desbalanceadas ao extrair o módulo de ajuda');
}

const mod = new Function(
  extrairModulo() +
    '; return { BASE_AJUDA: BASE_AJUDA, normalizarPergunta: normalizarPergunta,' +
    ' contemTermo: contemTermo, pontuar: pontuar, pareceCodigo: pareceCodigo,' +
    ' responder: responder };',
)();

const { BASE_AJUDA, normalizarPergunta, contemTermo, pareceCodigo, responder } = mod;

let falhas = 0;
const conferir = (nome, ok) => {
  console.log((ok ? '  ok   ' : '  FALHA') + '  ' + nome);
  if (!ok) falhas++;
};

/* ============================================================
   1. Sanidade da base
   ============================================================ */
console.log('\n— base de respostas —');

conferir('tem pelo menos 12 perguntas cobertas', BASE_AJUDA.length >= 12);

conferir(
  'todo item tem id, chip, titulo, termos e resposta',
  BASE_AJUDA.every(
    (i) =>
      i.id &&
      i.chip &&
      i.titulo &&
      Array.isArray(i.termos) &&
      i.termos.length > 0 &&
      Array.isArray(i.resposta) &&
      i.resposta.length > 0,
  ),
);

conferir('nenhum id repetido', new Set(BASE_AJUDA.map((i) => i.id)).size === BASE_AJUDA.length);

/*
 * O gatilho passa por `normalizarPergunta` do lado da pergunta, mas não do
 * lado da base: um termo escrito "código" ou "Prazo" nunca casa com nada, e
 * a falha é silenciosa — a pergunta certa simplesmente cai no atendimento
 * humano. Este é o erro mais fácil de cometer ao editar a base.
 */
const termosSujos = [];
BASE_AJUDA.forEach((item) => {
  item.termos.forEach((t) => {
    if (t !== normalizarPergunta(t)) termosSujos.push(item.id + ': "' + t + '"');
  });
});
conferir(
  'gatilhos já estão normalizados (sem acento, minúsculos)' +
    (termosSujos.length ? ' → ' + termosSujos.join(', ') : ''),
  termosSujos.length === 0,
);

// Só ênfase é permitida no corpo: o texto vai para `innerHTML`, e qualquer
// outra tag aqui vira porta aberta na hora em que alguém colar conteúdo de
// fora nesta lista.
const tagsIrregulares = [];
BASE_AJUDA.forEach((item) => {
  item.resposta.forEach((p) => {
    const tags = p.match(/<\/?([a-z]+)/g) || [];
    tags.forEach((t) => {
      const nome = t.replace(/<\/?/, '');
      if (nome !== 'strong') tagsIrregulares.push(item.id + ': ' + nome);
    });
  });
});
conferir(
  'respostas usam apenas <strong>' +
    (tagsIrregulares.length ? ' → ' + tagsIrregulares.join(', ') : ''),
  tagsIrregulares.length === 0,
);

conferir(
  'toda âncora de ação existe no index.html',
  BASE_AJUDA.filter((i) => i.acao)
    .map((i) => i.acao.href)
    .every((href) =>
      fs
        .readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
        .includes('id="' + href.replace('#', '') + '"'),
    ),
);

/* ============================================================
   2. Normalização
   ============================================================ */
console.log('\n— normalização —');

conferir('tira acento', normalizarPergunta('Endereço Inválido') === 'endereco invalido');
conferir('tira pontuação', normalizarPergunta('Quanto tempo?!') === 'quanto tempo');
conferir('colapsa espaços', normalizarPergunta('  meu   pedido  ') === 'meu pedido');
conferir('aguenta vazio e nulo', normalizarPergunta('') === '' && normalizarPergunta(null) === '');

/* A fronteira de palavra é o que impede "taxa" de casar dentro de "sintaxe"
   e entregar o aviso de golpe para quem perguntou outra coisa. */
conferir('não casa termo no meio da palavra', contemTermo('erro de sintaxe', 'taxa') === false);
conferir('casa termo no fim da frase', contemTermo('quero pagar', 'pagar') === true);
conferir('casa termo no começo', contemTermo('prazo de entrega', 'prazo') === true);

/* ============================================================
   3. As perguntas como as pessoas escrevem
   ============================================================ */
console.log('\n— perguntas reais —');

const casos = [
  // As duas que motivaram a Central.
  ['Quanto tempo leva para o meu pedido chegar?', 'prazo'],
  ['Como faço para ver o rastreio do meu pedido', 'rastrear'],

  ['quanto tempo demora', 'prazo'],
  ['quantos dias uteis pra chegar?', 'prazo'],
  ['QUANDO CHEGA O MEU PEDIDO', 'prazo'],
  ['como rastrear minha encomenda', 'rastrear'],
  ['onde esta o meu pacote', 'rastrear'],
  ['não recebi o código de rastreio', 'sem-codigo'],
  ['o codigo nao aparece nada', 'codigo-sem-info'],
  ['meu rastreio esta parado ha dias', 'parado'],
  ['ja passou do prazo e nao chegou', 'atrasado'],
  ['tentaram entregar e eu nao estava em casa', 'tentativa'],
  ['esta aguardando retirada, o que faço?', 'retirada'],
  ['meu vizinho pode receber?', 'quem-recebe'],
  ['coloquei o endereço errado', 'endereco'],
  ['recebi um sms pedindo pra pagar uma taxa', 'taxa'],
  ['isso é golpe?', 'taxa'],
  ['o produto chegou quebrado', 'avaria'],
  ['quero cancelar a compra', 'cancelar'],
  ['quero meu reembolso', 'cancelar'],
  ['vocês entregam na minha cidade?', 'cobertura'],
  ['quanto custa o frete', 'frete'],
  ['quero falar com um atendente', 'atendente'],
];

casos.forEach(([pergunta, esperado]) => {
  const r = responder(pergunta);
  const obtido = r.tipo === 'resposta' ? r.item.id : r.tipo;
  conferir('"' + pergunta + '" → ' + esperado + (obtido === esperado ? '' : ' (veio: ' + obtido + ')'), obtido === esperado);
});

/* ============================================================
   4. Quando não sabe, não inventa
   ============================================================ */
console.log('\n— limites —');

conferir(
  'pergunta fora do assunto cai no atendimento humano',
  responder('qual a capital da australia').tipo === 'vazio',
);
conferir('texto vazio devolve vazio', responder('').tipo === 'vazio');
conferir('só espaço devolve vazio', responder('    ').tipo === 'vazio');

conferir(
  'código de rastreio é reconhecido',
  responder('EC000000014BR').tipo === 'codigo' &&
    responder('meu codigo é EC000000014BR').tipo === 'codigo',
);
// Oito dígitos sem letras em volta é CEP, telefone, número de pedido — não
// pode desviar a pessoa para a consulta de rastreio.
conferir('CEP não é confundido com código', pareceCodigo('12321313') === false);
conferir('prazo em números não vira código', pareceCodigo('10 dias uteis') === false);

/* ============================================================
   5. O que a página precisa ter
   ============================================================ */
console.log('\n— integração com a página —');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

['ajuda-conversa', 'form-ajuda', 'ajuda-pergunta', 'ajuda-atalhos'].forEach((id) => {
  conferir('index.html tem #' + id, html.includes('id="' + id + '"'));
});

conferir('a seção #ajuda existe', html.includes('id="ajuda"'));
conferir('o menu leva até ela', html.includes('href="#ajuda"'));

// O bloco de contato só nasce a partir daqui; sem a chave, o atendimento
// humano fica sem nenhum canal na tela.
conferir('index.html declara ajudaContato', /ajudaContato:\s*{/.test(html));

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : '\n' + falhas + ' FALHA(S)\n');
process.exit(falhas === 0 ? 0 : 1);

/**
 * Testa a documentação pública da API servida em /docs.
 *
 * A falha que este arquivo existe para pegar é silenciosa: a página é estática
 * e o build passa verde mesmo quando ela não entra na imagem. O `COPY docs`
 * do Dockerfile é a única coisa que a coloca lá, e esquecê-lo não gera erro
 * nenhum — só um 404 que ninguém vê até um lojista tentar integrar.
 *
 * O segundo alvo são as âncoras. O índice lateral é a navegação inteira da
 * página; um link para uma seção que mudou de id não quebra nada visível,
 * apenas não rola para lugar nenhum.
 *
 * Rode com:  node teste/docs.test.js
 */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const caminhoDocs = path.join(raiz, 'docs', 'index.html');

let falhas = 0;
const conferir = (nome, ok) => {
  console.log((ok ? '  ok   ' : '  FALHA') + '  ' + nome);
  if (!ok) falhas++;
};

/* ============================================================
   1. A página chega na imagem
   ============================================================ */
console.log('\n— publicação —');

conferir('docs/index.html existe', fs.existsSync(caminhoDocs));
if (!fs.existsSync(caminhoDocs)) {
  console.log('\n1 FALHA(S)\n');
  process.exit(1);
}

const html = fs.readFileSync(caminhoDocs, 'utf8');
const dockerfile = fs.readFileSync(path.join(raiz, 'Dockerfile'), 'utf8');

// Sem esta linha a pasta não entra na imagem e /docs responde 404 — com o
// build inteiro verde.
conferir(
  'Dockerfile copia a pasta docs',
  /^COPY\s+docs\s+\/usr\/share\/nginx\/html\/docs\s*$/m.test(dockerfile),
);

// `try_files $uri $uri/` é o que faz /docs/ achar o index.html de dentro.
conferir(
  'nginx resolve diretório para index',
  /try_files\s+\$uri\s+\$uri\/\s/.test(fs.readFileSync(path.join(raiz, 'nginx.conf'), 'utf8')),
);

conferir('a landing aponta para /docs/', fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').includes('href="/docs/"'));

/* ============================================================
   2. Documento completo
   ============================================================ */
console.log('\n— documento —');

conferir('tem doctype', /^<!doctype html>/i.test(html.trim()));
conferir('declara o idioma', /<html lang="pt-BR">/.test(html));
conferir('tem charset', /<meta charset="utf-8">/i.test(html));
conferir('tem viewport', /name="viewport"/.test(html));
conferir('tem title', /<title>[^<]{10,}<\/title>/.test(html));
conferir('tem description', /name="description" content="[^"]{50,}"/.test(html));
conferir('tem canônica', /rel="canonical" href="https:\/\/martinslog\.net\/docs\/"/.test(html));
conferir('fecha o html', /<\/html>\s*$/.test(html));

// O JSON-LD é lido por buscador: quebrado, some da página sem avisar.
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
conferir('tem JSON-LD', Boolean(ld));
if (ld) {
  let valido = true;
  try {
    JSON.parse(ld[1]);
  } catch {
    valido = false;
  }
  conferir('JSON-LD é JSON válido', valido);
}

/* Elementos de bloco balanceados. Não é um parser, mas um <pre> ou um <table>
   sem fechar despenca o resto da página — e é o erro mais provável num
   documento montado por composição. */
console.log('\n— estrutura —');
['section', 'table', 'pre', 'nav', 'main', 'div'].forEach((tag) => {
  const abre = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length;
  const fecha = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  conferir(`<${tag}> balanceado (${abre}/${fecha})`, abre === fecha);
});

/* ============================================================
   3. Navegação interna
   ============================================================ */
console.log('\n— âncoras —');

const ids = new Set((html.match(/\sid="([^"]+)"/g) || []).map((m) => m.slice(5, -1)));
const ancoras = [...new Set((html.match(/href="#([^"]+)"/g) || []).map((m) => m.slice(7, -1)))];

conferir('o índice tem âncoras', ancoras.length >= 10);

const quebradas = ancoras.filter((a) => !ids.has(a));
conferir(
  'toda âncora aponta para uma seção existente' +
    (quebradas.length ? ' → ' + quebradas.join(', ') : ''),
  quebradas.length === 0,
);

/* ============================================================
   4. O conteúdo é da nossa API, e está certo
   ============================================================ */
console.log('\n— contrato documentado —');

const precisaConter = [
  ['a URL base real', 'app.martinslog.net'],
  ['o esquema de autenticação', 'Authorization: Bearer'],
  ['o prefixo de produção', 'frete_live_'],
  ['o prefixo de sandbox', 'frete_test_'],
  ['o cabeçalho de assinatura', 'x-frete-signature'],
  ['o cabeçalho de timestamp', 'x-frete-timestamp'],
  ['a rota de cotação', '/api/v0/calculator'],
  ['a rota de carrinho', '/api/v0/cart'],
  ['a rota de pagamento', '/api/v0/checkout'],
  ['a rota de consulta', '/api/v0/order/info'],
  ['a rota pública de rastreio', '/api/rastreio/'],
];
precisaConter.forEach(([nome, trecho]) => {
  conferir('documenta ' + nome, html.includes(trecho));
});

// Os seis eventos precisam estar todos: documentar cinco faz o integrador
// deixar um caso sem tratamento e descobrir em produção.
const eventos = [
  'order.created',
  'order.released',
  'order.generated',
  'order.posted',
  'order.delivered',
  'order.cancelled',
];
const faltando = eventos.filter((e) => !html.includes(e));
conferir(
  'documenta os 6 eventos de webhook' + (faltando.length ? ' → falta ' + faltando.join(', ') : ''),
  faltando.length === 0,
);

// Os sete estados do envio, idem.
const estados = ['PENDING', 'RELEASED', 'GENERATED', 'POSTED', 'DELIVERED', 'CANCELLED', 'LOST'];
const semEstado = estados.filter((e) => !html.includes(e));
conferir(
  'documenta os 7 status do envio' + (semEstado.length ? ' → falta ' + semEstado.join(', ') : ''),
  semEstado.length === 0,
);

// Valores que, se mudarem no backend, tornam a documentação mentirosa.
conferir('documenta o limite de 60/min', /60 requisições por minuto/.test(html));
conferir('documenta a janela de 5 minutos da assinatura', html.includes('300'));
conferir('documenta a taxa fixa de etiqueta', html.includes('R$ 1,00'));

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : '\n' + falhas + ' FALHA(S)\n');
process.exit(falhas === 0 ? 0 : 1);

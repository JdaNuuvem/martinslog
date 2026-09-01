/**
 * Testa a leitura da resposta de rastreio contra o contrato real da
 * plataforma (repositório JdaNuuvem/martinslog), e a sanidade dos scripts
 * embutidos na página.
 *
 * As funções são extraídas do `main.js` publicado em vez de reescritas aqui:
 * um teste que duplica a lógica não prova nada sobre o que vai ao ar.
 *
 * Rode com:  node teste/normalizador.test.js
 */
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'main.js'), 'utf8');

/** Recorta uma função pelo nome, contando chaves a partir da declaração. */
function extrairFuncao(nome) {
  const inicio = fonte.indexOf('function ' + nome + '(');
  if (inicio < 0) throw new Error('função não encontrada no main.js: ' + nome);

  let profundidade = 0;
  for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}') {
      profundidade--;
      if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }
  throw new Error('chaves desbalanceadas ao extrair ' + nome);
}

/** A tabela de estados vive fora da função, então sai junto com ela. */
function extrairBlocoStatus() {
  const inicio = fonte.indexOf('var MAPA_STATUS');
  if (inicio < 0) throw new Error('MAPA_STATUS não encontrado');
  const corpo = extrairFuncao('classificarStatus');
  return fonte.slice(inicio, fonte.indexOf('function classificarStatus')) + corpo;
}

const normalizarResposta = new Function(extrairFuncao('normalizarResposta') + '; return normalizarResposta;')();
const classificarStatus = new Function(extrairBlocoStatus() + '; return classificarStatus;')();

let falhas = 0;
const conferir = (nome, ok) => {
  console.log((ok ? '  ok   ' : '  FALHA') + '  ' + nome);
  if (!ok) falhas++;
};

/* ============================================================
   1. Formato da plataforma de fretes
   ============================================================ */
console.log('\n— resposta da plataforma —');

const r = normalizarResposta({
  rastreio: {
    codigoRastreio: 'EC000000014BR',
    status: 'GENERATED',
    servico: 'Econômico',
    prazoDias: 5,
    criadoEm: '2026-09-01T01:49:35.000Z',
    eventos: [
      {
        sequencia: 2,
        codigo: 'TRANSFERENCIA',
        titulo: 'Em trânsito',
        descricao: 'Saiu do centro de distribuição.',
        cidade: 'Sao Paulo',
        uf: 'SP',
        ocorridoEm: '2026-09-02T09:30:00.000Z',
      },
      {
        sequencia: 1,
        codigo: 'ETIQUETA_EMITIDA',
        titulo: 'Etiqueta emitida',
        descricao: 'Aguardando postagem pelo remetente.',
        cidade: 'Sao Paulo',
        uf: 'SP',
        ocorridoEm: '2026-09-01T01:49:35.832Z',
      },
    ],
  },
});

conferir('desembrulhou { rastreio }', r !== null);
conferir('leu codigoRastreio', r.codigo === 'EC000000014BR');
conferir('código é texto, não objeto', typeof r.codigo === 'string');
conferir('manteve os 2 eventos', r.eventos.length === 2);
conferir('usou o título do evento', r.eventos[0].status === 'Em trânsito');
conferir('montou cidade/UF', r.eventos[0].local === 'Sao Paulo/SP');
conferir('leu ocorridoEm como data', r.eventos[0].data === '2026-09-02T09:30:00.000Z');
conferir('ordenou do mais recente para o mais antigo', r.eventos[1].status === 'Etiqueta emitida');
// A plataforma não devolve endereço por decisão de privacidade; a tela
// esconde o que não vem, mas só se vier `null` em vez de `undefined`.
conferir('origem ausente vira null', r.origem === null);
conferir('destino ausente vira null', r.destino === null);
conferir('previsão ausente vira null', r.previsao === null);

/* ============================================================
   2. Formato anterior segue compatível
   ============================================================ */
console.log('\n— compatibilidade com o formato anterior —');

const antigo = normalizarResposta({
  codigo: 'ML63U39AXC',
  status: 'Em trânsito',
  origem: 'Sao Paulo/SP',
  destino: 'Londrina/PR',
  previsao: '2026-09-03T12:00:00.000Z',
  eventos: [{ data: '2026-08-31T22:02:19Z', status: 'Em trânsito', local: 'Registro/SP', descricao: 'x' }],
});
conferir('lê o formato antigo', antigo.codigo === 'ML63U39AXC' && antigo.origem === 'Sao Paulo/SP');

/* ============================================================
   3. Tradução dos estados — nenhum token cru pode chegar ao cliente
   ============================================================ */
console.log('\n— tradução dos estados —');

const esperados = [
  ['GENERATED', 'Aguardando postagem', 0],
  ['RELEASED', 'Aguardando postagem', 0],
  ['POSTED', 'Postado', 0],
  ['TRANSFERENCIA', 'Em trânsito', 1],
  ['SAIU_PARA_ENTREGA', 'Saiu para entrega', 2],
  ['ENTREGUE', 'Entregue', 3],
  ['DELIVERED', 'Entregue', 3],
  ['TENTATIVA_FRUSTRADA', 'Tentativa de entrega frustrada', 2],
  ['LOST', 'Extraviado', 2],
];

for (const [token, rotulo, etapa] of esperados) {
  const c = classificarStatus(token);
  conferir(token + ' → "' + c.rotulo + '"', c.rotulo === rotulo && c.etapa === etapa);
}

const vazando = esperados.filter(([t]) => /^[A-Z_]+$/.test(classificarStatus(t).rotulo));
conferir('nenhum token de máquina chega à tela', vazando.length === 0);

/* ============================================================
   4. Sanidade dos scripts da página

   Um erro de sintaxe no bloco embutido não aparece em lugar nenhum: o
   navegador desiste daquele script em silêncio, e com ele vão o rastreio
   e o menu. Já aconteceu uma vez ao editar a configuração à mão.
   ============================================================ */
console.log('\n— scripts da página —');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocos = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];

const embutidos = blocos.filter(
  ([, attrs]) => !/\bsrc=/.test(attrs) && !/application\/ld\+json/.test(attrs),
);

conferir('achou ao menos um script embutido', embutidos.length > 0);

embutidos.forEach(([, , corpo], i) => {
  let erro = null;
  try {
    new Function(corpo);
  } catch (e) {
    erro = e.message;
  }
  conferir('script embutido #' + (i + 1) + ' compila' + (erro ? ' — ' + erro : ''), erro === null);
});

// O JSON-LD é dado, não código: precisa ser JSON válido, senão o Google o ignora.
const ld = blocos.find(([, attrs]) => /application\/ld\+json/.test(attrs));
let erroLd = ld ? null : 'bloco não encontrado';
if (ld) {
  try {
    JSON.parse(ld[2]);
  } catch (e) {
    erroLd = e.message;
  }
}
conferir('JSON-LD é JSON válido' + (erroLd ? ' — ' + erroLd : ''), erroLd === null);

// O arquivo externo também precisa compilar.
let erroMain = null;
try {
  new Function(fonte);
} catch (e) {
  erroMain = e.message;
}
conferir('main.js compila' + (erroMain ? ' — ' + erroMain : ''), erroMain === null);

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : '\n' + falhas + ' FALHA(S)\n');
process.exit(falhas === 0 ? 0 : 1);

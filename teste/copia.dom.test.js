/**
 * Carrega a página publicada num DOM real, aperta os dois botões e mostra o
 * que foi parar na área de transferência.
 *
 * Conferir o HTML por expressão regular prova que o botão existe, não que ele
 * copia algo aproveitável — e o texto copiado é justamente a única parte que
 * ninguém vê antes de colar.
 */
const fs = require('fs');
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.log('\n  PULADO — este teste precisa do jsdom.');
  console.log('  Instale com:  npm install jsdom');
  console.log('  Ele confere o texto que os botões copiam, que é a única parte');
  console.log('  da página que ninguém vê antes de colar em outro lugar.\n');
  process.exit(0);
}

const arquivo = require('path').join(__dirname, '..', 'docs', 'index.html');

let copiado = null;

const dom = new JSDOM(fs.readFileSync(arquivo, 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://martinslog.net/docs/',
  pretendToBeVisual: true,
  beforeParse(janela) {
    // A área de transferência não existe no jsdom; guardamos o que passaria
    // por ela para poder olhar.
    Object.defineProperty(janela.navigator, 'clipboard', {
      value: { writeText: (t) => { copiado = t; return Promise.resolve(); } },
      configurable: true,
    });
    // O jsdom reporta contexto inseguro; https://martinslog.net é seguro, e é
    // o caminho da API moderna que precisa ser exercitado aqui.
    Object.defineProperty(janela, 'isSecureContext', { value: true, configurable: true });
    janela.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  },
});

const { window } = dom;

window.addEventListener('load', () => {
  const problemas = [];
  const ok = (nome, cond) => {
    console.log((cond ? '  ok   ' : '  FALHA') + '  ' + nome);
    if (!cond) problemas.push(nome);
  };

  console.log('\n— botão "Copiar tudo" —');
  window.document.getElementById('btn-copiar').click();

  setTimeout(() => {
    const md = copiado;
    ok('copiou alguma coisa', typeof md === 'string' && md.length > 3000);

    if (typeof md === 'string') {
      console.log('  tamanho: ' + md.length + ' caracteres, ' + md.split('\n').length + ' linhas');

      ok('tem o título', md.startsWith('# API Martins Log'));
      ok('diz de onde veio', md.includes('https://martinslog.net/docs/'));
      ok('traz a URL base', md.includes('app.martinslog.net'));
      ok('traz as 16 seções', (md.match(/^## /gm) || []).length >= 15);
      ok('traz blocos de código cercados', (md.match(/^```$/gm) || []).length >= 20);
      ok('traz tabelas em markdown', md.includes('| --- |'));
      ok('traz a tabela de erros', md.includes('SALDO_INSUFICIENTE') && md.includes('402'));
      ok('traz os 6 eventos', ['created', 'released', 'generated', 'posted', 'delivered', 'cancelled'].every((e) => md.includes('order.' + e)));
      ok('traz o exemplo de assinatura', md.includes('timingSafeEqual'));
      ok('traz o endpoint como código', md.includes('`POST /api/v0/cart`'));
      ok('traz os avisos como citação', md.includes('> **'));
      ok('não sobrou marcação HTML', !/<\/?(div|span|section|table|pre|p)\b/i.test(md));
      ok('não sobrou a âncora "#" nos títulos', !/^## .*\s#\s*$/m.test(md));
      ok('sem linhas em branco triplicadas', !/\n{3,}/.test(md));

      console.log('\n  ---- primeiras 26 linhas ----');
      md.split('\n').slice(0, 26).forEach((l) => console.log('  | ' + l));
      console.log('  ---- trecho da tabela de erros ----');
      const i = md.indexOf('| HTTP |');
      md.slice(i, i + 420).split('\n').slice(0, 6).forEach((l) => console.log('  | ' + l));
    }

    console.log('\n— botão "Integrar com IA" —');
    copiado = null;
    window.document.getElementById('btn-ia').click();

    setTimeout(() => {
      const comPrompt = copiado;
      ok('copiou', typeof comPrompt === 'string' && comPrompt.length > 3000);
      ok(
        'começa com o pedido',
        typeof comPrompt === 'string' &&
          comPrompt.startsWith('quero integrar o meu sistema na Martins Log segue a documentacao deles aqui : '),
      );
      ok(
        'a documentação vem logo depois',
        typeof comPrompt === 'string' && comPrompt.includes('\n\n# API Martins Log'),
      );

      console.log('\n  ---- primeiras 4 linhas ----');
      String(comPrompt).split('\n').slice(0, 4).forEach((l) => console.log('  | ' + l));

      console.log('\n— botões por bloco de código —');
      const botoes = window.document.querySelectorAll('.copiar-cod');
      ok('todo bloco de código tem botão (' + botoes.length + ')', botoes.length >= 13);
      copiado = null;
      if (botoes.length) botoes[0].click();
      setTimeout(() => {
        ok('o botão do bloco copia o código', typeof copiado === 'string' && copiado.includes('curl'));

        console.log('\n— âncoras e índice —');
        ok('títulos ganharam âncora', window.document.querySelectorAll('.ancora').length >= 15);

        console.log(problemas.length === 0 ? '\nTUDO PASSOU\n' : '\n' + problemas.length + ' FALHA(S)\n');
        process.exit(problemas.length === 0 ? 0 : 1);
      }, 30);
    }, 30);
  }, 30);
});

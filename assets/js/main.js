/* =========================================================================
   MARTINS LOG — comportamento da página
   Módulos: config → utilitários → cabeçalho → revelações → contadores →
            cobertura → rastreio → ajuda
   JavaScript puro, sem dependências.
   ========================================================================= */

(function () {
  'use strict';

  /* ===== CONFIG ===== */
  var cfg = window.MARTINS_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var MODO_DEMO = params.get('demo') === '1' || !cfg.rastreioEndpoint;
  var TIMEOUT_MS = 12000;

  var semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===== UTILITÁRIOS ===== */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function criar(tag, classe, texto) {
    var el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  /* Datas do backend chegam em formatos variados; o que não der para
     interpretar é escondido em vez de virar "Invalid Date" na tela. */
  function formatarDataHora(valor) {
    if (!valor) return null;
    var d = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  }

  function formatarData(valor) {
    if (!valor) return null;
    var d = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d);
  }

  /* ===== CABEÇALHO: sombra, menu mobile e link ativo ===== */
  (function cabecalho() {
    var header = $('#cabecalho');
    var menu = $('#menu');
    var botao = $('.hamburguer');
    var fechar = $('.menu__fechar');
    var fundo = $('.menu__fundo');
    var links = $$('.menu__lista a');

    window.addEventListener('scroll', function () {
      header.classList.toggle('cabecalho--rolado', window.scrollY > 40);
    }, { passive: true });

    function abrir() {
      menu.classList.add('menu--aberto');
      fundo.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      document.body.classList.add('travado');
      fechar.focus();
    }

    function fecharMenu() {
      menu.classList.remove('menu--aberto');
      fundo.hidden = true;
      botao.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('travado');
    }

    botao.addEventListener('click', function () {
      if (menu.classList.contains('menu--aberto')) fecharMenu(); else abrir();
    });
    fechar.addEventListener('click', fecharMenu);
    fundo.addEventListener('click', fecharMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('menu--aberto')) {
        fecharMenu();
        botao.focus();
      }
    });
    links.forEach(function (a) { a.addEventListener('click', fecharMenu); });

    // Link ativo conforme a seção visível. rootMargin recorta a faixa útil
    // logo abaixo do cabeçalho para não marcar duas seções ao mesmo tempo.
    var secoes = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    if ('IntersectionObserver' in window && secoes.length) {
      var obs = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a) {
            a.classList.toggle('ativo', a.getAttribute('href') === '#' + e.target.id);
          });
        });
      }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
      secoes.forEach(function (s) { obs.observe(s); });
    }
  })();

  /* ===== REVELAÇÃO DAS SEÇÕES ===== */
  (function revelacoes() {
    var alvos = $$('.revelar');
    if (semMovimento || !('IntersectionObserver' in window)) {
      alvos.forEach(function (el) { el.classList.add('revelar--visivel'); });
      return;
    }
    var obs = new IntersectionObserver(function (entradas, o) {
      entradas.forEach(function (e, i) {
        if (!e.isIntersecting) return;
        // Escalonamento leve entre irmãos, para as grades não subirem em bloco.
        var atraso = Math.min(i, 5) * 80;
        setTimeout(function () { e.target.classList.add('revelar--visivel'); }, atraso);
        o.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    alvos.forEach(function (el) { obs.observe(el); });
  })();

  /* ===== CONTADORES ===== */
  (function contadores() {
    var valores = $$('[data-contador]');
    if (!valores.length) return;

    function escrever(el, n) {
      var prefixo = el.dataset.prefixo || '';
      var sufixo = el.dataset.sufixo || '';
      el.textContent = prefixo + n.toLocaleString('pt-BR') + sufixo;
    }

    function animar(el) {
      var alvo = parseInt(el.dataset.contador, 10) || 0;
      if (semMovimento) { escrever(el, alvo); return; }

      var duracao = 1600;
      var inicio = null;
      function passo(agora) {
        if (inicio === null) inicio = agora;
        var t = Math.min((agora - inicio) / duracao, 1);
        var eased = 1 - Math.pow(1 - t, 3); // ease-out cúbico
        escrever(el, Math.round(alvo * eased));
        if (t < 1) requestAnimationFrame(passo);
      }
      requestAnimationFrame(passo);
    }

    if (!('IntersectionObserver' in window)) {
      valores.forEach(function (el) { escrever(el, parseInt(el.dataset.contador, 10) || 0); });
      return;
    }

    var obs = new IntersectionObserver(function (entradas, o) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        animar(e.target);
        o.unobserve(e.target); // roda uma vez só
      });
    }, { threshold: 0.4 });
    valores.forEach(function (el) { obs.observe(el); });
  })();

  /* ===== COBERTURA: chips destacam a região no mapa ===== */
  (function cobertura() {
    var chips = $$('.chip');
    var regioes = $$('.mapa__regiao');
    if (!chips.length) return;

    function destacar(nome) {
      regioes.forEach(function (r) { r.classList.toggle('ativa', r.dataset.regiao === nome); });
      chips.forEach(function (c) { c.classList.toggle('ativo', c.dataset.regiao === nome); });
    }
    function limpar() {
      regioes.forEach(function (r) { r.classList.remove('ativa'); });
      chips.forEach(function (c) { c.classList.remove('ativo'); });
    }

    // O destaque funciona nos dois sentidos: da lista para o mapa e do mapa
    // para a lista, porque o usuário tenta apontar tanto um quanto o outro.
    regioes.forEach(function (regiao) {
      var nome = regiao.dataset.regiao;
      regiao.addEventListener('mouseenter', function () { destacar(nome); });
      regiao.addEventListener('mouseleave', limpar);
    });

    chips.forEach(function (chip) {
      var nome = chip.dataset.regiao;
      chip.addEventListener('mouseenter', function () { destacar(nome); });
      chip.addEventListener('focus', function () { destacar(nome); });
      chip.addEventListener('mouseleave', limpar);
      chip.addEventListener('blur', limpar);
      // No toque não existe hover: o clique fixa e o segundo clique solta.
      chip.addEventListener('click', function () {
        if (chip.classList.contains('ativo')) limpar(); else destacar(nome);
      });
    });
  })();

  /* =======================================================================
     RASTREIO
     ======================================================================= */

  /* As 4 etapas da barra de progresso, na ordem em que acontecem. */
  var ETAPAS = ['Postado', 'Em trânsito', 'Saiu para entrega', 'Entregue'];

  /* Mapeia o texto de status vindo da API para etapa e cor do selo.
     Comparação sem acento e em minúsculas porque cada backend escreve
     de um jeito ("EM_TRANSITO", "Em Trânsito", "in_transit"). */
  /**
   * Vocabulário da plataforma da Martins Log — estados do envio e códigos de
   * evento. Traduzido aqui porque a API devolve o token cru: sem esta tabela
   * o cliente lia "GENERATED" no selo da própria encomenda.
   *
   * A busca por tabela vem antes das expressões regulares abaixo, que
   * seguem valendo para qualquer outro backend.
   */
  var MAPA_STATUS = {
    // Antes de a carga existir fisicamente.
    PENDING:            { etapa: 0, badge: 'pendente', rotulo: 'Aguardando pagamento' },
    RELEASED:           { etapa: 0, badge: 'pendente', rotulo: 'Aguardando postagem' },
    GENERATED:          { etapa: 0, badge: 'pendente', rotulo: 'Aguardando postagem' },
    ETIQUETA_EMITIDA:   { etapa: 0, badge: 'pendente', rotulo: 'Etiqueta emitida' },
    // A partir daqui a encomenda está em movimento.
    POSTED:             { etapa: 0, badge: 'transito', rotulo: 'Postado' },
    POSTADO:            { etapa: 0, badge: 'transito', rotulo: 'Postado' },
    TRANSFERENCIA:      { etapa: 1, badge: 'transito', rotulo: 'Em trânsito' },
    AGUARDANDO_TRATAMENTO: { etapa: 1, badge: 'transito', rotulo: 'Em tratamento' },
    SAIU_PARA_ENTREGA:  { etapa: 2, badge: 'rota', rotulo: 'Saiu para entrega' },
    ENTREGUE:           { etapa: 3, badge: 'entregue', rotulo: 'Entregue' },
    DELIVERED:          { etapa: 3, badge: 'entregue', rotulo: 'Entregue' },
    // Desvios: a barra de progresso some e o aviso toma o lugar dela.
    TENTATIVA_FRUSTRADA: { etapa: 2, badge: 'pendente', rotulo: 'Tentativa de entrega frustrada' },
    AGUARDANDO_RETIRADA: { etapa: 2, badge: 'pendente', rotulo: 'Aguardando retirada' },
    LOST:               { etapa: 2, badge: 'rota', rotulo: 'Extraviado' },
    CANCELLED:          { etapa: 0, badge: 'pendente', rotulo: 'Cancelado' }
  };

  function classificarStatus(texto) {
    var bruto = String(texto || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (Object.prototype.hasOwnProperty.call(MAPA_STATUS, bruto)) {
      return MAPA_STATUS[bruto];
    }

    var s = String(texto || '')
      .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .toLowerCase().replace(/[_-]+/g, ' ').trim();

    if (/entregue|delivered|finalizad/.test(s)) return { etapa: 3, badge: 'entregue', rotulo: 'Entregue' };
    if (/rota de entrega|saiu para entrega|out for delivery/.test(s)) return { etapa: 2, badge: 'rota', rotulo: 'Saiu para entrega' };
    if (/transito|transit|transferencia|coletad|collected/.test(s)) return { etapa: 1, badge: 'transito', rotulo: 'Em trânsito' };
    if (/pendencia|ocorrencia|exception|aguardando|pending|postad|posted/.test(s)) {
      var pendente = /pendencia|ocorrencia|exception/.test(s);
      return { etapa: 0, badge: pendente ? 'pendente' : 'transito', rotulo: pendente ? 'Pendência' : 'Aguardando postagem' };
    }
    return { etapa: 0, badge: 'transito', rotulo: texto || 'Em processamento' };
  }

  /* -----------------------------------------------------------------------
     normalizarResposta — PONTO DE AJUSTE quando o contrato do backend fechar.
     Aceita o formato esperado e as variações mais comuns, devolvendo sempre
     a mesma estrutura interna. Campo ausente vira null (e some da tela).
     Formato interno: { codigo, status, origem, destino, previsao, eventos: [
       { data, status, local, descricao } ] }
     ----------------------------------------------------------------------- */
  function normalizarResposta(json) {
    if (!json || typeof json !== 'object') return null;

    // Alguns backends embrulham a carga útil. A plataforma da Martins Log
    // usa `rastreio`; outros usam data/result/objeto.
    var raiz = json.rastreio || json.data || json.result || json.objeto || json;

    var eventosBrutos =
      raiz.eventos || raiz.events || raiz.history || raiz.historico ||
      raiz.tracking || raiz.movimentacoes || raiz.checkpoints || [];
    if (!Array.isArray(eventosBrutos)) eventosBrutos = [];

    function local(ev) {
      if (ev.local) return ev.local;
      if (ev.location) return ev.location;
      var cidade = ev.cidade || ev.city || null;
      var uf = ev.uf || ev.estado || ev.state || null;
      if (cidade && uf) return cidade + '/' + uf;
      return cidade || uf || null;
    }

    var eventos = eventosBrutos.map(function (ev) {
      return {
        data: ev.data || ev.date || ev.datetime || ev.dataHora || ev.ocorridoEm || ev.timestamp || null,
        // `titulo` vem primeiro: é a linha que a plataforma escreve para o
        // cliente ler. `codigo` fica por último, porque costuma ser o token
        // de máquina — só serve se não houver texto melhor.
        status: ev.titulo || ev.status || ev.situacao || ev.evento || ev.title || ev.tipo || ev.codigo || null,
        local: local(ev),
        descricao: ev.descricao || ev.description || ev.detalhe || ev.mensagem || null
      };
    }).filter(function (ev) {
      return ev.status || ev.descricao || ev.data;
    });

    // Mais recente primeiro. Sem data utilizável, preserva a ordem recebida.
    eventos.sort(function (a, b) {
      var da = a.data ? new Date(a.data).getTime() : NaN;
      var db = b.data ? new Date(b.data).getTime() : NaN;
      if (isNaN(da) || isNaN(db)) return 0;
      return db - da;
    });

    function rota(campo, alternativas) {
      for (var i = 0; i < alternativas.length; i++) {
        var v = raiz[alternativas[i]];
        if (v) return typeof v === 'object' ? (v.cidade || v.city || v.nome || null) : v;
      }
      return null;
    }

    // Só texto serve como código: em respostas embrulhadas, um campo com o
    // mesmo nome pode ser o objeto inteiro, e viraria "[object Object]".
    function texto(v) {
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    }

    return {
      codigo:
        texto(raiz.codigoRastreio) ||
        texto(raiz.codigo) ||
        texto(raiz.code) ||
        texto(raiz.rastreio) ||
        texto(raiz.trackingCode),
      status: raiz.status || raiz.situacao || (eventos[0] && eventos[0].status) || null,
      origem: rota('origem', ['origem', 'origin', 'remetente', 'from']),
      destino: rota('destino', ['destino', 'destination', 'destinatario', 'to']),
      previsao: raiz.previsao || raiz.previsaoEntrega || raiz.estimatedDelivery || raiz.forecast || null,
      eventos: eventos
    };
  }

  /* O grupo da etapa e o texto que o cliente lê são coisas diferentes:
     "Coletado" e "Chegou à unidade" caem os dois em "Em trânsito" na barra de
     progresso, mas no histórico cada evento precisa dizer o que de fato
     aconteceu. Então o texto do backend é preservado — só um token de máquina
     (EM_TRANSITO, OUT_FOR_DELIVERY) é trocado pelo rótulo legível. */
  function rotuloEvento(texto) {
    var s = String(texto || '').trim();
    if (!s) return classificarStatus(s).rotulo;
    if (/^[A-Z0-9_]+$/.test(s)) return classificarStatus(s).rotulo;
    return s;
  }

  /* Dados de exemplo: permitem validar o visual sem backend (?demo=1). */
  function respostaDemo(codigo) {
    var agora = Date.now();
    var h = 3600000;
    return {
      codigo: codigo,
      status: 'Saiu para entrega',
      origem: 'São Paulo/SP',
      destino: 'Curitiba/PR',
      previsao: new Date(agora + 8 * h).toISOString(),
      eventos: [
        { data: new Date(agora - 2 * h).toISOString(), status: 'Saiu para entrega', local: 'Curitiba/PR', descricao: 'Carga saiu para entrega ao destinatário.' },
        { data: new Date(agora - 14 * h).toISOString(), status: 'Em trânsito', local: 'Curitiba/PR', descricao: 'Chegou à unidade de destino.' },
        { data: new Date(agora - 30 * h).toISOString(), status: 'Em trânsito', local: 'Registro/SP', descricao: 'Em transferência entre unidades.' },
        { data: new Date(agora - 46 * h).toISOString(), status: 'Coletado', local: 'São Paulo/SP', descricao: 'Carga coletada no remetente.' },
        { data: new Date(agora - 50 * h).toISOString(), status: 'Postado', local: 'São Paulo/SP', descricao: 'Entrega registrada. Aguardando coleta.' }
      ]
    };
  }

  (function rastreio() {
    var form = $('#form-rastreio');
    var input = $('#codigo');
    var erro = $('#erro-codigo');
    var botao = $('.rastreio__enviar');
    var textoBotao = $('.rastreio__enviar-texto');
    var spinner = $('.spinner', botao);
    var saida = $('#resultado');
    if (!form) return;

    function mostrarErroCampo(msg) {
      erro.textContent = msg;
      erro.hidden = false;
      input.classList.add('invalido');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }

    function limparErroCampo() {
      erro.hidden = true;
      erro.textContent = '';
      input.classList.remove('invalido');
      input.removeAttribute('aria-invalid');
    }

    function carregando(ativo) {
      botao.disabled = ativo;
      textoBotao.hidden = ativo;
      spinner.hidden = !ativo;
    }

    function esqueleto() {
      saida.innerHTML =
        '<div class="esqueleto" aria-hidden="true">' +
        '<div class="esqueleto__bloco"></div>' +
        '<div class="esqueleto__bloco"></div>' +
        '<div class="esqueleto__bloco"></div>' +
        '</div>';
    }

    function estadoErro(titulo, mensagem) {
      saida.innerHTML = '';
      var box = criar('div', 'estado');
      box.setAttribute('role', 'status');
      box.innerHTML =
        '<span class="estado__icone"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 8v5M12 16.5v.01"/></svg></span>';
      var texto = criar('p');
      texto.appendChild(criar('strong', null, titulo));
      texto.appendChild(document.createTextNode(mensagem));
      box.appendChild(texto);
      saida.appendChild(box);
    }

    function renderEtapas(indice) {
      // Na última etapa a entrega acabou: ela recebe o visto de concluída em
      // vez do marcador pulsante, que anunciaria algo ainda em andamento.
      var finalizada = indice >= ETAPAS.length - 1;

      var lista = criar('div', 'etapas');
      lista.setAttribute('aria-label', 'Progresso da entrega');
      ETAPAS.forEach(function (nome, i) {
        var feita = i < indice || (finalizada && i <= indice);
        var atual = !finalizada && i === indice;

        var item = criar('div', 'etapa' + (feita ? ' etapa--feita' : atual ? ' etapa--atual' : ''));
        var marca = criar('span', 'etapa__marca');
        marca.setAttribute('aria-hidden', 'true');
        if (feita) {
          marca.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>';
        }
        item.appendChild(marca);
        item.appendChild(criar('span', 'etapa__nome', nome));
        lista.appendChild(item);
      });
      return lista;
    }

    function renderResultado(dados) {
      var info = classificarStatus(dados.status);
      saida.innerHTML = '';

      var wrap = criar('div', 'resultado');

      /* --- cabeçalho --- */
      var topo = criar('div', 'resultado__topo');
      var linha = criar('div', 'resultado__linha');
      if (dados.codigo) linha.appendChild(criar('span', 'resultado__codigo', dados.codigo));
      linha.appendChild(criar('span', 'badge badge--' + info.badge, rotuloEvento(dados.status)));
      topo.appendChild(linha);

      if (dados.origem || dados.destino) {
        var rota = criar('p', 'resultado__rota');
        rota.innerHTML = (dados.origem ? '<strong>' + dados.origem + '</strong>' : '') +
          (dados.origem && dados.destino ? ' &rarr; ' : '') +
          (dados.destino ? '<strong>' + dados.destino + '</strong>' : '');
        topo.appendChild(rota);
      }

      var previsao = formatarData(dados.previsao);
      if (previsao) {
        topo.appendChild(criar('p', 'resultado__rota', 'Previsão de entrega: ' + previsao));
      }
      wrap.appendChild(topo);

      /* --- barra de etapas --- */
      wrap.appendChild(renderEtapas(info.etapa));

      /* --- linha do tempo --- */
      if (dados.eventos.length) {
        var tl = criar('div', 'timeline');
        tl.appendChild(criar('p', 'timeline__titulo', 'Histórico'));
        dados.eventos.forEach(function (ev, i) {
          var item = criar('div', 'evento' + (i === 0 ? ' evento--recente' : ''));
          var ponto = criar('span', 'evento__ponto');
          ponto.setAttribute('aria-hidden', 'true');
          item.appendChild(ponto);

          var quando = formatarDataHora(ev.data);
          if (quando) item.appendChild(criar('p', 'evento__data', quando));
          if (ev.status) item.appendChild(criar('p', 'evento__status', rotuloEvento(ev.status)));
          if (ev.local) item.appendChild(criar('p', 'evento__local', ev.local));
          if (ev.descricao) item.appendChild(criar('p', 'evento__descricao', ev.descricao));
          tl.appendChild(item);
        });
        wrap.appendChild(tl);
      }

      /* --- nova consulta --- */
      var acoes = criar('div', 'resultado__acoes');
      var novo = criar('button', 'botao botao--navy', 'Nova consulta');
      novo.type = 'button';
      novo.addEventListener('click', function () {
        saida.innerHTML = '';
        input.value = '';
        limparErroCampo();
        input.focus();
      });
      acoes.appendChild(novo);
      wrap.appendChild(acoes);

      saida.appendChild(wrap);
    }

    function consultar(codigo) {
      carregando(true);
      esqueleto();

      if (MODO_DEMO) {
        // Espera curta só para o esqueleto aparecer e a transição ser visível.
        setTimeout(function () {
          carregando(false);
          renderResultado(normalizarResposta(respostaDemo(codigo)));
        }, 700);
        return;
      }

      var controle = new AbortController();
      var relogio = setTimeout(function () { controle.abort(); }, TIMEOUT_MS);
      var base = String(cfg.rastreioEndpoint).replace(/\/+$/, '');

      fetch(base + '/' + encodeURIComponent(codigo), {
        signal: controle.signal,
        headers: { Accept: 'application/json' }
      })
        .then(function (resp) {
          clearTimeout(relogio);
          if (resp.status === 404) {
            var e404 = new Error('nao-encontrado'); e404.tipo = 'nao-encontrado'; throw e404;
          }
          // 422: o código passou no comprimento mínimo daqui, mas falhou na
          // validação do servidor (formato ou dígito verificador). É erro de
          // digitação, não indisponibilidade — dizer "tente mais tarde" faria
          // a pessoa esperar em vez de conferir o que digitou.
          if (resp.status === 422) {
            var e422 = new Error('invalido'); e422.tipo = 'invalido'; throw e422;
          }
          // 429: limite de consultas do servidor.
          if (resp.status === 429) {
            var e429 = new Error('limite'); e429.tipo = 'limite'; throw e429;
          }
          if (resp.status >= 500) {
            var e5 = new Error('servidor'); e5.tipo = 'servidor'; throw e5;
          }
          if (!resp.ok) {
            var eo = new Error('resposta'); eo.tipo = 'servidor'; throw eo;
          }
          return resp.json();
        })
        .then(function (json) {
          var dados = normalizarResposta(json);
          if (!dados || (!dados.status && !dados.eventos.length)) {
            var ev = new Error('vazio'); ev.tipo = 'nao-encontrado'; throw ev;
          }
          if (!dados.codigo) dados.codigo = codigo;
          carregando(false);
          renderResultado(dados);
        })
        .catch(function (err) {
          clearTimeout(relogio);
          carregando(false);
          if (err.tipo === 'nao-encontrado') {
            estadoErro('Código não encontrado. ', 'Não encontramos nenhuma encomenda com esse código. Confira e tente novamente.');
          } else if (err.tipo === 'invalido') {
            estadoErro('Código inválido. ', 'Esse código não tem o formato de um código de rastreio. Confira os caracteres e tente de novo.');
          } else if (err.tipo === 'limite') {
            estadoErro('Muitas consultas. ', 'Você fez consultas demais em pouco tempo. Aguarde alguns minutos e tente novamente.');
          } else if (err.tipo === 'servidor') {
            estadoErro('Consulta indisponível. ', 'Nossa consulta está indisponível no momento. Tente em instantes.');
          } else {
            estadoErro('Sem conexão. ', 'Não foi possível conectar. Verifique sua internet e tente novamente.');
          }
        });
    }

    /**
     * Leva a pessoa para a página de rastreio daquele código, na plataforma.
     *
     * A landing não desenha mais a rota: o acompanhamento tem endereço
     * próprio (`{rastreioPagina}/{codigo}`), e endereço é o que se copia,
     * salva nos favoritos, manda no WhatsApp e reabre depois. O resultado
     * desenhado aqui morria no recarregar da página e não tinha como ser
     * compartilhado — a mesma consulta precisava ser digitada de novo.
     *
     * O botão fica em estado de carregamento antes de navegar: entre o
     * clique e a página nova existe uma espera de rede, e sem sinal nenhum
     * ela parece um clique que não funcionou.
     */
    function irParaRastreio(codigo) {
      var base = String(cfg.rastreioPagina || '').replace(/\/+$/, '');
      carregando(true);
      window.location.assign(base + '/' + encodeURIComponent(codigo));
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var codigo = input.value.replace(/\s+/g, '').trim().toUpperCase();
      input.value = codigo;

      if (codigo.length < 6) {
        mostrarErroCampo('Informe um código de rastreio válido.');
        saida.innerHTML = '';
        return;
      }
      limparErroCampo();

      /*
        Consulta embutida sobrevive em dois casos: `?demo=1`, que existe para
        mostrar o desenho do resultado sem backend, e a ausência de
        `rastreioPagina` na configuração — sem destino para onde ir, cair no
        comportamento antigo é melhor que um clique que não faz nada.
      */
      if (MODO_DEMO || !cfg.rastreioPagina) {
        consultar(codigo);
        return;
      }
      irParaRastreio(codigo);
    });

    input.addEventListener('input', function () {
      if (input.classList.contains('invalido')) limparErroCampo();
    });

    /* Deep link: ?codigo=XXXX preenche e consulta sozinho. */
    var doLink = params.get('codigo');
    if (doLink) {
      input.value = doLink.trim().toUpperCase();
      // Espera o layout assentar para o scroll parar no lugar certo.
      requestAnimationFrame(function () {
        $('#rastreio').scrollIntoView({ behavior: semMovimento ? 'auto' : 'smooth', block: 'center' });
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }
  })();

  /* =========================================================================
     CENTRAL DE AJUDA

     Busca por palavra-chave sobre uma base de respostas escritas à mão — não
     é um modelo de linguagem. A escolha é deliberada: as perguntas que mais
     chegam são sobre prazo, e um gerador de texto responderia "de 3 a 5 dias"
     com a mesma confiança com que responderia o prazo certo. Uma promessa de
     entrega errada dita pela transportadora vira reclamação, não atendimento.

     Aqui cada resposta é fixa, revisável e testada (teste/ajuda.test.js).
     Quando nada casa, a conversa não inventa: oferece o canal humano.
     ========================================================================= */

  /**
   * Base de respostas.
   *
   * `termos` são os gatilhos de busca, já sem acento e em minúsculas — é
   * assim que a pergunta chega em `pontuar`. Escrever "codigo" com acento
   * aqui criaria um gatilho que nunca casa, em silêncio; o teste cobre isso.
   *
   * `chip` é o atalho clicável. Só os primeiros viram botão na tela: uma
   * grade com dezesseis opções é um índice, não um atendimento.
   */
  var BASE_AJUDA = [
    {
      id: 'prazo',
      chip: 'Quanto tempo leva para chegar?',
      titulo: 'Prazo de entrega',
      termos: [
        'prazo', 'quanto tempo', 'demora', 'quando chega', 'quando vai chegar',
        'tempo de entrega', 'quantos dias', 'dias uteis', 'previsao', 'chega quando'
      ],
      resposta: [
        'O prazo é de <strong>até 10 dias úteis</strong> a partir da postagem — não a partir da compra.',
        'Dias úteis não contam sábado, domingo nem feriado. Um pedido postado numa sexta-feira, por exemplo, começa a contar na segunda.',
        'Enquanto a loja não despacha o pacote, o prazo ainda não começou. É por isso que o rastreio pode ficar alguns dias sem movimento logo no começo.'
      ]
    },
    {
      id: 'rastrear',
      chip: 'Como rastreio meu pedido?',
      titulo: 'Como rastrear',
      termos: [
        'rastrear', 'rastreio', 'rastreamento', 'acompanhar', 'onde esta',
        'cade meu pedido', 'localizar', 'status do pedido', 'ver o pedido'
      ],
      resposta: [
        'É só informar o código de rastreio no campo de consulta desta página. Ele mostra todo o caminho do pacote, do embarque à entrega, atualizado em tempo real.',
        'O código tem o formato <strong>EC000000000BR</strong> — duas letras, números e mais duas letras no fim.'
      ],
      acao: { rotulo: 'Abrir o rastreio', href: '#rastreio' }
    },
    {
      id: 'sem-codigo',
      chip: 'Não recebi o código de rastreio',
      titulo: 'Código de rastreio não chegou',
      termos: [
        'nao recebi o codigo', 'sem codigo', 'nao tenho o codigo', 'perdi o codigo',
        'nao chegou o codigo', 'cade o codigo', 'onde pego o codigo'
      ],
      resposta: [
        'Quem gera e envia o código é a <strong>loja onde você comprou</strong>, assim que despacha o pacote. Ele costuma chegar por e-mail ou WhatsApp — vale conferir a caixa de spam.',
        'Nós transportamos a carga, mas não temos acesso à lista de pedidos da loja: sem o código, não conseguimos localizar a encomenda pelo seu nome ou CPF.',
        'Se já se passaram alguns dias desde a confirmação do pagamento e nada chegou, fale com a loja.'
      ]
    },
    {
      id: 'codigo-sem-info',
      chip: 'O código não mostra nada ainda',
      titulo: 'Código sem informação',
      termos: [
        'nao aparece nada', 'sem informacao', 'codigo invalido', 'nao encontrado',
        'nao reconhece', 'codigo nao funciona', 'nao acha o codigo', 'sem movimentacao'
      ],
      resposta: [
        'Um código recém-criado leva algumas horas para aparecer no sistema. Isso é normal: a etiqueta foi emitida, mas o pacote ainda não passou pela primeira leitura na unidade.',
        'Se depois de <strong>24 horas úteis</strong> continuar sem nada, confira se o código foi digitado inteiro e sem espaços. Persistindo, o problema é na postagem — a loja precisa verificar.'
      ]
    },
    {
      id: 'parado',
      chip: 'O rastreio está parado há dias',
      titulo: 'Rastreio sem atualização',
      termos: [
        'parado', 'nao atualiza', 'sem atualizacao', 'travado', 'mesma situacao',
        'nao anda', 'ha dias', 'dias sem'
      ],
      resposta: [
        'Entre uma cidade e outra o pacote viaja sem novas leituras — em trechos longos, dois ou três dias sem registro são esperados. O rastreio só marca quando a carga chega a uma unidade.',
        'A situação <strong>Em transferência</strong> é justamente essa: está em movimento, mesmo sem aparecer nada novo.',
        'Passando de cinco dias úteis sem nenhum registro, aí sim vale falar com a gente.'
      ]
    },
    {
      id: 'atrasado',
      chip: 'Passou do prazo e não chegou',
      titulo: 'Entrega fora do prazo',
      termos: [
        'atrasado', 'atraso', 'passou do prazo', 'fora do prazo', 'estourou o prazo',
        'venceu o prazo', 'nao chegou ainda', 'ja passou'
      ],
      resposta: [
        'Antes de tudo, confira a data de <strong>postagem</strong> no rastreio: a contagem começa ali, e não no dia da compra. É a confusão mais comum.',
        'Se o prazo realmente venceu, fale com a gente com o código em mãos que rastreamos a carga internamente e damos uma posição.',
        'Se a última situação for uma tentativa de entrega frustrada ou aguardando retirada, o prazo fica suspenso até você agir — veja as perguntas sobre esses casos.'
      ]
    },
    {
      id: 'tentativa',
      chip: 'Tentaram entregar e eu não estava',
      titulo: 'Tentativa de entrega frustrada',
      termos: [
        'nao estava em casa', 'tentativa frustrada', 'nao me encontraram',
        'perdi a entrega', 'passou e nao entregou', 'ninguem em casa', 'ausente'
      ],
      resposta: [
        'São feitas <strong>até 3 tentativas</strong> em dias diferentes, sem custo extra. Não precisa fazer nada: a próxima acontece automaticamente no dia útil seguinte.',
        'Depois da terceira tentativa sem sucesso, o pacote fica disponível para retirada na unidade mais próxima por 7 dias corridos. Passado esse prazo, volta para a loja.'
      ]
    },
    {
      id: 'retirada',
      chip: 'Está aguardando retirada',
      titulo: 'Aguardando retirada na unidade',
      termos: [
        'aguardando retirada', 'retirar', 'buscar na unidade', 'ir buscar',
        'disponivel para retirada', 'retirada'
      ],
      resposta: [
        'Leve um <strong>documento com foto</strong> no mesmo nome do destinatário. Se for outra pessoa retirando, ela precisa de uma autorização assinada por você, junto com cópia do seu documento.',
        'O pacote fica guardado por <strong>7 dias corridos</strong>. Depois disso volta para a loja, e a devolução do valor passa a ser tratada com ela.',
        'O endereço da unidade aparece na própria consulta de rastreio.'
      ]
    },
    {
      id: 'quem-recebe',
      chip: 'Preciso estar em casa para receber?',
      titulo: 'Quem pode receber',
      termos: [
        'quem pode receber', 'preciso estar', 'outra pessoa', 'vizinho', 'porteiro',
        'receber por mim', 'assinar', 'estar em casa'
      ],
      resposta: [
        'Não precisa ser você. Qualquer pessoa maior de idade no endereço pode receber, apresentando documento e assinando o comprovante — inclusive porteiro ou zelador, em prédios.',
        'A entrega acontece em <strong>dias úteis, das 8h às 18h</strong>. Não entregamos aos sábados, domingos e feriados.'
      ]
    },
    {
      id: 'endereco',
      chip: 'Errei o endereço, dá para mudar?',
      titulo: 'Endereço errado ou incompleto',
      termos: [
        'endereco errado', 'mudar o endereco', 'trocar o endereco', 'alterar endereco',
        'endereco incompleto', 'numero errado', 'cep errado', 'me mudei'
      ],
      resposta: [
        'O endereço vem da loja junto com o pedido, e é ela que precisa solicitar a correção — nós não alteramos o destino por conta própria.',
        'Fale com a loja o quanto antes: <strong>enquanto o pacote não sair para entrega</strong>, a mudança costuma ser possível. Depois disso, só depois da tentativa frustrada.'
      ]
    },
    {
      id: 'taxa',
      chip: 'Recebi cobrança de taxa. É golpe?',
      titulo: 'Cobrança de taxa por mensagem',
      termos: [
        'taxa', 'cobranca', 'pagar', 'pagamento', 'golpe', 'sms', 'link de pagamento',
        'pix', 'boleto', 'me pediram', 'tarifa', 'liberar o pacote'
      ],
      resposta: [
        '<strong>É golpe.</strong> A Martins Log nunca envia SMS, e-mail ou WhatsApp pedindo pagamento de taxa, tarifa alfandegária ou "liberação" de pacote. Não pague e não clique no link.',
        'O frete é acertado com a loja no momento da compra. Não existe nenhuma cobrança extra do transportador na hora da entrega.',
        'Se receber uma mensagem dessas, apague. Na dúvida, confira a situação real do pacote aqui no rastreio desta página — é a única fonte oficial.'
      ],
      acao: { rotulo: 'Conferir no rastreio oficial', href: '#rastreio' }
    },
    {
      id: 'avaria',
      chip: 'Chegou danificado ou faltando item',
      titulo: 'Produto danificado ou incompleto',
      termos: [
        'danificado', 'quebrado', 'avaria', 'amassado', 'violado', 'faltando',
        'veio errado', 'produto errado', 'aberto', 'estragado'
      ],
      resposta: [
        'Se a embalagem estiver visivelmente danificada ou violada, <strong>recuse a entrega</strong> e anote o motivo no comprovante — é o registro que garante o seguro da carga.',
        'Se só percebeu depois, fotografe a embalagem e o produto e comunique a loja em até 7 dias. Toda carga é segurada; a loja aciona o seguro junto à gente.',
        'Produto errado ou faltando item é responsabilidade da loja: ela monta e lacra o pacote, nós só transportamos lacrado.'
      ]
    },
    {
      id: 'cancelar',
      chip: 'Quero cancelar ou devolver',
      titulo: 'Cancelamento e devolução',
      termos: [
        'cancelar', 'devolver', 'devolucao', 'estorno', 'reembolso', 'arrependimento',
        'nao quero mais', 'desistir', 'trocar o produto', 'troca'
      ],
      resposta: [
        'Cancelamento, troca e reembolso são tratados <strong>com a loja onde você comprou</strong> — o contrato de venda é com ela, não conosco.',
        'Assim que a loja autorizar a devolução, ela emite a etiqueta de retorno e nós fazemos a coleta ou o encaminhamento.'
      ]
    },
    {
      id: 'cobertura',
      chip: 'Vocês entregam na minha cidade?',
      titulo: 'Área de cobertura',
      termos: [
        'cobertura', 'atende', 'entrega em', 'minha cidade', 'meu estado',
        'todo o brasil', 'regiao', 'interior', 'chegam ate'
      ],
      resposta: [
        'Atendemos <strong>todo o território nacional</strong>, com frota própria nos principais corredores e parceiros credenciados na ponta.',
        'A seção de cobertura desta página mostra os prazos por região.'
      ],
      acao: { rotulo: 'Ver a cobertura', href: '#cobertura' }
    },
    {
      id: 'frete',
      chip: 'Quanto custa o frete?',
      titulo: 'Valor do frete',
      termos: [
        'quanto custa', 'valor do frete', 'preco do frete', 'quanto e o frete',
        'cotacao', 'orcamento', 'custo'
      ],
      resposta: [
        'Para quem comprou em uma loja, o frete já foi calculado e cobrado no checkout dela — não há nada a pagar na entrega.',
        'Se você é lojista e quer contratar a Martins Log, fale com a gente pelos canais no rodapé desta página que montamos uma tabela para o seu volume.'
      ]
    },
    {
      id: 'atendente',
      chip: 'Quero falar com um atendente',
      titulo: 'Atendimento humano',
      termos: [
        'atendente', 'falar com alguem', 'humano', 'pessoa', 'telefone', 'contato',
        'whatsapp', 'ligar', 'suporte', 'reclamacao', 'reclamar'
      ],
      resposta: [
        'Nosso atendimento funciona de <strong>segunda a sexta, das 8h às 18h</strong>.',
        'Deixe o <strong>código de rastreio</strong> em mãos na primeira mensagem — com ele a consulta é imediata; sem ele, o atendimento trava logo no começo.'
      ],
      humano: true
    }
  ];

  /** Tudo em minúsculas, sem acento e sem pontuação — o formato dos `termos`. */
  function normalizarPergunta(texto) {
    return String(texto == null ? '' : texto)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Casa o termo respeitando fronteira de palavra.
   *
   * Com `indexOf` cru, o gatilho "taxa" casaria dentro de "sintaxe" e "pagar"
   * dentro de "pagarei" — o segundo até serve, o primeiro entrega a resposta
   * sobre golpe para quem perguntou outra coisa. A fronteira resolve os dois
   * sem precisar de lista de exceções.
   */
  function contemTermo(texto, termo) {
    var i = texto.indexOf(termo);
    while (i >= 0) {
      var antesOk = i === 0 || texto.charAt(i - 1) === ' ';
      var fim = i + termo.length;
      var depoisOk = fim >= texto.length || texto.charAt(fim) === ' ';
      if (antesOk && depoisOk) return true;
      i = texto.indexOf(termo, i + 1);
    }
    return false;
  }

  /**
   * Peso 5 para expressão de duas ou mais palavras, 2 para palavra solta.
   *
   * "quanto tempo" só aparece em quem pergunta sobre prazo; "pagar" aparece
   * em meia dúzia de contextos. Somar 1 para cada um faria a coincidência de
   * duas palavras genéricas vencer o sinal específico.
   */
  function pontuar(pergunta, item) {
    var pontos = 0;
    for (var i = 0; i < item.termos.length; i++) {
      var termo = item.termos[i];
      if (contemTermo(pergunta, termo)) {
        pontos += termo.indexOf(' ') >= 0 ? 5 : 2;
      }
    }
    return pontos;
  }

  /** Duas letras, seis ou mais dígitos e duas letras: EC000000014BR. */
  function pareceCodigo(pergunta) {
    return /(^|\s)[a-z]{2}\d{6,}[a-z]{2}(\s|$)/.test(pergunta);
  }

  /**
   * Decide o que responder.
   *
   * Devolve `vazio` quando nada pontua, em vez de entregar o item de maior
   * pontuação seja ela qual for: responder sobre prazo a quem perguntou de
   * nota fiscal é pior do que admitir que não sabe e passar para o humano.
   */
  function responder(texto) {
    var pergunta = normalizarPergunta(texto);
    if (!pergunta) return { tipo: 'vazio', relacionados: [] };
    if (pareceCodigo(pergunta)) return { tipo: 'codigo', relacionados: [] };

    var ranking = [];
    for (var i = 0; i < BASE_AJUDA.length; i++) {
      var pontos = pontuar(pergunta, BASE_AJUDA[i]);
      if (pontos > 0) ranking.push({ item: BASE_AJUDA[i], pontos: pontos });
    }
    if (!ranking.length) return { tipo: 'vazio', relacionados: [] };

    ranking.sort(function (a, b) { return b.pontos - a.pontos; });

    /* Empate ou quase-empate vira sugestão, não segunda resposta despejada
       na tela: quem perguntou escolhe qual dos dois caminhos era o dele. */
    var melhor = ranking[0];
    var relacionados = [];
    for (var j = 1; j < ranking.length && relacionados.length < 2; j++) {
      if (ranking[j].pontos >= melhor.pontos * 0.6) relacionados.push(ranking[j].item);
    }

    return { tipo: 'resposta', item: melhor.item, relacionados: relacionados };
  }

  /* ===== TELA ===== */
  (function () {
    var painel = $('#ajuda-conversa');
    var form = $('#form-ajuda');
    if (!painel || !form) return;

    var campo = $('#ajuda-pergunta');
    var atalhos = $('#ajuda-atalhos');
    var contato = cfg.ajudaContato || {};

    /* Ancora a rolagem no início da resposta nova, e não no fim do painel:
       resposta longa rolada até o rodapé começa no meio da frase. */
    function rolarPara(el) {
      painel.scrollTop = el.offsetTop - painel.offsetTop - 12;
    }

    function bolha(autor, classe) {
      var linha = criar('div', 'ajuda__linha ajuda__linha--' + autor);
      var b = criar('div', 'ajuda__bolha ' + (classe || ''));
      linha.appendChild(b);
      painel.appendChild(linha);
      return b;
    }

    function escrever(bolhaEl, item) {
      var titulo = criar('p', 'ajuda__titulo', item.titulo);
      bolhaEl.appendChild(titulo);
      for (var i = 0; i < item.resposta.length; i++) {
        var p = criar('p');
        /* Conteúdo nosso, escrito neste arquivo — nada aqui vem do usuário
           nem da rede, então o <strong> das ênfases pode ser interpretado. */
        p.innerHTML = item.resposta[i];
        bolhaEl.appendChild(p);
      }
      if (item.acao) {
        var a = criar('a', 'ajuda__acao', item.acao.rotulo);
        a.href = item.acao.href;
        bolhaEl.appendChild(a);
      }
      if (item.humano) bolhaEl.appendChild(blocoContato());
    }

    /**
     * Canais reais, tirados da configuração.
     *
     * Sem `ajudaContato.whatsapp` configurado o botão simplesmente não nasce:
     * um link de WhatsApp para um número que não existe é pior que nenhum —
     * o cliente tenta, não recebe resposta e vai embora achando que ninguém
     * atende.
     */
    function blocoContato() {
      var caixa = criar('div', 'ajuda__canais');
      if (contato.whatsapp) {
        var wa = criar('a', 'ajuda__acao ajuda__acao--zap', 'Chamar no WhatsApp');
        wa.href = 'https://wa.me/' + contato.whatsapp +
          '?text=' + encodeURIComponent('Olá! Preciso de ajuda com meu pedido. Código de rastreio: ');
        wa.rel = 'noopener';
        wa.target = '_blank';
        caixa.appendChild(wa);
      }
      if (contato.telefone) {
        var tel = criar('a', 'ajuda__acao ajuda__acao--vazado', contato.telefoneRotulo || contato.telefone);
        tel.href = 'tel:' + contato.telefone;
        caixa.appendChild(tel);
      }
      if (contato.email) {
        var mail = criar('a', 'ajuda__acao ajuda__acao--vazado', contato.email);
        mail.href = 'mailto:' + contato.email;
        caixa.appendChild(mail);
      }
      return caixa;
    }

    function responderNaTela(texto) {
      var pergunta = bolha('pessoa');
      pergunta.textContent = texto;

      var r = responder(texto);
      var resposta = bolha('sistema');

      if (r.tipo === 'codigo') {
        resposta.appendChild(criar('p', 'ajuda__titulo', 'Isso parece um código de rastreio'));
        var p = criar('p', null, 'Consultas de código são feitas no campo de rastreio — ele mostra a situação atualizada e todo o histórico do pacote.');
        resposta.appendChild(p);
        var ir = criar('a', 'ajuda__acao', 'Consultar este código');
        ir.href = '#rastreio';
        ir.addEventListener('click', function () {
          var alvo = $('#codigo');
          if (alvo) alvo.value = texto.trim().toUpperCase();
        });
        resposta.appendChild(ir);
      } else if (r.tipo === 'vazio') {
        resposta.appendChild(criar('p', 'ajuda__titulo', 'Essa eu não sei responder'));
        resposta.appendChild(criar('p', null,
          'Não encontrei nada sobre isso nas perguntas frequentes. Tente reescrever com outras palavras, ou fale direto com a nossa equipe — de segunda a sexta, das 8h às 18h.'));
        resposta.appendChild(blocoContato());
      } else {
        escrever(resposta, r.item);
        if (r.relacionados.length) {
          var caixa = criar('div', 'ajuda__relacionados');
          caixa.appendChild(criar('span', 'ajuda__relacionados-rotulo', 'Também pode ser isto:'));
          for (var i = 0; i < r.relacionados.length; i++) {
            caixa.appendChild(botaoAtalho(r.relacionados[i].chip));
          }
          resposta.appendChild(caixa);
        }
      }

      rolarPara(pergunta.parentNode);
    }

    function botaoAtalho(rotulo) {
      var b = criar('button', 'ajuda__chip', rotulo);
      b.type = 'button';
      b.addEventListener('click', function () { responderNaTela(rotulo); });
      return b;
    }

    /* Só os seis primeiros viram atalho visível: a lista inteira na tela é
       um índice para ler, e quem chega aqui quer uma resposta. */
    if (atalhos) {
      for (var i = 0; i < BASE_AJUDA.length && i < 6; i++) {
        atalhos.appendChild(botaoAtalho(BASE_AJUDA[i].chip));
      }
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var texto = campo.value.trim();
      if (!texto) return;
      responderNaTela(texto);
      campo.value = '';
      campo.focus();
    });
  })();
})();

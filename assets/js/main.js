/* =========================================================================
   MARTINS LOG — comportamento da página
   Módulos: config → utilitários → cabeçalho → revelações → contadores →
            cobertura → rastreio → contato → toasts
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

  /* ===== LINKS DE WHATSAPP ===== */
  (function ligarWhatsapp() {
    var numero = cfg.whatsapp || '';
    var texto = encodeURIComponent('Olá! Vim pelo site da Martins Log e gostaria de um orçamento.');
    var url = 'https://wa.me/' + numero + '?text=' + texto;
    $$('[data-whatsapp]').forEach(function (a) { a.href = url; });
  })();

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
  function classificarStatus(texto) {
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

    // Alguns backends embrulham a carga útil em data/result/objeto.
    var raiz = json.data || json.result || json.objeto || json;

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
        status: ev.status || ev.situacao || ev.evento || ev.title || ev.tipo || null,
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

    return {
      codigo: raiz.codigo || raiz.code || raiz.rastreio || raiz.trackingCode || null,
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
          } else if (err.tipo === 'servidor') {
            estadoErro('Consulta indisponível. ', 'Nossa consulta está indisponível no momento. Tente em instantes.');
          } else {
            estadoErro('Sem conexão. ', 'Não foi possível conectar. Verifique sua internet e tente novamente.');
          }
        });
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
      consultar(codigo);
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

  /* =======================================================================
     CONTATO
     ======================================================================= */
  (function contato() {
    var form = $('#form-contato');
    if (!form) return;

    var botao = $('#btn-contato');
    var textoBotao = $('.btn__texto', botao);
    var spinner = $('.spinner', botao);
    var telefone = $('#telefone');

    /* Máscara (00) 00000-0000 — reescreve a partir dos dígitos, o que
       mantém o campo coerente também quando o usuário apaga no meio. */
    telefone.addEventListener('input', function () {
      var d = telefone.value.replace(/\D/g, '').slice(0, 11);
      var saida = '';
      if (d.length) saida = '(' + d.slice(0, 2);
      if (d.length >= 3) saida += ') ' + d.slice(2, d.length > 10 ? 7 : 6);
      if (d.length > 6) saida += '-' + (d.length > 10 ? d.slice(7) : d.slice(6));
      telefone.value = saida;
    });

    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    var regras = {
      nome: function (v) { return v.trim().length >= 2 ? null : 'Informe seu nome.'; },
      email: function (v) { return EMAIL.test(v.trim()) ? null : 'Informe um e-mail válido.'; },
      telefone: function (v) { return v.replace(/\D/g, '').length >= 10 ? null : 'Informe um telefone com DDD.'; },
      origem: function (v) { return v.trim() ? null : 'Informe a cidade de origem.'; },
      destino: function (v) { return v.trim() ? null : 'Informe a cidade de destino.'; }
    };

    function marcarErro(campo, msg) {
      var alvo = form.elements[campo];
      var caixa = $('#erro-' + campo);
      alvo.classList.toggle('invalido', !!msg);
      if (msg) alvo.setAttribute('aria-invalid', 'true'); else alvo.removeAttribute('aria-invalid');
      if (caixa) {
        caixa.textContent = msg || '';
        caixa.hidden = !msg;
      }
    }

    Object.keys(regras).forEach(function (campo) {
      var alvo = form.elements[campo];
      alvo.addEventListener('blur', function () { marcarErro(campo, regras[campo](alvo.value)); });
      alvo.addEventListener('input', function () {
        if (alvo.classList.contains('invalido')) marcarErro(campo, regras[campo](alvo.value));
      });
    });

    function carregando(ativo) {
      botao.disabled = ativo;
      textoBotao.hidden = ativo;
      spinner.hidden = !ativo;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var primeiroErro = null;
      Object.keys(regras).forEach(function (campo) {
        var msg = regras[campo](form.elements[campo].value);
        marcarErro(campo, msg);
        if (msg && !primeiroErro) primeiroErro = campo;
      });
      if (primeiroErro) {
        form.elements[primeiroErro].focus();
        return;
      }

      var dados = {
        nome: form.elements.nome.value.trim(),
        email: form.elements.email.value.trim(),
        telefone: form.elements.telefone.value.trim(),
        tipoCarga: form.elements.tipoCarga.value || null,
        origem: form.elements.origem.value.trim(),
        destino: form.elements.destino.value.trim(),
        mensagem: form.elements.mensagem.value.trim() || null
      };

      carregando(true);

      if (!cfg.contatoEndpoint) {
        setTimeout(function () {
          carregando(false);
          form.reset();
          toast('sucesso', 'Pedido enviado! (modo demonstração) Nossa equipe retorna em até 1 dia útil.');
        }, 700);
        return;
      }

      var controle = new AbortController();
      var relogio = setTimeout(function () { controle.abort(); }, TIMEOUT_MS);

      fetch(cfg.contatoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(dados),
        signal: controle.signal
      })
        .then(function (resp) {
          clearTimeout(relogio);
          if (!resp.ok) throw new Error('falha');
          carregando(false);
          form.reset();
          Object.keys(regras).forEach(function (c) { marcarErro(c, null); });
          toast('sucesso', 'Pedido enviado! Nossa equipe retorna em até 1 dia útil.');
        })
        .catch(function () {
          clearTimeout(relogio);
          carregando(false);
          toast('erro', 'Não conseguimos enviar agora. Tente de novo ou fale com a gente no WhatsApp.');
        });
    });
  })();

  /* ===== TOASTS ===== */
  function toast(tipo, mensagem) {
    var caixa = $('#toasts');
    if (!caixa) return;

    var el = criar('div', 'toast toast--' + tipo);
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = tipo === 'sucesso'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>'
      : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>';
    el.appendChild(criar('span', null, mensagem));
    caixa.appendChild(el);

    setTimeout(function () {
      el.classList.add('toast--saindo');
      setTimeout(function () { el.remove(); }, 300);
    }, 5200);
  }

  /* ===== BOTÃO FLUTUANTE DO WHATSAPP ===== */
  (function whatsappFlutuante() {
    var botao = $('.whatsapp-flutuante');
    if (!botao) return;
    function avaliar() {
      botao.classList.toggle('whatsapp-flutuante--visivel', window.scrollY > 400);
    }
    window.addEventListener('scroll', avaliar, { passive: true });
    avaliar();
  })();
})();

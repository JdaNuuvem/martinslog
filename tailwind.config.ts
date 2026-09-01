import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Azul-marinho da identidade da Martins Log (martinslog.net), onde ele
         * é a cor que estrutura — cabeçalho, rodapé, faixas — e o vermelho é a
         * cor que age.
         *
         * Aqui a relação se inverte de propósito: `erro` já é vermelho
         * (#B91C1C), e num sistema cheio de formulários pintar os 56
         * preenchimentos de botão de vermelho apagaria a diferença entre
         * "ação principal" e "algo deu errado". O vermelho da marca fica
         * reservado ao logotipo e a destaques pontuais.
         *
         * Todas as razões abaixo superam as da paleta anterior.
         */
        brand: {
          // Preenchimento de botão (texto branco em cima) — 11,05:1 sobre branco.
          DEFAULT: '#1D3A72',
          // Hover do preenchimento — 14,05:1 sobre branco. Escurece em vez de
          // clarear: clarear reduziria o contraste com o texto branco em cima.
          light: '#152A55',
          // Fundo suave de destaque. Texto principal em cima — 14,23:1.
          bg: '#E0E9F7',
          // Texto e links sobre fundo claro — 11,05:1 sobre branco e 10,21:1
          // sobre `superficie.pagina`.
          texto: '#1D3A72',
        },
        /**
         * Superfície escura da navegação e das telas de entrada — o mesmo
         * azul do cabeçalho de martinslog.net.
         *
         * Os valores de `ativo`, `texto` e `borda` são hexadecimais
         * resolvidos, não branco com opacidade: opacidade empilhada sobre
         * fundo escuro muda de resultado conforme o que estiver atrás, e o
         * contraste deixa de ser verificável.
         */
        sidebar: {
          DEFAULT: '#0E1E3C',
          // Fundo do item selecionado. Branco em cima — 12,79:1.
          ativo: '#24324E',
          // Item não selecionado — 7,07:1 sobre `sidebar.DEFAULT`.
          texto: '#A3AAB5',
          // Marcador do item selecionado — 3,90:1 sobre o fundo escuro,
          // acima do mínimo de 3:1 para elemento gráfico.
          marcador: '#E8323C',
          borda: '#1C2B4A',
        },
        alerta: {
          DEFAULT: '#F59E0B',
        },
        // Texto de erro/validação — 6,47:1 sobre branco, 5,98:1 sobre
        // `superficie.pagina`. O red-600 padrão do Tailwind (#DC2626), usado
        // antes de existir este token, ficava em 4,83:1 sobre branco mas só
        // 4,46:1 sobre `superficie.pagina` — reprovado no fundo de página.
        erro: {
          DEFAULT: '#B91C1C',
          // Fundo suave para blocos de erro (ex.: mensagem geral de
          // formulário). Texto `erro.DEFAULT` sobre este fundo — 5,92:1.
          fundo: '#FEF2F2',
        },
        info: {
          bg: '#E8F4FD',
          text: '#1E3A8A',
        },
        texto: {
          principal: '#1A1A1A',
          // 5,98:1 sobre branco, 5,53:1 sobre `superficie.pagina` (a referência
          // original, #6B7280, ficava em 4,47:1 sobre o fundo de página).
          secundario: '#5B6472',
          // Preço riscado / valor secundário em cards — 4,84:1 sobre branco.
          riscado: '#6B7280',
        },
        superficie: {
          pagina: '#F5F6F7',
          card: '#FFFFFF',
          bloco: '#F0F1F2',
        },
        borda: {
          campo: '#CBD5E1',
        },
      },
      /**
       * Escala tipográfica com razão de 1,25 entre passos e altura de linha
       * declarada em cada um.
       *
       * A escala anterior era o padrão do Tailwind usado à mão, e o resultado
       * era hierarquia chapada: 378 usos de `text-sm` (14px) contra 149 de
       * `text-xs` (12px) — dois passos separados por 1,17, perto demais para
       * o olho distinguir. Aqui os passos são poucos e distantes, e o corpo
       * de leitura sobe para 16px.
       *
       * `rotulo` é o único abaixo de 12px permitido, e só para texto em caixa
       * alta e curto (cabeçalho de tabela, chip). Nunca para frase.
       */
      fontSize: {
        rotulo: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        dado: ['0.875rem', { lineHeight: '1.4' }],
        corpo: ['1rem', { lineHeight: '1.6' }],
        subtitulo: ['1.25rem', { lineHeight: '1.4' }],
        titulo: ['1.5625rem', { lineHeight: '1.25' }],
        display: ['1.953rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        /** Campos e botões. */
        campo: '8px',
        /** Cartões e blocos. Teto de 16px: acima disso o cartão vira bolha. */
        cartao: '12px',
        /** Painéis grandes e diálogos. */
        painel: '16px',
        pilula: '9999px',
      },
      /**
       * Uma elevação só, e ela **substitui** a borda — nunca acompanha.
       * Borda fina somada a sombra larga é a marca de quem não decidiu se a
       * superfície tem aresta ou flutua.
       */
      boxShadow: {
        elevado: '0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px -12px rgb(15 23 42 / 0.18)',
        flutuante: '0 12px 40px -12px rgb(15 23 42 / 0.28)',
      },
      maxWidth: {
        conteudo: '760px',
        /** Medida de leitura: acima de ~75 caracteres o olho perde a linha. */
        leitura: '68ch',
      },
      spacing: {
        topbar: '64px',
        sidebar: '240px',
        /**
         * Ritmo vertical. Espaço entre seções é maior que entre itens da
         * mesma seção — é o agrupamento que informa o que pertence a quê,
         * e espaçamento uniforme apaga essa informação.
         */
        secao: '2.5rem',
        bloco: '1.5rem',
      },
    },
  },
  plugins: [],
}

export default config

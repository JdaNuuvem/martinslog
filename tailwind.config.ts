import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Preenchimento de botão (texto branco em cima) — 6,28:1 sobre branco.
          DEFAULT: '#0A6E4A',
          // Hover do preenchimento — 5,15:1 sobre branco.
          light: '#0C7D54',
          bg: '#D6F5E6',
          // Verde para texto/links sobre fundo claro (branco ou cinza de página) —
          // 5,36:1 sobre branco, 4,95:1 sobre `superficie.pagina`. Mais claro que
          // `DEFAULT` seria reprovado nessas duas superfícies (a paleta de
          // referência original, #0E8A5F, ficava em 4,36:1 sobre branco).
          texto: '#0B7A52',
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
      borderRadius: {
        pilula: '9999px',
      },
      maxWidth: {
        conteudo: '760px',
      },
      spacing: {
        topbar: '64px',
        sidebar: '240px',
      },
    },
  },
  plugins: [],
}

export default config

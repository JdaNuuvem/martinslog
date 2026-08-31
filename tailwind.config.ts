import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0E8A5F',
          light: '#12A66F',
          bg: '#D6F5E6',
        },
        alerta: {
          DEFAULT: '#F59E0B',
        },
        info: {
          bg: '#E8F4FD',
          text: '#1E3A8A',
        },
        texto: {
          principal: '#1A1A1A',
          secundario: '#6B7280',
        },
        superficie: {
          pagina: '#F5F6F7',
          card: '#FFFFFF',
          bloco: '#F0F1F2',
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

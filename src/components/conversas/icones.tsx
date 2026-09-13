import type { SVGProps } from 'react'

/**
 * Ícones da caixa de entrada, no mesmo traço de `layout/icones.tsx` (24×24,
 * contorno de 2px). Moram aqui, e não lá, porque só esta tela os usa — a
 * lista do layout é a da navegação.
 */

type IconeProps = SVGProps<SVGSVGElement>

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const IconeClipe = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.3-2.4l7.9-7.9" />
  </svg>
)

export const IconeMicrofone = (p: IconeProps) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

export const IconeEnviar = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M4 12 3 4l18 8-18 8 1-8Zm0 0h8" />
  </svg>
)

export const IconeTelefone = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
)

export const IconeBusca = (p: IconeProps) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const IconeRaio = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
)

export const IconeVoltar = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

export const IconeSincronizar = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5M3 21v-5h5" />
  </svg>
)

export const IconePlay = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M7 4v16l13-8L7 4Z" fill="currentColor" />
  </svg>
)

export const IconePausa = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M8 5v14M16 5v14" />
  </svg>
)

export const IconeDocumento = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </svg>
)

export const IconeCheck = (p: IconeProps) => (
  <svg {...base} viewBox="0 0 24 24" {...p}>
    <path d="m5 12 4 4 10-10" />
  </svg>
)

export const IconeCheckDuplo = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="m2 12 4 4 10-10M12 15l1 1 10-10" />
  </svg>
)

export const IconeRelogio = (p: IconeProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconeLixeira = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)

export const IconeRobo = (p: IconeProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" />
  </svg>
)

export const IconeSetaCima = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="m6 15 6-6 6 6" />
  </svg>
)

export const IconeSetaBaixo = (p: IconeProps) => (
  <svg {...base} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

import type { SVGProps } from 'react'

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

export function IconeCarteira(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <circle cx="17" cy="15" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconeSino(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

export function IconeMenu(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

export function IconeFechar(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconeCalcular(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01" />
    </svg>
  )
}

export function IconeEtiquetas(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20.59 13.41 12 22l-9-9V4h9l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconeRastreio(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="10" r="3" />
      <path d="M12 21s7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 7 11 7 11Z" />
    </svg>
  )
}

export function IconeAjuda(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" />
      <path d="M12 17h.01" />
    </svg>
  )
}

export function IconeIntegracoes(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

export function IconeConvide(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
      <path d="M18 8h4M20 6v4" />
    </svg>
  )
}

export function IconePerfil(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  )
}

export function IconeSalvar(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h11l3 3v15H5V3Z" />
      <path d="M8 3v6h8V3M8 21v-6h8v6" />
    </svg>
  )
}

export function IconeLimpar(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  )
}

export function IconeChevron(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconeSair(props: IconeProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

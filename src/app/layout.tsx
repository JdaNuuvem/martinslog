import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Frete',
  description: 'Plataforma de gestão de fretes',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}

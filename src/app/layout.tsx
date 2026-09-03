import type { Metadata } from 'next'
import './globals.css'
import { Clarity } from '@/components/clarity'

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
      <body>
        {children}
        <Clarity />
      </body>
    </html>
  )
}

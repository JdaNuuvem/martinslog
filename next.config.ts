import type { NextConfig } from 'next'

/**
 * Diretório de build configurável por ambiente.
 *
 * Vários servidores de desenvolvimento rodando sobre o mesmo repositório
 * compartilham `.next` e corrompem o build um do outro: as páginas compilam
 * sem erro no log, mas os chunks do cliente somem e o navegador recebe 404
 * em `_next/static/chunks/...`. Exporte `NEXT_DIST_DIR` para ter o seu.
 * Quem não exportar nada continua em `.next`.
 *
 * Mesmo padrão já adotado em `DATABASE_URL_TEST` e `PLAYWRIGHT_PORT`.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
}

export default nextConfig

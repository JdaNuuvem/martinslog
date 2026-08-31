import { defineConfig, devices } from '@playwright/test'

// Porta configurável por ambiente. Com várias sessões no mesmo repositório,
// a 3100 pode estar ocupada por um dev server alheio — e o caso ruim não é a
// porta ocupada (que falha alto), e sim um servidor de outra sessão
// respondendo ali com código quebrado: o Playwright rodaria contra ele e
// reportaria falhas de aplicação que não existem. Exporte PLAYWRIGHT_PORT
// para ter a sua. Quem não exportar nada continua na 3100.
const PORTA = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const BASE_URL = `http://localhost:${PORTA}`

export default defineConfig({
  testDir: './e2e',
  // Um worker só, de propósito. Os testes compartilham um único banco
  // (`frete_test`) e um único servidor de desenvolvimento: rodando em
  // paralelo, um teste apaga no `afterAll` as linhas que outro ainda está
  // lendo, e a falha aparece longe da causa. Enquanto os testes não tiverem
  // isolamento por transação ou banco por worker, subir este número traz de
  // volta falhas falsas — não "otimize" sem resolver o isolamento antes.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORTA}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgresql://frete:frete@localhost:5433/frete_test',
      SESSION_SECRET: 'x'.repeat(32),
    },
  },
})

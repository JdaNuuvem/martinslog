import { defineConfig, devices } from '@playwright/test'

const PORTA = 3100
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
    command: 'npx next dev -p 3100',
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

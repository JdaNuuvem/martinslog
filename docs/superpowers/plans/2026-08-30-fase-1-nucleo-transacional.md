# Fase 1 — Núcleo Transacional: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o sistema mínimo operável de envio: cotação pública com desconto, carteira pré-paga, emissão de etiqueta PDF, rastreio público e painel administrativo.

**Architecture:** Monolito Next.js (App Router) com domínio puro isolado em `src/domain/` (sem I/O, sem Prisma, sem Next). Toda dependência externa — transportadora, pagamento, geolocalização — fica atrás de uma interface em `src/infra/`, com implementação simulada nesta fase. Dinheiro sempre em centavos inteiros. O checkout é uma transação Postgres com lock pessimista na carteira.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Prisma 6, PostgreSQL 16, Zod, Tailwind, Vitest, Playwright, `@node-rs/argon2`, `pdf-lib`, `bwip-js`, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-30-plataforma-frete-design.md`

## Global Constraints

- Node 22 LTS. pnpm como gerenciador de pacotes.
- TypeScript `strict: true`. Sem `any` fora de testes.
- `src/domain/` NUNCA importa `@prisma/client`, `next/*` ou qualquer I/O. Regra verificada por lint.
- Dinheiro sempre em **centavos, inteiro**. Nomear campos com sufixo `Centavos`. Nunca `float` para dinheiro.
- Peso sempre em **gramas, inteiro**. Nomear campos com sufixo `G`.
- CEP armazenado normalizado: 8 dígitos, sem hífen.
- Toda entrada externa validada com Zod na borda (route handler / server action).
- Erros de domínio são classes tipadas que herdam de `DomainError`. Nunca lançar string. Nunca engolir erro.
- Cobertura mínima 80%. Nenhuma tarefa termina com teste vermelho.
- Mensagens de interface em português do Brasil, com acentuação correta.
- Commits em conventional commits, em português.

---

### Task 1: Bootstrap do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`, `src/env.ts`, `docker-compose.yml`
- Test: `src/env.test.ts`

**Interfaces:**
- Produces: `env` — objeto validado com `DATABASE_URL: string`, `SESSION_SECRET: string`, `NODE_ENV: 'development'|'test'|'production'`.

- [ ] **Step 1: Criar o projeto e instalar dependências**

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --no-import-alias
pnpm add zod @prisma/client @node-rs/argon2 pdf-lib bwip-js
pnpm add -D prisma vitest @vitest/coverage-v8 @playwright/test tsx
```

- [ ] **Step 2: Subir o Postgres local**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: frete
      POSTGRES_PASSWORD: frete
      POSTGRES_DB: frete
    ports: ["5432:5432"]
  db_test:
    image: postgres:16
    environment:
      POSTGRES_USER: frete
      POSTGRES_PASSWORD: frete
      POSTGRES_DB: frete_test
    ports: ["5433:5432"]
```

Run: `docker compose up -d`

- [ ] **Step 3: Escrever o teste do env**

`src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('aceita ambiente válido', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
      SESSION_SECRET: 'x'.repeat(32),
      NODE_ENV: 'test',
    })
    expect(env.NODE_ENV).toBe('test')
  })

  it('rejeita SESSION_SECRET curto', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
        SESSION_SECRET: 'curto',
        NODE_ENV: 'test',
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `pnpm vitest run src/env.test.ts`
Expected: FAIL — `parseEnv` não existe.

- [ ] **Step 5: Implementar**

`src/env.ts`:

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw)
}

export const env = parseEnv(process.env)
```

- [ ] **Step 6: Proibir I/O no domínio via lint**

Adicionar a `eslint.config.mjs`:

```js
{
  files: ['src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: ['@prisma/client', 'next/*', 'next', 'fs', 'node:*', '@/infra/*'],
    }],
  },
}
```

- [ ] **Step 7: Rodar testes e lint**

Run: `pnpm vitest run && pnpm lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: bootstrap do projeto com Next, Prisma, Vitest e env validado"
```

---

### Task 2: Domínio de cubagem

**Files:**
- Create: `src/domain/pricing/cubagem.ts`
- Test: `src/domain/pricing/cubagem.test.ts`

**Interfaces:**
- Produces:
  - `calcularPesoCubadoG(d: Dimensoes): number` — `Dimensoes = { alturaCm: number; larguraCm: number; comprimentoCm: number }`
  - `calcularPesoTaxavelG(pesoRealG: number, pesoCubadoG: number): number`
  - `DimensoesInvalidasError extends DomainError`

- [ ] **Step 1: Escrever os testes**

`src/domain/pricing/cubagem.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularPesoCubadoG, calcularPesoTaxavelG, DimensoesInvalidasError } from './cubagem'

describe('calcularPesoCubadoG', () => {
  it('usa o divisor 6000 e devolve gramas inteiras', () => {
    // 4 x 12 x 18 = 864 cm3 -> 864/6000 = 0,144 kg -> 144 g
    expect(calcularPesoCubadoG({ alturaCm: 4, larguraCm: 12, comprimentoCm: 18 })).toBe(144)
  })

  it('arredonda para cima', () => {
    // 10 x 10 x 10 = 1000 -> 1000/6000 = 0,1666... kg -> 167 g
    expect(calcularPesoCubadoG({ alturaCm: 10, larguraCm: 10, comprimentoCm: 10 })).toBe(167)
  })

  it('rejeita dimensão zero ou negativa', () => {
    expect(() => calcularPesoCubadoG({ alturaCm: 0, larguraCm: 10, comprimentoCm: 10 }))
      .toThrow(DimensoesInvalidasError)
    expect(() => calcularPesoCubadoG({ alturaCm: -1, larguraCm: 10, comprimentoCm: 10 }))
      .toThrow(DimensoesInvalidasError)
  })
})

describe('calcularPesoTaxavelG', () => {
  it('cobra o maior entre real e cubado', () => {
    expect(calcularPesoTaxavelG(300, 144)).toBe(300)
    expect(calcularPesoTaxavelG(100, 144)).toBe(144)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/domain/pricing/cubagem.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar a base de erros de domínio**

`src/domain/errors.ts`:

```ts
export abstract class DomainError extends Error {
  abstract readonly codigo: string
  constructor(mensagem: string) {
    super(mensagem)
    this.name = new.target.name
  }
}

export class DimensoesInvalidasError extends DomainError {
  readonly codigo = 'DIMENSOES_INVALIDAS'
}
export class PesoInvalidoError extends DomainError {
  readonly codigo = 'PESO_INVALIDO'
}
export class RotaNaoAtendidaError extends DomainError {
  readonly codigo = 'ROTA_NAO_ATENDIDA'
}
export class CepInvalidoError extends DomainError {
  readonly codigo = 'CEP_INVALIDO'
}
export class SaldoInsuficienteError extends DomainError {
  readonly codigo = 'SALDO_INSUFICIENTE'
}
export class TransicaoInvalidaError extends DomainError {
  readonly codigo = 'TRANSICAO_INVALIDA'
}
export class CotacaoExpiradaError extends DomainError {
  readonly codigo = 'COTACAO_EXPIRADA'
}
export class CancelamentoNaoPermitidoError extends DomainError {
  readonly codigo = 'CANCELAMENTO_NAO_PERMITIDO'
}
```

- [ ] **Step 4: Implementar a cubagem**

`src/domain/pricing/cubagem.ts`:

```ts
import { DimensoesInvalidasError } from '../errors'

export type Dimensoes = { alturaCm: number; larguraCm: number; comprimentoCm: number }

const DIVISOR_CUBAGEM = 6000

export function calcularPesoCubadoG({ alturaCm, larguraCm, comprimentoCm }: Dimensoes): number {
  for (const valor of [alturaCm, larguraCm, comprimentoCm]) {
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new DimensoesInvalidasError('Altura, largura e comprimento devem ser maiores que zero.')
    }
  }
  const volumeCm3 = alturaCm * larguraCm * comprimentoCm
  return Math.ceil((volumeCm3 / DIVISOR_CUBAGEM) * 1000)
}

export function calcularPesoTaxavelG(pesoRealG: number, pesoCubadoG: number): number {
  return Math.max(pesoRealG, pesoCubadoG)
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm vitest run src/domain/pricing/cubagem.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domain
git commit -m "feat: cálculo de peso cubado e peso taxável"
```

---

### Task 3: Domínio de seleção de tarifa

**Files:**
- Create: `src/domain/pricing/cep.ts`, `src/domain/pricing/tarifa.ts`
- Test: `src/domain/pricing/cep.test.ts`, `src/domain/pricing/tarifa.test.ts`

**Interfaces:**
- Consumes: `calcularPesoTaxavelG` (Task 2), `RotaNaoAtendidaError`, `CepInvalidoError` (Task 2).
- Produces:
  - `normalizarCep(entrada: string): string` — 8 dígitos
  - `cepParaNumero(cep: string): number`
  - `RegraTarifa = { serviceId: string; cepOrigemIni: number; cepOrigemFim: number; cepDestinoIni: number; cepDestinoFim: number; pesoMinG: number; pesoMaxG: number; precoBalcaoCentavos: number; precoVendaCentavos: number; prazoDias: number }`
  - `selecionarRegra(regras: RegraTarifa[], criterio: CriterioTarifa): RegraTarifa | null`
  - `montarOpcao(regra: RegraTarifa): OpcaoPreco` — `{ precoBalcaoCentavos, precoFinalCentavos, descontoCentavos, descontoPercentual, prazoDias }`

- [ ] **Step 1: Escrever os testes de CEP**

`src/domain/pricing/cep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cepParaNumero, normalizarCep } from './cep'
import { CepInvalidoError } from '../errors'

describe('normalizarCep', () => {
  it('remove hífen e espaços', () => {
    expect(normalizarCep('01001-000')).toBe('01001000')
    expect(normalizarCep(' 01001000 ')).toBe('01001000')
  })

  it('rejeita CEP com tamanho errado', () => {
    expect(() => normalizarCep('123')).toThrow(CepInvalidoError)
    expect(() => normalizarCep('010010000')).toThrow(CepInvalidoError)
  })

  it('rejeita CEP com letra', () => {
    expect(() => normalizarCep('0100100A')).toThrow(CepInvalidoError)
  })
})

describe('cepParaNumero', () => {
  it('preserva a ordem numérica com zeros à esquerda', () => {
    expect(cepParaNumero('01001000')).toBe(1001000)
    expect(cepParaNumero('20040002')).toBe(20040002)
    expect(cepParaNumero('01001000') < cepParaNumero('20040002')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/domain/pricing/cep.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar CEP**

`src/domain/pricing/cep.ts`:

```ts
import { CepInvalidoError } from '../errors'

export function normalizarCep(entrada: string): string {
  const limpo = entrada.replace(/\D/g, '')
  if (limpo.length !== 8) {
    throw new CepInvalidoError(`CEP inválido: ${entrada}`)
  }
  return limpo
}

export function cepParaNumero(cep: string): number {
  return Number(normalizarCep(cep))
}
```

- [ ] **Step 4: Escrever os testes de tarifa**

`src/domain/pricing/tarifa.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { montarOpcao, selecionarRegra, type RegraTarifa } from './tarifa'

const regraSpRj: RegraTarifa = {
  serviceId: 'pac',
  cepOrigemIni: 1000000, cepOrigemFim: 19999999,
  cepDestinoIni: 20000000, cepDestinoFim: 28999999,
  pesoMinG: 0, pesoMaxG: 300,
  precoBalcaoCentavos: 2750, precoVendaCentavos: 1416, prazoDias: 5,
}

const regraSpRjPesada: RegraTarifa = {
  ...regraSpRj, pesoMinG: 301, pesoMaxG: 1000,
  precoBalcaoCentavos: 3500, precoVendaCentavos: 1900,
}

describe('selecionarRegra', () => {
  const regras = [regraSpRj, regraSpRjPesada]

  it('escolhe a regra da faixa de peso correta', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 300 })
    expect(r).toBe(regraSpRj)
  })

  it('escolhe a faixa seguinte quando o peso ultrapassa', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 301 })
    expect(r).toBe(regraSpRjPesada)
  })

  it('devolve null quando a rota não é atendida', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '90000000', pesoTaxavelG: 300 })
    expect(r).toBeNull()
  })

  it('devolve null quando o peso excede todas as faixas', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 5000 })
    expect(r).toBeNull()
  })

  it('escolhe a regra mais barata quando duas cobrem o mesmo caso', () => {
    const maisBarata: RegraTarifa = { ...regraSpRj, serviceId: 'promo', precoVendaCentavos: 1200 }
    const r = selecionarRegra([regraSpRj, maisBarata], {
      cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 300,
    })
    expect(r).toBe(maisBarata)
  })
})

describe('montarOpcao', () => {
  it('calcula desconto em valor e percentual', () => {
    const opcao = montarOpcao(regraSpRj)
    expect(opcao.precoFinalCentavos).toBe(1416)
    expect(opcao.descontoCentavos).toBe(1334)
    expect(opcao.descontoPercentual).toBe(49) // 1334/2750 = 48,5% -> 49
  })

  it('não gera desconto negativo quando a venda é mais cara que o balcão', () => {
    const opcao = montarOpcao({ ...regraSpRj, precoVendaCentavos: 3000 })
    expect(opcao.descontoCentavos).toBe(0)
    expect(opcao.descontoPercentual).toBe(0)
  })
})
```

- [ ] **Step 5: Rodar e confirmar que falha**

Run: `pnpm vitest run src/domain/pricing/tarifa.test.ts`
Expected: FAIL

- [ ] **Step 6: Implementar tarifa**

`src/domain/pricing/tarifa.ts`:

```ts
import { cepParaNumero } from './cep'

export type RegraTarifa = {
  serviceId: string
  cepOrigemIni: number
  cepOrigemFim: number
  cepDestinoIni: number
  cepDestinoFim: number
  pesoMinG: number
  pesoMaxG: number
  precoBalcaoCentavos: number
  precoVendaCentavos: number
  prazoDias: number
}

export type CriterioTarifa = { cepOrigem: string; cepDestino: string; pesoTaxavelG: number }

export type OpcaoPreco = {
  precoBalcaoCentavos: number
  precoFinalCentavos: number
  descontoCentavos: number
  descontoPercentual: number
  prazoDias: number
}

export function selecionarRegra(regras: RegraTarifa[], criterio: CriterioTarifa): RegraTarifa | null {
  const origem = cepParaNumero(criterio.cepOrigem)
  const destino = cepParaNumero(criterio.cepDestino)

  const candidatas = regras.filter(
    (r) =>
      origem >= r.cepOrigemIni && origem <= r.cepOrigemFim &&
      destino >= r.cepDestinoIni && destino <= r.cepDestinoFim &&
      criterio.pesoTaxavelG >= r.pesoMinG && criterio.pesoTaxavelG <= r.pesoMaxG,
  )

  if (candidatas.length === 0) return null

  return candidatas.reduce((melhor, atual) =>
    atual.precoVendaCentavos < melhor.precoVendaCentavos ? atual : melhor,
  )
}

export function montarOpcao(regra: RegraTarifa): OpcaoPreco {
  const desconto = Math.max(0, regra.precoBalcaoCentavos - regra.precoVendaCentavos)
  const percentual = regra.precoBalcaoCentavos === 0
    ? 0
    : Math.round((desconto / regra.precoBalcaoCentavos) * 100)

  return {
    precoBalcaoCentavos: regra.precoBalcaoCentavos,
    precoFinalCentavos: regra.precoVendaCentavos,
    descontoCentavos: desconto,
    descontoPercentual: percentual,
    prazoDias: regra.prazoDias,
  }
}
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `pnpm vitest run src/domain/pricing`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/domain
git commit -m "feat: seleção de regra de tarifa por faixa de CEP e peso"
```

---

### Task 4: Schema do banco e seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/infra/db/client.ts`
- Test: `src/infra/db/client.test.ts`

**Interfaces:**
- Produces: `prisma` — instância singleton de `PrismaClient`.
- Modelos desta fase: `User`, `Session`, `AnonSession`, `Address`, `Carrier`, `Service`, `PriceRule`, `Quote`, `Shipment`, `Wallet`, `LedgerEntry`, `PaymentIntent`, `TrackingEvent`, `AuditLog`. Campos conforme a seção 4 do spec, restrito aos modelos da Fase 1.

- [ ] **Step 1: Escrever o schema**

Traduzir a seção 4 do spec para `prisma/schema.prisma`. Pontos obrigatórios:
- `Shipment.codigoRastreio String? @unique` — nulo até `GENERATED`.
- `LedgerEntry` sem `updatedAt` — é append-only.
- Todos os valores monetários `Int` com sufixo `Centavos`.
- Índices: `PriceRule` em `(serviceId, cepOrigemIni, cepDestinoIni, pesoMinG)`; `Shipment` em `(userId, status)`; `LedgerEntry` em `(walletId, criadoEm)`.
- Enums: `StatusShipment { PENDING RELEASED GENERATED POSTED DELIVERED CANCELLED LOST }`, `TipoLedger { CREDITO DEBITO }`, `TipoUser { PF PJ }`, `PapelUser { CLIENTE ADMIN }`.

- [ ] **Step 2: Gerar e aplicar a migration**

```bash
pnpm prisma migrate dev --name inicial
pnpm prisma generate
```

- [ ] **Step 3: Escrever o seed**

`prisma/seed.ts` deve criar:
- 1 `Carrier` "Transportadora Própria" e 3 `Service`: Econômico (prazo 5), Rápido (prazo 2), Expresso (prazo 1).
- `PriceRule` cobrindo as 5 macrorregiões cruzadas (Norte, Nordeste, Centro-Oeste, Sudeste, Sul) por faixas de peso de 300g, 1kg, 2kg, 5kg, 10kg, 30kg — com `precoBalcaoCentavos` na ordem de grandeza da tabela pública dos Correios e `precoVendaCentavos` entre 40% e 60% dela.
- 1 usuário admin e 1 usuário cliente de teste, cada um com `Wallet` (admin saldo 0, cliente saldo R$ 100,00 em centavos, com o `LedgerEntry` de crédito correspondente).

- [ ] **Step 4: Rodar o seed e verificar**

```bash
pnpm prisma db seed
pnpm prisma studio   # conferência visual, opcional
```

Expected: sem erro; `PriceRule` com pelo menos 150 linhas.

- [ ] **Step 5: Commit**

```bash
git add prisma src/infra
git commit -m "feat: schema do banco e seed de tarifas por região"
```

---

### Task 5: Provedor de geolocalização de CEP

**Files:**
- Create: `src/infra/geo/provider.ts`, `src/infra/geo/viacep.ts`, `src/infra/geo/fake.ts`
- Test: `src/infra/geo/viacep.test.ts`

**Interfaces:**
- Produces:
  - `type EnderecoCep = { cep: string; logradouro: string; bairro: string; cidade: string; uf: string }`
  - `interface GeoProvider { buscarPorCep(cep: string): Promise<EnderecoCep> }`
  - `ViaCepProvider implements GeoProvider`
  - `FakeGeoProvider implements GeoProvider` — para testes e E2E, sem rede.

- [ ] **Step 1: Escrever o teste com `fetch` mockado**

`src/infra/geo/viacep.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ViaCepProvider } from './viacep'
import { CepInvalidoError } from '@/domain/errors'

describe('ViaCepProvider', () => {
  it('mapeia a resposta do ViaCEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé',
        localidade: 'São Paulo', uf: 'SP',
      }),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    const endereco = await provider.buscarPorCep('01001-000')
    expect(endereco).toEqual({
      cep: '01001000', logradouro: 'Praça da Sé', bairro: 'Sé',
      cidade: 'São Paulo', uf: 'SP',
    })
  })

  it('lança CepInvalidoError quando o ViaCEP responde erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('99999999')).rejects.toThrow(CepInvalidoError)
  })

  it('lança CepInvalidoError quando a rede falha', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(CepInvalidoError)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/infra/geo`
Expected: FAIL

- [ ] **Step 3: Implementar**

`src/infra/geo/provider.ts` com os tipos e a interface; `src/infra/geo/viacep.ts` com a classe recebendo `fetch` por injeção (default `globalThis.fetch`), normalizando o CEP com `normalizarCep` e convertendo qualquer falha em `CepInvalidoError`; `src/infra/geo/fake.ts` devolvendo um endereço fixo determinístico.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/infra/geo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infra/geo
git commit -m "feat: provedor de endereço por CEP com ViaCEP"
```

---

### Task 6: Serviço de cotação e rota pública

**Files:**
- Create: `src/domain/pricing/cotacao.ts`, `src/app/api/cotacao/route.ts`, `src/server/cotacao-service.ts`
- Test: `src/domain/pricing/cotacao.test.ts`, `src/app/api/cotacao/route.test.ts`

**Interfaces:**
- Consumes: `calcularPesoCubadoG`, `calcularPesoTaxavelG` (Task 2); `selecionarRegra`, `montarOpcao`, `RegraTarifa` (Task 3); `prisma` (Task 4); `GeoProvider` (Task 5).
- Produces:
  - `cotar(entrada: EntradaCotacao, catalogo: ItemCatalogo[]): ResultadoCotacao` — função pura.
  - `ItemCatalogo = { servico: { id: string; nome: string; carrierNome: string; limitePesoG: number }; regras: RegraTarifa[] }`
  - `ResultadoCotacao = { pesoCubadoG: number; pesoTaxavelG: number; opcoes: OpcaoCotacao[] }`
  - `OpcaoCotacao = OpcaoPreco & { servicoId: string; servicoNome: string; carrierNome: string; disponivel: boolean; observacao: string | null }`
  - `POST /api/cotacao` — público, sem autenticação.

- [ ] **Step 1: Escrever os testes do domínio de cotação**

`src/domain/pricing/cotacao.test.ts` deve cobrir:
- ordena as opções da mais barata para a mais cara;
- serviço cuja regra não cobre a rota sai com `disponivel: false` e `observacao` explicando, **sem sumir da lista** (requisito 5.1.6 do spec);
- serviço com `limitePesoG` menor que o peso taxável sai com `disponivel: false` e observação citando o limite;
- `pesoTaxavelG` reflete a cubagem quando o volume manda.

```ts
import { describe, expect, it } from 'vitest'
import { cotar } from './cotacao'

const catalogo = [
  {
    servico: { id: 'eco', nome: 'Econômico', carrierNome: 'Própria', limitePesoG: 30000 },
    regras: [{
      serviceId: 'eco',
      cepOrigemIni: 1000000, cepOrigemFim: 19999999,
      cepDestinoIni: 20000000, cepDestinoFim: 28999999,
      pesoMinG: 0, pesoMaxG: 300,
      precoBalcaoCentavos: 2750, precoVendaCentavos: 1416, prazoDias: 5,
    }],
  },
  {
    servico: { id: 'mini', nome: 'Mini', carrierNome: 'Própria', limitePesoG: 300 },
    regras: [{
      serviceId: 'mini',
      cepOrigemIni: 1000000, cepOrigemFim: 19999999,
      cepDestinoIni: 20000000, cepDestinoFim: 28999999,
      pesoMinG: 0, pesoMaxG: 300,
      precoBalcaoCentavos: 2750, precoVendaCentavos: 943, prazoDias: 5,
    }],
  },
]

const entrada = {
  cepOrigem: '01001000', cepDestino: '20040002',
  pesoRealG: 300, alturaCm: 4, larguraCm: 12, comprimentoCm: 18,
}

describe('cotar', () => {
  it('ordena da opção mais barata para a mais cara', () => {
    const r = cotar(entrada, catalogo)
    expect(r.opcoes.map((o) => o.servicoId)).toEqual(['mini', 'eco'])
  })

  it('calcula o peso taxável', () => {
    const r = cotar(entrada, catalogo)
    expect(r.pesoCubadoG).toBe(144)
    expect(r.pesoTaxavelG).toBe(300)
  })

  it('mantém na lista o serviço que excede o limite, marcado como indisponível', () => {
    const r = cotar({ ...entrada, pesoRealG: 500 }, catalogo)
    const mini = r.opcoes.find((o) => o.servicoId === 'mini')!
    expect(mini.disponivel).toBe(false)
    expect(mini.observacao).toContain('300')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/domain/pricing/cotacao.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `cotar`**

Função pura em `src/domain/pricing/cotacao.ts`: calcula cubagem, peso taxável, e para cada item do catálogo tenta `selecionarRegra`. Sem regra ou acima do `limitePesoG`, devolve a opção com `disponivel: false` e observação em português. Opções disponíveis vêm primeiro, ordenadas por `precoFinalCentavos`; indisponíveis por último.

- [ ] **Step 4: Implementar o serviço e a rota**

`src/server/cotacao-service.ts` carrega o catálogo do banco (serviços ativos e suas `PriceRule` vigentes), chama `cotar`, persiste a `Quote` com `expiraEm = agora + 24h`, vinculando a `userId` quando houver sessão ou criando/reaproveitando uma `AnonSession` em cookie.

`src/app/api/cotacao/route.ts` valida com Zod:

```ts
const schema = z.object({
  cepOrigem: z.string(),
  cepDestino: z.string(),
  formato: z.enum(['CAIXA', 'ROLO', 'ENVELOPE']).default('CAIXA'),
  pesoG: z.number().int().positive().max(30000),
  alturaCm: z.number().positive(),
  larguraCm: z.number().positive(),
  comprimentoCm: z.number().positive(),
})
```

Mapeia `DomainError` para HTTP 422 com `{ codigo, mensagem }`; erro inesperado vira 500 com log estruturado e mensagem genérica.

- [ ] **Step 5: Escrever o teste de integração da rota**

`src/app/api/cotacao/route.test.ts`: banco de teste semeado, POST válido devolve 200 com `opcoes.length > 0`; CEP inválido devolve 422 com `codigo: 'CEP_INVALIDO'`; corpo malformado devolve 400.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: cotação pública com desconto e persistência de cotação"
```

---

### Task 7: Interface da calculadora

**Files:**
- Create: `src/app/(publico)/page.tsx`, `src/components/calculadora-form.tsx`, `src/components/opcao-frete-card.tsx`
- Test: `e2e/cotacao.spec.ts`

**Interfaces:**
- Consumes: `POST /api/cotacao` (Task 6).

- [ ] **Step 1: Construir o formulário**

Campos, espelhando a interface analisada do SuperFrete: CEP de origem, Formato (Caixa/Pacote, Rolo, Envelope), Peso, Altura, Largura, Comprimento, CEP de destino. O campo de peso é um `select` de faixas — "Até 300g", "Até 1Kg", "Até 2Kg" … "Até 30Kg" — mais a opção "Digitar peso" que revela um campo numérico. Valida no cliente com o mesmo schema Zod do servidor.

- [ ] **Step 2: Construir o card de resultado**

Cada opção mostra: nome do serviço, transportadora, prazo em dias úteis, **preço de balcão riscado**, preço final em destaque e selo com o percentual de desconto. Opção indisponível aparece esmaecida com a observação, sem botão de ação. Esse contraste entre os dois preços é o produto — não é decoração.

- [ ] **Step 3: Escrever o teste E2E**

`e2e/cotacao.spec.ts`: preencher 01001-000 → 20040-002, 300g, 4×12×18, submeter, e afirmar que aparece ao menos uma opção com preço final menor que o preço de balcão.

- [ ] **Step 4: Rodar o E2E**

Run: `pnpm playwright test e2e/cotacao.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src e2e
git commit -m "feat: interface da calculadora de frete"
```

---

### Task 8: Autenticação

**Files:**
- Create: `src/domain/auth/documento.ts`, `src/server/auth/senha.ts`, `src/server/auth/sessao.ts`, `src/app/(auth)/cadastro/page.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/api/auth/[...rota]/route.ts`
- Test: `src/domain/auth/documento.test.ts`, `src/server/auth/sessao.test.ts`

**Interfaces:**
- Produces:
  - `validarCpf(cpf: string): boolean` — dígito verificador
  - `validarCnpj(cnpj: string): boolean`
  - `normalizarDocumento(doc: string): string`
  - `hashSenha(senha: string): Promise<string>`, `verificarSenha(hash: string, senha: string): Promise<boolean>`
  - `criarSessao(userId: string): Promise<string>`, `lerSessao(): Promise<{ userId: string; papel: PapelUser } | null>`, `encerrarSessao(): Promise<void>`

- [ ] **Step 1: Escrever os testes de documento**

Incluir CPFs válidos reais de teste (`52998224725`, `11144477735`), CPFs de dígito repetido (`11111111111`) que devem ser rejeitados, e CPF com dígito verificador errado.

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

Run: `pnpm vitest run src/domain/auth`

- [ ] **Step 3: Implementar senha e sessão**

`hashSenha` usa `argon2id` via `@node-rs/argon2`. `criarSessao` grava `Session` com expiração de 30 dias e escreve cookie `httpOnly`, `Secure` em produção, `SameSite=Lax`. `lerSessao` valida a expiração no banco a cada leitura — não confia apenas no cookie.

- [ ] **Step 4: Construir cadastro e login**

Cadastro: nome, CPF/CNPJ, e-mail, telefone, senha. Cria `User` e `Wallet` com saldo zero **na mesma transação**. Se houver `AnonSession` em cookie, migra as `Quote` dela para o novo usuário.

Login com rate limit por IP e por e-mail: 5 tentativas em 15 minutos. Mensagem de erro idêntica para e-mail inexistente e senha errada — não revelar qual dos dois falhou.

- [ ] **Step 5: Escrever o teste de integração**

Cadastro cria usuário com carteira zerada; e-mail duplicado devolve 409; login correto devolve cookie de sessão; senha errada devolve 401; 6ª tentativa devolve 429.

- [ ] **Step 6: Rodar tudo e commitar**

```bash
pnpm vitest run
git add src && git commit -m "feat: cadastro, login e sessão com argon2"
```

---

### Task 9: Endereços

**Files:**
- Create: `src/app/(app)/enderecos/page.tsx`, `src/app/api/enderecos/route.ts`, `src/app/api/enderecos/[id]/route.ts`
- Test: `src/app/api/enderecos/route.test.ts`

**Interfaces:**
- Consumes: `lerSessao` (Task 8), `GeoProvider` (Task 5).

- [ ] **Step 1: Escrever os testes**

Criar endereço preenche cidade/UF a partir do CEP; marcar um endereço como padrão desmarca o anterior do mesmo tipo, na mesma transação; usuário A recebe 404 ao tentar ler ou editar endereço do usuário B (autorização por dono verificada no servidor).

- [ ] **Step 2: Rodar e confirmar que falha; implementar CRUD; rodar e confirmar que passa**

- [ ] **Step 3: Construir a interface**

Lista de endereços separada em Remetentes e Destinatários, com formulário que busca o CEP e preenche os campos automaticamente.

- [ ] **Step 4: Commit**

```bash
git add src && git commit -m "feat: cadastro de endereços de remetente e destinatário"
```

---

### Task 10: Domínio da carteira

**Files:**
- Create: `src/domain/wallet/ledger.ts`
- Test: `src/domain/wallet/ledger.test.ts`

**Interfaces:**
- Produces:
  - `aplicarCredito(saldoAtualCentavos: number, valorCentavos: number): LancamentoCalculado`
  - `aplicarDebito(saldoAtualCentavos: number, valorCentavos: number): LancamentoCalculado`
  - `LancamentoCalculado = { tipo: 'CREDITO' | 'DEBITO'; valorCentavos: number; saldoAposCentavos: number }`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from 'vitest'
import { aplicarCredito, aplicarDebito } from './ledger'
import { SaldoInsuficienteError } from '../errors'

describe('aplicarDebito', () => {
  it('reduz o saldo', () => {
    expect(aplicarDebito(10000, 1416)).toEqual({
      tipo: 'DEBITO', valorCentavos: 1416, saldoAposCentavos: 8584,
    })
  })

  it('permite zerar o saldo exatamente', () => {
    expect(aplicarDebito(1416, 1416).saldoAposCentavos).toBe(0)
  })

  it('recusa débito maior que o saldo', () => {
    expect(() => aplicarDebito(1000, 1416)).toThrow(SaldoInsuficienteError)
  })

  it('recusa valor zero ou negativo', () => {
    expect(() => aplicarDebito(1000, 0)).toThrow()
    expect(() => aplicarDebito(1000, -5)).toThrow()
  })

  it('recusa valor não inteiro', () => {
    expect(() => aplicarDebito(1000, 14.16)).toThrow()
  })
})

describe('aplicarCredito', () => {
  it('aumenta o saldo', () => {
    expect(aplicarCredito(0, 10000).saldoAposCentavos).toBe(10000)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

Run: `pnpm vitest run src/domain/wallet`

- [ ] **Step 3: Commit**

```bash
git add src/domain/wallet && git commit -m "feat: regras de crédito e débito da carteira"
```

---

### Task 11: Recarga simulada e extrato

**Files:**
- Create: `src/infra/payments/provider.ts`, `src/infra/payments/simulado.ts`, `src/server/wallet-service.ts`, `src/app/(app)/carteira/page.tsx`, `src/app/api/carteira/recarga/route.ts`
- Test: `src/server/wallet-service.test.ts`

**Interfaces:**
- Consumes: `aplicarCredito` (Task 10), `prisma` (Task 4).
- Produces:
  - `interface PaymentProvider { criarCobranca(valorCentavos: number): Promise<{ id: string; qrCode: string; expiraEm: Date }> }`
  - `SimulatedPixProvider implements PaymentProvider` — QR falso, confirmação manual pelo admin.
  - `creditarCarteira(userId: string, valorCentavos: number, ref: { tipo: string; id: string }, descricao: string): Promise<void>` — atômica.

- [ ] **Step 1: Escrever o teste**

`creditarCarteira` grava `LedgerEntry` e atualiza `Wallet.saldoCentavos` na mesma transação, com `saldoAposCentavos` coerente. Creditar duas vezes o mesmo `PaymentIntent` já confirmado **não** duplica o saldo (idempotência por `refTipo` + `refId` com índice único).

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

- [ ] **Step 3: Construir a interface da carteira**

Saldo em destaque, botão "Adicionar saldo" com valores sugeridos (R$ 20, R$ 50, R$ 100) e valor livre, tela de QR Pix simulado com aviso claro de que é ambiente de teste, e extrato paginado mostrando data, descrição, valor e saldo após.

- [ ] **Step 4: Commit**

```bash
git add src && git commit -m "feat: carteira com recarga simulada e extrato"
```

---

### Task 12: Máquina de estados do envio

**Files:**
- Create: `src/domain/shipment/estados.ts`
- Test: `src/domain/shipment/estados.test.ts`

**Interfaces:**
- Produces:
  - `type StatusShipment = 'PENDING'|'RELEASED'|'GENERATED'|'POSTED'|'DELIVERED'|'CANCELLED'|'LOST'`
  - `transicoesValidas: Readonly<Record<StatusShipment, readonly StatusShipment[]>>`
  - `garantirTransicao(de: StatusShipment, para: StatusShipment): void` — lança `TransicaoInvalidaError`
  - `podeCancelar(status: StatusShipment): boolean`
  - `deveEstornar(de: StatusShipment, para: StatusShipment): boolean`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from 'vitest'
import { deveEstornar, garantirTransicao, podeCancelar } from './estados'
import { TransicaoInvalidaError } from '../errors'

describe('garantirTransicao', () => {
  it('aceita o caminho feliz', () => {
    expect(() => garantirTransicao('PENDING', 'RELEASED')).not.toThrow()
    expect(() => garantirTransicao('RELEASED', 'GENERATED')).not.toThrow()
    expect(() => garantirTransicao('GENERATED', 'POSTED')).not.toThrow()
    expect(() => garantirTransicao('POSTED', 'DELIVERED')).not.toThrow()
  })

  it('recusa pular etapas', () => {
    expect(() => garantirTransicao('PENDING', 'DELIVERED')).toThrow(TransicaoInvalidaError)
  })

  it('recusa sair de estado terminal', () => {
    expect(() => garantirTransicao('DELIVERED', 'POSTED')).toThrow(TransicaoInvalidaError)
    expect(() => garantirTransicao('CANCELLED', 'RELEASED')).toThrow(TransicaoInvalidaError)
  })
})

describe('podeCancelar', () => {
  it('permite até GENERATED e proíbe a partir de POSTED', () => {
    expect(podeCancelar('PENDING')).toBe(true)
    expect(podeCancelar('RELEASED')).toBe(true)
    expect(podeCancelar('GENERATED')).toBe(true)
    expect(podeCancelar('POSTED')).toBe(false)
    expect(podeCancelar('DELIVERED')).toBe(false)
  })
})

describe('deveEstornar', () => {
  it('estorna quando o envio pago é cancelado ou extraviado', () => {
    expect(deveEstornar('RELEASED', 'CANCELLED')).toBe(true)
    expect(deveEstornar('POSTED', 'LOST')).toBe(true)
  })

  it('não estorna quando o envio nunca foi pago', () => {
    expect(deveEstornar('PENDING', 'CANCELLED')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

- [ ] **Step 3: Commit**

```bash
git add src/domain/shipment && git commit -m "feat: máquina de estados do envio"
```

---

### Task 13: Criação de envio e pagamento transacional

**Files:**
- Create: `src/server/shipment-service.ts`, `src/app/api/envios/route.ts`, `src/app/(app)/envios/novo/page.tsx`
- Test: `src/server/shipment-service.test.ts`

**Interfaces:**
- Consumes: `aplicarDebito` (Task 10), `garantirTransicao` (Task 12), `prisma` (Task 4), `Quote` (Task 6).
- Produces:
  - `criarEnvio(userId: string, entrada: EntradaEnvio): Promise<{ id: string }>` — cria em `PENDING`.
  - `pagarEnvio(userId: string, shipmentId: string): Promise<void>` — debita e move para `RELEASED`.

**Esta é a tarefa mais crítica da fase. O teste de concorrência não é opcional.**

- [ ] **Step 1: Escrever o teste de concorrência**

```ts
import { describe, expect, it } from 'vitest'
import { criarEnvio, pagarEnvio } from './shipment-service'
import { prisma } from '@/infra/db/client'
import { SaldoInsuficienteError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'

describe('pagarEnvio sob concorrência', () => {
  it('nunca deixa o saldo negativo com dois pagamentos simultâneos', async () => {
    // saldo cobre exatamente UM envio de R$ 14,16
    const user = await criarUsuarioComSaldo(1416)
    const cotacao = await criarCotacaoValida(user.id)
    const a = await criarEnvio(user.id, { quoteId: cotacao.id, servicoId: 'eco', ...enderecos })
    const b = await criarEnvio(user.id, { quoteId: cotacao.id, servicoId: 'eco', ...enderecos })

    const resultados = await Promise.allSettled([
      pagarEnvio(user.id, a.id),
      pagarEnvio(user.id, b.id),
    ])

    const ok = resultados.filter((r) => r.status === 'fulfilled')
    const falhas = resultados.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(falhas).toHaveLength(1)
    expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(0)

    const lancamentos = await prisma.ledgerEntry.count({ where: { walletId: wallet.id, tipo: 'DEBITO' } })
    expect(lancamentos).toBe(1)
  })

  it('mantém o saldo intacto quando o pagamento falha', async () => {
    const user = await criarUsuarioComSaldo(100)
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, { quoteId: cotacao.id, servicoId: 'eco', ...enderecos })

    await expect(pagarEnvio(user.id, envio.id)).rejects.toThrow(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(100)
    const atualizado = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(atualizado.status).toBe('PENDING')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run src/server/shipment-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar com lock pessimista**

```ts
export async function pagarEnvio(userId: string, shipmentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [wallet] = await tx.$queryRaw<{ id: string; saldoCentavos: number }[]>`
      SELECT id, "saldoCentavos" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `
    if (!wallet) throw new CarteiraNaoEncontradaError('Carteira não encontrada.')

    const envio = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    if (envio.userId !== userId) throw new NaoAutorizadoError('Envio de outro usuário.')
    garantirTransicao(envio.status, 'RELEASED')

    const lancamento = aplicarDebito(wallet.saldoCentavos, envio.precoCobradoCentavos)

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        tipo: lancamento.tipo,
        valorCentavos: lancamento.valorCentavos,
        saldoAposCentavos: lancamento.saldoAposCentavos,
        refTipo: 'SHIPMENT',
        refId: envio.id,
        descricao: `Envio ${envio.id}`,
      },
    })
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { saldoCentavos: lancamento.saldoAposCentavos },
    })
    await tx.shipment.update({
      where: { id: envio.id },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })
  })
}
```

O `SELECT ... FOR UPDATE` é o que serializa os dois pagamentos. Sem ele o teste de concorrência falha e o saldo fica negativo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run src/server/shipment-service.test.ts`
Expected: PASS — inclusive o teste de concorrência.

- [ ] **Step 5: Construir a interface de novo envio**

Fluxo em etapas: cotação escolhida → remetente (dos endereços salvos ou novo) → destinatário → produtos da declaração de conteúdo (nome, quantidade, valor unitário) → revisão com o valor a debitar e o saldo restante → confirmar. Se o saldo for insuficiente, oferecer recarga sem perder o que já foi preenchido.

- [ ] **Step 6: Commit**

```bash
git add src && git commit -m "feat: criação e pagamento de envio com débito transacional"
```

---

### Task 14: Geração da etiqueta

**Files:**
- Create: `src/infra/labels/etiqueta-pdf.ts`, `src/infra/labels/codigo-rastreio.ts`, `src/app/api/envios/[id]/etiqueta/route.ts`
- Test: `src/infra/labels/codigo-rastreio.test.ts`, `src/infra/labels/etiqueta-pdf.test.ts`

**Interfaces:**
- Consumes: `Shipment` (Task 4).
- Produces:
  - `gerarCodigoRastreio(): string` — formato `FR` + 9 dígitos + `BR`
  - `gerarEtiquetaPdf(envio: DadosEtiqueta, formato: 'TERMICA' | 'A4'): Promise<Uint8Array>`
  - `gerarEtiqueta(shipmentId: string): Promise<void>` — atribui código e move para `GENERATED`

- [ ] **Step 1: Escrever os testes**

Código de rastreio: casa com `/^FR\d{9}BR$/`; 10.000 gerações não repetem. PDF: os bytes começam com `%PDF`; o PDF de 300 envios em A4 gera 75 páginas; o PDF contém o código de rastreio, o nome do destinatário e os itens da declaração como texto extraível.

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

Térmica 100×150mm; A4 com 4 etiquetas por folha. Code128 via `bwip-js`. Declaração de conteúdo com itens, quantidades, valores unitários e total declarado.

- [ ] **Step 3: Ligar a geração ao pagamento**

Após o commit de `pagarEnvio`, chamar `gerarEtiqueta`. Falha na geração **não** desfaz o pagamento: o envio permanece em `RELEASED` e a ação fica disponível para nova tentativa. Testar explicitamente esse caso com o gerador de PDF forçado a lançar.

- [ ] **Step 4: Commit**

```bash
git add src && git commit -m "feat: geração de etiqueta PDF com código de barras e declaração de conteúdo"
```

---

### Task 15: Minhas etiquetas

**Files:**
- Create: `src/app/(app)/etiquetas/page.tsx`, `src/app/(app)/etiquetas/[id]/page.tsx`, `src/app/api/envios/route.ts` (GET)
- Test: `src/app/api/envios/route.test.ts`

- [ ] **Step 1: Escrever os testes**

Lista devolve apenas os envios do usuário autenticado; filtro por status funciona; busca por código de rastreio e por nome do destinatário funciona; paginação devolve o total correto; envio de outro usuário devolve 404, nunca 403 com dados.

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

- [ ] **Step 3: Construir a interface**

Lista com abas por status (Todos, Aguardando postagem, Postados, Entregues, Cancelados), busca, e por linha: destinatário, código, valor, status e ações (Imprimir etiqueta, Rastrear, Cancelar quando permitido).

- [ ] **Step 4: Commit**

```bash
git add src && git commit -m "feat: listagem e detalhe de etiquetas"
```

---

### Task 16: Rastreio público

**Files:**
- Create: `src/app/r/[codigo]/page.tsx`, `src/server/tracking-service.ts`
- Test: `src/server/tracking-service.test.ts`, `e2e/rastreio.spec.ts`

**Interfaces:**
- Produces:
  - `registrarEvento(shipmentId: string, status: StatusShipment, descricao: string, local: string): Promise<void>` — valida a transição e atualiza o envio
  - `buscarRastreioPublico(codigo: string): Promise<RastreioPublico | null>`
  - `RastreioPublico = { codigo: string; status: StatusShipment; eventos: { status: string; descricao: string; cidade: string; uf: string; ocorridoEm: Date }[] }`

- [ ] **Step 1: Escrever o teste de vazamento de dados**

```ts
it('não expõe dados pessoais no rastreio público', async () => {
  const envio = await criarEnvioEntregue({
    destinatarioNome: 'Maria Aparecida da Silva',
    destinatarioLogradouro: 'Rua das Flores',
    destinatarioNumero: '123',
    destinatarioCidade: 'Rio de Janeiro',
    destinatarioUf: 'RJ',
  })

  const rastreio = await buscarRastreioPublico(envio.codigoRastreio!)
  const serializado = JSON.stringify(rastreio)

  expect(serializado).not.toContain('Maria Aparecida')
  expect(serializado).not.toContain('Rua das Flores')
  expect(serializado).not.toContain('123')
  expect(serializado).toContain('Rio de Janeiro') // cidade é permitida
})

it('devolve null para código inexistente, sem revelar se existe', async () => {
  expect(await buscarRastreioPublico('FR000000000BR')).toBeNull()
})
```

- [ ] **Step 2: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

`registrarEvento` chama `garantirTransicao` antes de gravar; quando `deveEstornar` retorna verdadeiro, credita a carteira na mesma transação.

- [ ] **Step 3: Construir a página pública**

Timeline vertical, do evento mais recente para o mais antigo, com status, data, hora e cidade/UF. Página indexável, sem exigir login.

- [ ] **Step 4: Commit**

```bash
git add src && git commit -m "feat: rastreio público com timeline de eventos"
```

---

### Task 17: Painel administrativo

**Files:**
- Create: `src/app/(admin)/admin/**`, `src/server/admin/*.ts`, `src/middleware.ts`
- Test: `src/app/(admin)/admin/acesso.test.ts`, `src/server/admin/importar-tabela.test.ts`

- [ ] **Step 1: Escrever o teste de autorização**

Usuário com papel `CLIENTE` recebe 404 em toda rota `/admin` e em toda rota `/api/admin`. A verificação acontece no servidor; esconder o link na interface não conta como proteção. Testar chamada direta à rota de API, não apenas a navegação.

- [ ] **Step 2: Rodar e confirmar que falha; implementar a guarda; rodar e confirmar que passa**

- [ ] **Step 3: Escrever o teste de importação de tabela**

CSV com colunas `servico,cep_origem_ini,cep_origem_fim,cep_destino_ini,cep_destino_fim,peso_min_g,peso_max_g,preco_balcao,preco_venda,prazo_dias`. Linha malformada aborta a importação inteira e relata o número da linha — importação parcial de tabela de preço é pior que nenhuma. Preços aceitos em reais com vírgula (`14,16`) e convertidos para centavos.

- [ ] **Step 4: Rodar e confirmar que falha; implementar; rodar e confirmar que passa**

- [ ] **Step 5: Construir as telas**

Envios (busca por código, e-mail ou documento; avanço manual de status, que dispara `registrarEvento`); tabelas de preço (importação por CSV, listagem, ativação/desativação); usuários (busca, crédito manual em carteira com justificativa obrigatória); auditoria (leitura do `AuditLog`).

Toda ação administrativa que mexe em dinheiro ou status grava `AuditLog` com ator, antes e depois.

- [ ] **Step 6: Commit**

```bash
git add src && git commit -m "feat: painel administrativo com importação de tabela e auditoria"
```

---

### Task 18: E2E do fluxo completo e fechamento da fase

**Files:**
- Create: `e2e/fluxo-completo.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Escrever o teste E2E ponta a ponta**

Cotar sem login → cadastrar (a cotação sobrevive ao cadastro) → recarregar saldo (confirmação simulada) → criar envio → pagar → baixar etiqueta (afirmar `content-type: application/pdf`) → admin avança status para POSTED → rastreio público mostra o evento.

- [ ] **Step 2: Rodar o E2E**

Run: `pnpm playwright test`
Expected: PASS

- [ ] **Step 3: Verificar a cobertura**

Run: `pnpm vitest run --coverage`
Expected: ≥ 80% de linhas em `src/domain/` e `src/server/`.

- [ ] **Step 4: Escrever o README**

Como subir o banco, rodar migrations, semear, rodar em desenvolvimento, rodar testes. Lista das variáveis de ambiente com exemplo.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: fluxo completo ponta a ponta e documentação da fase 1"
```

---

## Critério de conclusão da Fase 1

- [ ] Cotação funciona sem login e mostra preço de balcão e preço final lado a lado
- [ ] Usuário se cadastra com CPF e mantém a cotação feita antes do cadastro
- [ ] Carteira credita, debita e o extrato bate com o saldo
- [ ] Dois pagamentos simultâneos nunca deixam o saldo negativo (teste automatizado)
- [ ] Etiqueta PDF sai com código de barras e declaração de conteúdo
- [ ] Rastreio público funciona e não vaza nome nem endereço
- [ ] Admin importa tabela de preço, avança status e credita saldo, com auditoria
- [ ] Cobertura ≥ 80%, E2E verde

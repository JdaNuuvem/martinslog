# Base de leads — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma base única de compradores da plataforma, deduplicada entre lojas, visível apenas para a administração.

**Architecture:** Dois modelos novos (`Lead`, `LeadOrigem`) alimentados por um serviço único chamado dos três fluxos que já existem (pedido, envio, conversa), sempre fora da transação do chamador e sem poder derrubá-lo. A identidade é resolvida por uma cascata CPF → telefone → e-mail, com fusão quando a mesma pessoa entrou por dois caminhos. O CPF nunca é gravado em claro: vira HMAC para servir de chave e AES-256-GCM para ser exibido.

**Tech Stack:** Next.js (App Router), Prisma + PostgreSQL, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-12-base-de-leads-design.md`

## Global Constraints

- **CPF nunca em claro no banco.** Só `cpfHash` (HMAC-SHA256 com `LEAD_FINGERPRINT_KEY`) e `cpfCifrado` (AES-256-GCM via `cifrar` de `src/infra/crypto/segredo.ts`).
- **Negação administrativa é 404, nunca 403.** Use `exigirAdmin` (API) e `exigirAdminNaPagina` (página) de `src/server/admin/guarda.ts`.
- **O papel vem da sessão, nunca da URL ou do corpo.**
- **Registrar lead nunca derruba o chamador.** Toda chamada em `try/catch` com `console.error`, seguindo `avisarCompradorPorSms` em `src/server/shipment-service.ts:454`.
- **Envio `sandbox` não vira lead.**
- Arquivos abaixo de 500 linhas; funções abaixo de 50.
- Comentários em português, explicando **por quê**, no estilo do repositório.
- Testes: `npx vitest run <arquivo>`. Tipos: `npm run typecheck`. Lint: `npm run lint`.
- Commits em português, prefixo convencional, terminando com:
  `Co-Authored-By: claude-flow <ruv@ruv.net>`

---

### Task 1: Modelos `Lead` e `LeadOrigem`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_base_de_leads/migration.sql` (gerada)

**Interfaces:**
- Consumes: nada.
- Produces: modelos `Lead` e `LeadOrigem`, enum `OrigemLead` com os valores `PEDIDO_PAGO`, `PEDIDO_PENDENTE`, `ENVIO`, `CONVERSA`.

- [ ] **Step 1: Acrescentar o enum e os modelos ao schema**

Ao final de `prisma/schema.prisma`:

```prisma
/// De onde um lead veio. Cada aparição da pessoa gera uma linha em
/// `LeadOrigem`; este enum diz qual porta ela usou daquela vez.
enum OrigemLead {
  PEDIDO_PAGO
  PEDIDO_PENDENTE
  ENVIO
  CONVERSA
}

/// Uma pessoa que comprou (ou quase comprou) em alguma loja da plataforma.
///
/// Existe porque o dado do comprador estava espalhado por `Pedido`,
/// `Shipment.destinatario`, `Address` e `Conversa`, sem nada que dissesse
/// "esta pessoa": a mesma compradora com três pedidos em duas lojas e uma
/// conversa era sete linhas desconexas.
///
/// A base é da PLATAFORMA, não da loja: o mesmo comprador aparece uma vez
/// ainda que tenha comprado em três lugares, e `LeadOrigem` guarda de quais
/// lojas ele veio.
model Lead {
  id String @id @default(cuid())

  nome String?

  /// Como a pessoa informou. O normalizado ao lado é o que compara.
  email             String?
  /// Minúsculas e sem espaços. Chave de reserva quando não há CPF.
  emailNormalizado  String? @unique

  telefone            String?
  /// Só dígitos, sem o DDI 55. Sem isso "(21) 99999-0001" e "5521999990001"
  /// viram duas pessoas.
  telefoneNormalizado String? @unique

  /// HMAC-SHA256 do CPF — a chave principal de identidade.
  ///
  /// HMAC, e não SHA-256 puro: existem cerca de um bilhão de CPFs válidos, e
  /// testar todos contra um hash sem segredo leva segundos numa placa de
  /// vídeo comum. Sem o segredo do servidor, esta coluna não diz nada a quem
  /// rouba o banco.
  cpfHash    String? @unique
  /// O CPF em si, cifrado. Só é decifrado quando alguém pede para ver, e o
  /// pedido fica registrado em `AuditLog`.
  cpfCifrado String?

  primeiroContatoEm DateTime
  ultimoContatoEm   DateTime

  /// Resumo mantido na escrita, para a lista não somar nada na leitura.
  totalPedidos       Int @default(0)
  totalEnvios        Int @default(0)
  valorTotalCentavos Int @default(0)

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  origens LeadOrigem[]

  @@index([ultimoContatoEm])
  @@index([nome])
  @@map("leads")
}

/// Cada vez que a pessoa apareceu, e por onde.
model LeadOrigem {
  id     String     @id @default(cuid())
  leadId String
  tipo   OrigemLead

  /// De qual loja veio. Nulo só em origem que não tem perfil.
  perfilId String?

  pedidoId   String?
  shipmentId String?
  conversaId String?

  ocorridoEm DateTime

  criadoEm DateTime @default(now())

  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)

  /// Reprocessar a mesma origem não cria linha repetida — é o que torna a
  /// carga inicial idempotente e permite interrompê-la e retomá-la.
  @@unique([tipo, pedidoId, shipmentId, conversaId], map: "lead_origens_dedupe_key")
  @@index([leadId, ocorridoEm])
  @@index([perfilId])
  @@map("lead_origens")
}
```

- [ ] **Step 2: Gerar a migração**

Run: `npx prisma migrate dev --name base_de_leads`
Expected: cria `prisma/migrations/<timestamp>_base_de_leads/migration.sql` e regenera o client.

- [ ] **Step 3: Conferir a cláusula de nulos no índice único**

Abra o `migration.sql` gerado. O índice `lead_origens_dedupe_key` cobre colunas que são quase sempre nulas (uma origem preenche `pedidoId` **ou** `shipmentId` **ou** `conversaId`). No Postgres, `NULL` é distinto de `NULL`, então o índice como o Prisma escreve **não** barra duplicata.

Edite o `migration.sql`, trocando a linha do índice por:

```sql
CREATE UNIQUE INDEX "lead_origens_dedupe_key"
  ON "lead_origens" ("tipo", "pedidoId", "shipmentId", "conversaId")
  NULLS NOT DISTINCT;
```

É o mesmo cuidado que `20260903090000_trava_duplicata_com_nulos` tomou para `mensagem_envios` — sem ele, a trava não vale justamente para o caso que acontece sempre.

- [ ] **Step 4: Reaplicar e conferir**

Run: `npx prisma migrate reset --force && npx prisma migrate deploy`
Expected: aplica sem erro.

- [ ] **Step 5: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erro novo.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: modelos da base de leads da plataforma

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 2: Identidade — normalização e impressão digital

**Files:**
- Create: `src/domain/lead/identidade.ts`
- Create: `src/domain/lead/identidade.test.ts`
- Modify: `src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizarCpf(bruto: string | null | undefined): string | null`
  - `normalizarTelefoneLead(bruto: string | null | undefined): string | null`
  - `normalizarEmail(bruto: string | null | undefined): string | null`
  - `impressaoDigitalCpf(cpf: string): string`

- [ ] **Step 1: Escrever o teste que falha**

`src/domain/lead/identidade.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from './identidade'

describe('normalizarCpf', () => {
  it('tira máscara e devolve só dígitos', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725')
  })

  it('recusa o que não tem onze dígitos', () => {
    expect(normalizarCpf('123')).toBeNull()
    expect(normalizarCpf('')).toBeNull()
    expect(normalizarCpf(null)).toBeNull()
  })
})

describe('normalizarTelefoneLead', () => {
  it('trata o mesmo número com e sem DDI como um só', () => {
    // É o defeito que duplicaria o lead: a conversa do WhatsApp chega com
    // DDI e o pedido da loja chega sem.
    expect(normalizarTelefoneLead('(21) 99999-0001')).toBe('21999990001')
    expect(normalizarTelefoneLead('5521999990001')).toBe('21999990001')
  })

  it('recusa número curto demais para ser telefone', () => {
    expect(normalizarTelefoneLead('999')).toBeNull()
    expect(normalizarTelefoneLead(undefined)).toBeNull()
  })
})

describe('normalizarEmail', () => {
  it('ignora caixa e espaço nas pontas', () => {
    expect(normalizarEmail('  Maria@Exemplo.COM ')).toBe('maria@exemplo.com')
  })

  it('recusa o que não parece e-mail', () => {
    expect(normalizarEmail('maria')).toBeNull()
    expect(normalizarEmail('')).toBeNull()
  })
})

describe('impressaoDigitalCpf', () => {
  it('é determinística: mesma entrada, mesma saída', () => {
    expect(impressaoDigitalCpf('52998224725')).toBe(impressaoDigitalCpf('52998224725'))
  })

  it('entradas diferentes dão saídas diferentes', () => {
    expect(impressaoDigitalCpf('52998224725')).not.toBe(impressaoDigitalCpf('52998224726'))
  })

  it('não é um SHA-256 puro do CPF', () => {
    /*
      A prova de que o segredo entra no cálculo. Se a impressão digital fosse
      apenas `sha256(cpf)`, quem roubasse o banco testaria o bilhão de CPFs
      válidos em segundos e teria todos de volta em claro.
    */
    const shaPuro = createHash('sha256').update('52998224725').digest('hex')
    expect(impressaoDigitalCpf('52998224725')).not.toBe(shaPuro)
  })
})
```

Acrescente no topo do arquivo de teste:

```typescript
import { createHash } from 'crypto'
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/domain/lead/identidade.test.ts`
Expected: FAIL — `Failed to resolve import "./identidade"`.

- [ ] **Step 3: Acrescentar o segredo ao schema de ambiente**

Em `src/env.ts`, dentro do `z.object({ ... })`, depois de `WEBHOOK_CRON_TOKEN`:

```typescript
  /**
   * Segredo que transforma o CPF em impressão digital na base de leads.
   *
   * Separado de `SECRET_ENCRYPTION_KEY` de propósito: as duas protegem
   * coisas diferentes, e rotacionar uma não deve invalidar a outra.
   *
   * CUIDADO AO TROCAR: as impressões digitais deixam de bater e TODO lead
   * antigo vira inencontrável — a mesma pessoa passa a ser criada de novo,
   * do zero. É consequência inevitável de qualquer chave derivada de
   * segredo, e não há migração que conserte, porque o CPF de origem não
   * está guardado em claro em lugar nenhum.
   */
  LEAD_FINGERPRINT_KEY: z.string().min(32).optional(),
```

`optional()` porque ambiente que não usa leads não pode deixar de subir por causa disso; a função que a consome lança quando ela falta.

Em `.env.example`, acrescente:

```
# Segredo da impressão digital de CPF na base de leads (mínimo 32 caracteres).
# Gere com: openssl rand -hex 32
# ATENÇÃO: trocar este valor torna todos os leads existentes inencontráveis.
LEAD_FINGERPRINT_KEY=
```

- [ ] **Step 4: Escrever a implementação**

`src/domain/lead/identidade.ts`:

```typescript
import { createHmac } from 'crypto'

/**
 * Como duas aparições da mesma pessoa são reconhecidas como a mesma pessoa.
 *
 * Tudo aqui é puro e sem banco: é a camada que decide o que é igual, e ela
 * precisa ser exercitável sem subir nada.
 */

/** CPF em dígitos, ou `null` quando não há CPF utilizável. */
export function normalizarCpf(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '')
  return digitos.length === 11 ? digitos : null
}

/**
 * Telefone em dígitos, sem o DDI do Brasil.
 *
 * O DDI cai porque a mesma pessoa chega com ele pela conversa do WhatsApp e
 * sem ele pelo pedido da loja. Mantê-lo faria o lead duplicar exatamente no
 * caso mais comum.
 *
 * O piso de dez dígitos é o telefone brasileiro com DDD; abaixo disso o
 * valor não identifica ninguém e vale mais ficar sem chave do que juntar
 * duas pessoas por engano.
 */
export function normalizarTelefoneLead(bruto: string | null | undefined): string | null {
  let digitos = (bruto ?? '').replace(/\D/g, '')

  if (digitos.length > 11 && digitos.startsWith('55')) {
    digitos = digitos.slice(2)
  }

  return digitos.length >= 10 && digitos.length <= 11 ? digitos : null
}

/** E-mail em minúsculas, ou `null` quando não parece e-mail. */
export function normalizarEmail(bruto: string | null | undefined): string | null {
  const limpo = (bruto ?? '').trim().toLowerCase()
  if (!limpo) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo) ? limpo : null
}

/**
 * A impressão digital do CPF: HMAC-SHA256 com o segredo do servidor.
 *
 * **Não é SHA-256 puro, e a diferença é o recurso inteiro.** Existem cerca
 * de um bilhão de CPFs válidos. Um hash sem segredo é invertido testando
 * todos eles, o que leva segundos numa placa de vídeo comum — seria guardar
 * o CPF em claro com passos a mais. Com o HMAC, quem rouba a tabela não tem
 * como voltar ao número sem também roubar o segredo.
 *
 * Lança quando o segredo não está configurado, em vez de cair para um valor
 * padrão: um padrão embutido estaria publicado junto com o repositório e
 * anularia a proteção em silêncio.
 */
export function impressaoDigitalCpf(cpf: string): string {
  const segredo = process.env.LEAD_FINGERPRINT_KEY

  if (!segredo || segredo.length < 32) {
    throw new Error(
      'LEAD_FINGERPRINT_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela, o CPF não pode virar chave de identidade sem ficar exposto.',
    )
  }

  return createHmac('sha256', segredo).update(cpf).digest('hex')
}
```

- [ ] **Step 5: Definir o segredo no ambiente de teste**

Confirme que `LEAD_FINGERPRINT_KEY` existe no `.env` usado pelos testes. Se não existir, acrescente um valor de 64 caracteres hexadecimais gerado por `openssl rand -hex 32`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/domain/lead/identidade.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 7: Commit**

```bash
git add src/domain/lead src/env.ts .env.example
git commit -m "feat: identidade do lead por CPF, telefone e e-mail

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 3: `registrarLead` — cascata e fusão

**Files:**
- Create: `src/server/lead-service.ts`
- Create: `src/server/lead-service.test.ts`

**Interfaces:**
- Consumes: `normalizarCpf`, `normalizarTelefoneLead`, `normalizarEmail`, `impressaoDigitalCpf` (Task 2); `cifrar` de `src/infra/crypto/segredo.ts`.
- Produces:

```typescript
export type EntradaLead = {
  tipo: 'PEDIDO_PAGO' | 'PEDIDO_PENDENTE' | 'ENVIO' | 'CONVERSA'
  perfilId?: string | null
  pedidoId?: string | null
  shipmentId?: string | null
  conversaId?: string | null
  ocorridoEm: Date
  nome?: string | null
  email?: string | null
  telefone?: string | null
  cpf?: string | null
  valorCentavos?: number
}

export async function registrarLead(entrada: EntradaLead): Promise<string | null>
```

Devolve o `id` do lead, ou `null` quando a entrada não trouxe nenhuma chave utilizável.

- [ ] **Step 1: Escrever os testes que falham**

`src/server/lead-service.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarLead } from './lead-service'

const CPF = '52998224725'
const OUTRO_CPF = '11144477735'

afterEach(async () => {
  await prisma.lead.deleteMany({})
})

function base(extras: Partial<Parameters<typeof registrarLead>[0]> = {}) {
  return {
    tipo: 'PEDIDO_PAGO' as const,
    ocorridoEm: new Date('2026-09-01T10:00:00Z'),
    ...extras,
  }
}

describe('registrarLead', () => {
  it('sem nenhuma chave utilizável não cria lead', async () => {
    expect(await registrarLead(base({ nome: 'Fulano' }))).toBeNull()
    expect(await prisma.lead.count()).toBe(0)
  })

  it('o mesmo CPF em duas lojas é um lead com duas origens', async () => {
    const primeiro = await registrarLead(
      base({ cpf: CPF, perfilId: null, pedidoId: 'p1', valorCentavos: 5000 }),
    )
    const segundo = await registrarLead(
      base({ cpf: CPF, perfilId: null, pedidoId: 'p2', valorCentavos: 3000 }),
    )

    expect(segundo).toBe(primeiro)
    expect(await prisma.lead.count()).toBe(1)
    expect(await prisma.leadOrigem.count({ where: { leadId: primeiro! } })).toBe(2)

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: primeiro! } })
    expect(lead.totalPedidos).toBe(2)
    expect(lead.valorTotalCentavos).toBe(8000)
  })

  it('o mesmo telefone com e sem DDI é um lead só', async () => {
    const um = await registrarLead(base({ telefone: '(21) 99999-0001', conversaId: 'c1' }))
    const dois = await registrarLead(base({ telefone: '5521999990001', pedidoId: 'p1' }))

    expect(dois).toBe(um)
    expect(await prisma.lead.count()).toBe(1)
  })

  it('o mesmo e-mail em caixa diferente é um lead só', async () => {
    const um = await registrarLead(base({ email: 'Maria@Exemplo.com', pedidoId: 'p1' }))
    const dois = await registrarLead(base({ email: 'maria@exemplo.com', pedidoId: 'p2' }))

    expect(dois).toBe(um)
  })

  it('pessoas sem nada em comum são leads separados', async () => {
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    await registrarLead(base({ cpf: OUTRO_CPF, pedidoId: 'p2' }))

    expect(await prisma.lead.count()).toBe(2)
  })

  it('funde os dois leads quando o CPF revela que são a mesma pessoa', async () => {
    /*
      O caso real: a pessoa chama no WhatsApp (só telefone) e mais tarde faz
      um envio com CPF — mas o CPF dela já tinha entrado por um pedido de
      outra loja. São dois leads que precisam virar um, e é exatamente nos
      leads mais completos (com CPF E WhatsApp) que a duplicata apareceria.
    */
    const porConversa = await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990002', conversaId: 'c1' }),
    )
    const porCpf = await registrarLead(
      base({ cpf: CPF, pedidoId: 'p1', valorCentavos: 7000 }),
    )
    expect(porCpf).not.toBe(porConversa)
    expect(await prisma.lead.count()).toBe(2)

    // O envio traz os dois dados juntos e revela que são a mesma pessoa.
    await registrarLead(
      base({ tipo: 'ENVIO', cpf: CPF, telefone: '21999990002', shipmentId: 's1' }),
    )

    expect(await prisma.lead.count()).toBe(1)
    const sobrevivente = await prisma.lead.findFirstOrThrow()
    expect(sobrevivente.telefoneNormalizado).toBe('21999990002')
    expect(sobrevivente.cpfHash).not.toBeNull()
    expect(await prisma.leadOrigem.count()).toBe(3)
    expect(sobrevivente.valorTotalCentavos).toBe(7000)
    // O sobrevivente é o de contato mais antigo: é ele que carrega a data
    // verdadeira do primeiro contato daquela pessoa.
    expect(sobrevivente.id).toBe(porConversa)
  })

  it('funde também quando a busca casa primeiro pelo CPF', async () => {
    /*
      O espelho do caso acima, e o que denuncia uma cascata que para no
      primeiro acerto: se a procura encontra o lead do CPF e não olha mais
      nada, o gêmeo do telefone sobrevive para sempre.
    */
    const porCpf = await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    const porTelefone = await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990009', conversaId: 'c9' }),
    )
    expect(porCpf).not.toBe(porTelefone)

    await registrarLead(
      base({ tipo: 'ENVIO', cpf: CPF, telefone: '21999990009', shipmentId: 's9' }),
    )

    expect(await prisma.lead.count()).toBe(1)
  })

  it('não grava o CPF em claro em nenhuma coluna', async () => {
    const id = await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: id! } })

    expect(JSON.stringify(lead)).not.toContain(CPF)
  })

  it('reprocessar a mesma origem não duplica a linha de origem', async () => {
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))
    await registrarLead(base({ cpf: CPF, pedidoId: 'p1' }))

    expect(await prisma.leadOrigem.count()).toBe(1)
    const lead = await prisma.lead.findFirstOrThrow()
    // O total também não pode contar duas vezes o mesmo pedido.
    expect(lead.totalPedidos).toBe(1)
  })

  it('o nome do envio vence o nome vindo da conversa', async () => {
    await registrarLead(
      base({ tipo: 'CONVERSA', telefone: '21999990003', nome: 'zezinho❤️', conversaId: 'c1' }),
    )
    await registrarLead(
      base({ tipo: 'ENVIO', telefone: '21999990003', nome: 'José da Silva', shipmentId: 's1' }),
    )

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.nome).toBe('José da Silva')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/lead-service.test.ts`
Expected: FAIL — `Failed to resolve import "./lead-service"`.

- [ ] **Step 3: Escrever a implementação**

`src/server/lead-service.ts`:

```typescript
import type { OrigemLead, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { cifrar } from '@/infra/crypto/segredo'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from '@/domain/lead/identidade'

/**
 * A base de leads da plataforma.
 *
 * Uma pessoa, uma linha — ainda que ela tenha comprado em três lojas. É a
 * diferença entre "quem são nossos compradores" e "quantas linhas de pedido
 * existem", e nenhuma tabela respondia a primeira pergunta.
 */

export type EntradaLead = {
  tipo: OrigemLead
  perfilId?: string | null
  pedidoId?: string | null
  shipmentId?: string | null
  conversaId?: string | null
  ocorridoEm: Date
  nome?: string | null
  email?: string | null
  telefone?: string | null
  cpf?: string | null
  valorCentavos?: number
}

/** Nome vindo destas origens tem precedência sobre o das outras. */
const ORIGENS_COM_NOME_CONFIAVEL: readonly OrigemLead[] = ['ENVIO', 'PEDIDO_PAGO', 'PEDIDO_PENDENTE']

/**
 * Registra uma aparição da pessoa, criando, atualizando ou fundindo leads.
 *
 * Devolve o id do lead, ou `null` quando a entrada não trouxe CPF, telefone
 * nem e-mail — sem nenhuma chave não há como reconhecer essa pessoa da
 * próxima vez, e um lead que nunca casa com nada só engorda a base.
 */
export async function registrarLead(entrada: EntradaLead): Promise<string | null> {
  const cpf = normalizarCpf(entrada.cpf)
  const telefone = normalizarTelefoneLead(entrada.telefone)
  const email = normalizarEmail(entrada.email)

  if (!cpf && !telefone && !email) return null

  const cpfHash = cpf ? impressaoDigitalCpf(cpf) : null

  return prisma.$transaction(async (tx) => {
    /*
      TODOS os leads que casam com QUALQUER chave, não só o primeiro.

      Procurar só até o primeiro acerto deixa a fusão sem efeito no caso que
      ela existe para resolver: a pessoa que chamou no WhatsApp (telefone) e
      depois fez um envio (CPF) tem dois leads, e o envio que traz os dois
      dados casa pelo CPF, encontra o lead do CPF, confere que o dono do CPF
      é ele mesmo — e nunca descobre o gêmeo do telefone.
    */
    const candidatos = await leadsQueCasam(tx, { cpfHash, telefone, email })

    const leadId =
      candidatos.length === 0
        ? await criarLead(tx, entrada, { cpf, cpfHash, telefone, email })
        : await consolidar(tx, candidatos, entrada, { cpf, cpfHash, telefone, email })

    await registrarOrigem(tx, leadId, entrada)

    return leadId
  })
}

type Chaves = {
  cpfHash: string | null
  telefone: string | null
  email: string | null
}

type Tx = Prisma.TransactionClient

/**
 * Todos os leads que casam com alguma das chaves, sem repetir.
 *
 * Devolve uma lista, e não o primeiro acerto, porque é a lista que revela a
 * duplicata: dois leads aqui significam a mesma pessoa que entrou na base por
 * dois caminhos diferentes, e é isso que `consolidar` conserta.
 *
 * A busca por chave é exata nas três: as colunas são únicas, e o que decide
 * se dois valores são "o mesmo" já foi resolvido na normalização.
 */
async function leadsQueCasam(tx: Tx, chaves: Chaves) {
  const achados = await tx.lead.findMany({
    where: {
      OR: [
        ...(chaves.cpfHash ? [{ cpfHash: chaves.cpfHash }] : []),
        ...(chaves.telefone ? [{ telefoneNormalizado: chaves.telefone }] : []),
        ...(chaves.email ? [{ emailNormalizado: chaves.email }] : []),
      ],
    },
    orderBy: { primeiroContatoEm: 'asc' },
  })

  return achados
}

async function criarLead(tx: Tx, entrada: EntradaLead, chaves: Chaves & { cpf: string | null }) {
  const lead = await tx.lead.create({
    data: {
      nome: entrada.nome?.trim() || null,
      email: entrada.email?.trim() || null,
      emailNormalizado: chaves.email,
      telefone: entrada.telefone?.trim() || null,
      telefoneNormalizado: chaves.telefone,
      cpfHash: chaves.cpfHash,
      cpfCifrado: chaves.cpf ? cifrar(chaves.cpf) : null,
      primeiroContatoEm: entrada.ocorridoEm,
      ultimoContatoEm: entrada.ocorridoEm,
    },
  })

  return lead.id
}

/**
 * Reduz os candidatos a um lead só e escreve nele o que a aparição trouxe.
 *
 * O SOBREVIVENTE é o de contato mais antigo, e não o mais completo: ele é o
 * que carrega o `primeiroContatoEm` verdadeiro daquela pessoa, e é o id que
 * já pode estar referenciado em qualquer lugar que tenha lido a base antes.
 */
async function consolidar(
  tx: Tx,
  candidatos: { id: string }[],
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const [sobrevivente, ...gemeos] = candidatos

  for (const gemeo of gemeos) {
    await fundir(tx, sobrevivente!.id, gemeo.id)
  }

  return aplicarDados(tx, sobrevivente!.id, entrada, chaves)
}

/**
 * Junta dois leads que são a mesma pessoa. O `sobrevivente` fica; o
 * `absorvido` deixa de existir.
 *
 * A ORDEM importa: `emailNormalizado`, `telefoneNormalizado` e `cpfHash` são
 * únicos, então copiar o telefone do absorvido para o sobrevivente enquanto
 * os dois existem viola a restrição e aborta a transação inteira. Por isso o
 * absorvido é lido, depois apagado, e só então os valores são reatribuídos.
 */
async function fundir(tx: Tx, sobreviventeId: string, absorvidoId: string): Promise<void> {
  const absorvido = await tx.lead.findUniqueOrThrow({ where: { id: absorvidoId } })
  const sobrevivente = await tx.lead.findUniqueOrThrow({ where: { id: sobreviventeId } })

  await tx.leadOrigem.updateMany({
    where: { leadId: absorvidoId },
    data: { leadId: sobreviventeId },
  })

  await tx.lead.delete({ where: { id: absorvidoId } })

  await tx.lead.update({
    where: { id: sobreviventeId },
    data: {
      nome: sobrevivente.nome ?? absorvido.nome,
      email: sobrevivente.email ?? absorvido.email,
      emailNormalizado: sobrevivente.emailNormalizado ?? absorvido.emailNormalizado,
      telefone: sobrevivente.telefone ?? absorvido.telefone,
      telefoneNormalizado: sobrevivente.telefoneNormalizado ?? absorvido.telefoneNormalizado,
      totalPedidos: sobrevivente.totalPedidos + absorvido.totalPedidos,
      totalEnvios: sobrevivente.totalEnvios + absorvido.totalEnvios,
      valorTotalCentavos: sobrevivente.valorTotalCentavos + absorvido.valorTotalCentavos,
      primeiroContatoEm:
        absorvido.primeiroContatoEm < sobrevivente.primeiroContatoEm
          ? absorvido.primeiroContatoEm
          : sobrevivente.primeiroContatoEm,
      ultimoContatoEm:
        absorvido.ultimoContatoEm > sobrevivente.ultimoContatoEm
          ? absorvido.ultimoContatoEm
          : sobrevivente.ultimoContatoEm,
    },
  })
}

/**
 * Escreve no lead o que a aparição nova trouxe.
 *
 * A regra é conservadora: campo vazio é preenchido, campo preenchido fica
 * como está. Sem ela o último a chegar sempre vence e o nome do lead oscila
 * a cada mensagem de WhatsApp. As exceções estão comentadas onde valem.
 */
async function aplicarDados(
  tx: Tx,
  leadId: string,
  entrada: EntradaLead,
  chaves: Chaves & { cpf: string | null },
): Promise<string> {
  const atual = await tx.lead.findUniqueOrThrow({ where: { id: leadId } })

  /*
    O nome do envio ou do pedido vence o da conversa mesmo quando já há um
    nome gravado: o do envio foi digitado para uma etiqueta, e o da conversa
    é o apelido que a pessoa escolheu no WhatsApp — costuma ter emoji e
    raramente é o nome civil.
  */
  const nomeNovo = entrada.nome?.trim() || null
  const nomeVence =
    nomeNovo !== null && (atual.nome === null || ORIGENS_COM_NOME_CONFIAVEL.includes(entrada.tipo))

  await tx.lead.update({
    where: { id: leadId },
    data: {
      nome: nomeVence ? nomeNovo : atual.nome,
      email: atual.email ?? entrada.email?.trim() ?? null,
      emailNormalizado: atual.emailNormalizado ?? chaves.email,
      telefone: atual.telefone ?? entrada.telefone?.trim() ?? null,
      telefoneNormalizado: atual.telefoneNormalizado ?? chaves.telefone,
      // O CPF, uma vez conhecido, nunca é trocado: ele é a chave de
      // identidade, e trocá-lo transformaria o lead em outra pessoa.
      cpfHash: atual.cpfHash ?? chaves.cpfHash,
      cpfCifrado: atual.cpfCifrado ?? (chaves.cpf ? cifrar(chaves.cpf) : null),
      primeiroContatoEm:
        entrada.ocorridoEm < atual.primeiroContatoEm ? entrada.ocorridoEm : atual.primeiroContatoEm,
      ultimoContatoEm:
        entrada.ocorridoEm > atual.ultimoContatoEm ? entrada.ocorridoEm : atual.ultimoContatoEm,
    },
  })

  return leadId
}

/**
 * Grava a aparição e soma os totais.
 *
 * Os totais só sobem quando a origem é NOVA. A trava de duplicata do banco
 * recusa a segunda gravação da mesma origem, e é dentro desse mesmo caminho
 * que a soma acontece — assim reprocessar um pedido não conta a compra duas
 * vezes.
 */
async function registrarOrigem(tx: Tx, leadId: string, entrada: EntradaLead): Promise<void> {
  try {
    await tx.leadOrigem.create({
      data: {
        leadId,
        tipo: entrada.tipo,
        perfilId: entrada.perfilId ?? null,
        pedidoId: entrada.pedidoId ?? null,
        shipmentId: entrada.shipmentId ?? null,
        conversaId: entrada.conversaId ?? null,
        ocorridoEm: entrada.ocorridoEm,
      },
    })
  } catch (erro) {
    // Violação da chave única: esta origem já estava registrada. É o caminho
    // normal da carga inicial ao ser retomada, e nada mais deve acontecer.
    if (erro && typeof erro === 'object' && 'code' in erro && erro.code === 'P2002') return
    throw erro
  }

  await tx.lead.update({
    where: { id: leadId },
    data: {
      totalPedidos:
        entrada.tipo === 'PEDIDO_PAGO' || entrada.tipo === 'PEDIDO_PENDENTE'
          ? { increment: 1 }
          : undefined,
      totalEnvios: entrada.tipo === 'ENVIO' ? { increment: 1 } : undefined,
      valorTotalCentavos: entrada.valorCentavos ? { increment: entrada.valorCentavos } : undefined,
    },
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/lead-service.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Verificar tipos e lint**

Run: `npm run typecheck && npx eslint src/server/lead-service.ts src/domain/lead`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/server/lead-service.ts src/server/lead-service.test.ts
git commit -m "feat: registrar lead com cascata de identidade e fusão

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 4: Ingestão nos três fluxos

**Files:**
- Modify: `src/server/pedido-service.ts`
- Modify: `src/server/emitir-etiqueta-service.ts`
- Modify: `src/server/conversa-service.ts`
- Create: `src/server/lead-ingestao.test.ts`

**Interfaces:**
- Consumes: `registrarLead`, `EntradaLead` (Task 3).
- Produces: nada novo exportado. Os três fluxos passam a alimentar a base.

- [ ] **Step 1: Escrever os testes que falham**

`src/server/lead-ingestao.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { registrarPedido } from './pedido-service'

const usuariosCriados: string[] = []
let userId = ''
let perfilId = ''

const remetente: EnderecoEnvio = {
  nome: 'Remetente Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

beforeAll(async () => {
  const user = await criarUsuarioComSaldo(500_000)
  userId = user.id
  usuariosCriados.push(userId)
  const perfil = await prisma.perfil.create({
    data: { userId, nome: 'Loja do teste de leads' },
  })
  perfilId = perfil.id
})

afterEach(async () => {
  await prisma.lead.deleteMany({})
})

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const ids = envios.map((e) => e.id)
  const carteiras = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: ids } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.pedido.deleteMany({ where: { perfilId } })
  await prisma.perfil.deleteMany({ where: { id: perfilId } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: carteiras.map((c) => c.id) } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function emitir(destinatario: EnderecoEnvio, sandbox = false): Promise<string> {
  const cotacao = await criarCotacaoValida(userId, { precoCentavos: 1416 })
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    perfilId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date(), sandbox },
  })
  await emitirEtiqueta(envio.id)
  return envio.id
}

const compradora: EnderecoEnvio = {
  nome: 'Maria Aparecida',
  documento: '111.444.777-35',
  email: 'maria@exemplo.com',
  telefone: '21999990001',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

describe('ingestão de leads', () => {
  it('pedido registrado vira lead', async () => {
    await registrarPedido(perfilId, {
      externalId: `ped-${Date.now()}`,
      status: 'PAGO',
      clienteNome: 'Maria Aparecida',
      clienteFone: '21999990001',
      clienteEmail: 'maria@exemplo.com',
      valorCentavos: 9990,
    })

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.telefoneNormalizado).toBe('21999990001')
    expect(lead.totalPedidos).toBe(1)
    expect(lead.valorTotalCentavos).toBe(9990)
  })

  it('etiqueta emitida vira lead e traz o CPF', async () => {
    await emitir(compradora)

    const lead = await prisma.lead.findFirstOrThrow()
    expect(lead.cpfHash).not.toBeNull()
    expect(lead.totalEnvios).toBe(1)
  })

  it('envio sandbox não vira lead', async () => {
    /*
      O comprador de um pedido de teste não existe. Sem esta regra a base
      fica poluída com os dados fictícios de quem está integrando.
    */
    await emitir({ ...compradora, documento: '529.982.247-25' }, true)

    expect(await prisma.lead.count()).toBe(0)
  })

  it('falha ao registrar lead não derruba a emissão da etiqueta', async () => {
    /*
      A falha é provocada de VERDADE, não por substituição da função: sem o
      segredo da impressão digital, `registrarLead` lança ao processar um CPF.
      Um teste que troca a função por outra prova que o mock foi chamado; este
      prova que o caminho de erro real não derruba a emissão.

      (Mock de módulo ESM também é frágil aqui — o namespace é congelado e o
      spy falha de forma intermitente conforme o bundler.)
    */
    const segredo = process.env.LEAD_FINGERPRINT_KEY
    delete process.env.LEAD_FINGERPRINT_KEY

    try {
      // A etiqueta é o produto; o lead é subproduto. Uma falha no subproduto
      // não pode desfazer uma emissão que já aconteceu.
      const shipmentId = await emitir(compradora)

      const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
      expect(envio.codigoRastreio).not.toBeNull()
      expect(await prisma.lead.count()).toBe(0)
    } finally {
      process.env.LEAD_FINGERPRINT_KEY = segredo
    }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/lead-ingestao.test.ts`
Expected: FAIL — nenhum lead é criado.

- [ ] **Step 3: Ligar o fluxo de pedido**

Em `src/server/pedido-service.ts`, acrescente o import:

```typescript
import { registrarLead } from './lead-service'
```

Ao final de `registrarPedido`, logo antes do `return` do pedido salvo:

```typescript
  /*
    O comprador entra na base de leads.

    Nunca derruba o registro do pedido: o lead é subproduto, e a loja que
    integrou tem direito ao seu 201 mesmo que a nossa base falhe. Mesma
    regra do aviso por SMS em `shipment-service`.
  */
  try {
    await registrarLead({
      tipo: status === 'PAGO' ? 'PEDIDO_PAGO' : 'PEDIDO_PENDENTE',
      perfilId,
      pedidoId: salvo.id,
      ocorridoEm: agora,
      nome: entrada.clienteNome,
      email: entrada.clienteEmail,
      telefone: fone,
      valorCentavos: status === 'PAGO' ? entrada.valorCentavos : 0,
    })
  } catch (error) {
    console.error('Falha ao registrar o lead do pedido', { cause: error })
  }
```

Ajuste `salvo.id` para o nome real da variável que carrega o pedido gravado.

- [ ] **Step 4: Ligar o fluxo de envio**

Em `src/server/emitir-etiqueta-service.ts`, acrescente o import:

```typescript
import { registrarLead } from "./lead-service";
```

A função hoje termina em `return prisma.$transaction(async (tx) => { ... })`. Guarde o resultado e registre o lead **depois** da transação:

```typescript
  const resultado = await prisma.$transaction(async (tx) => {
    // ... corpo existente, inalterado ...
  });

  /*
    O lead entra FORA da transação, de propósito.

    A transação acima emite o código de rastreio e cria a timeline inteira —
    é o caminho crítico da emissão. Enfiar a busca e a eventual fusão de
    leads lá dentro alongaria essa transação por causa de um subproduto, e
    um erro no subproduto desfaria a etiqueta.
  */
  await registrarLeadDoEnvio(shipmentId);

  return resultado;
}

/**
 * Põe o destinatário do envio na base de leads.
 *
 * É a única origem que traz CPF, e por isso a que mais importa para a
 * identidade: sem ela, a cascata quase nunca tem chave forte para usar.
 */
async function registrarLeadDoEnvio(shipmentId: string): Promise<void> {
  try {
    const envio = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { perfilId: true, sandbox: true, destinatario: true, geradoEm: true },
    });

    // Envio de teste não avisa nem cadastra ninguém: o comprador não existe.
    if (!envio || envio.sandbox) return;

    const destinatario = envio.destinatario as {
      nome?: string;
      email?: string;
      telefone?: string;
      documento?: string;
    } | null;

    if (!destinatario) return;

    await registrarLead({
      tipo: "ENVIO",
      perfilId: envio.perfilId,
      shipmentId,
      ocorridoEm: envio.geradoEm ?? new Date(),
      nome: destinatario.nome,
      email: destinatario.email,
      telefone: destinatario.telefone,
      cpf: destinatario.documento,
    });
  } catch (error) {
    console.error("Falha ao registrar o lead do envio", { shipmentId, cause: error });
  }
}
```

- [ ] **Step 5: Ligar o fluxo de conversa**

Em `src/server/conversa-service.ts`, acrescente o import:

```typescript
import { registrarLead } from './lead-service'
```

Em `registrarEntrada`, depois da transação que grava a mensagem e antes do `return`:

```typescript
  /*
    Quem chama a loja no WhatsApp entra na base mesmo sem ter comprado — é o
    lead no sentido literal. Traz só telefone, e às vezes o apelido do
    perfil, que por isso perde do nome vindo de um envio.
  */
  try {
    await registrarLead({
      tipo: 'CONVERSA',
      perfilId: entrada.perfilId,
      conversaId: conversa.id,
      ocorridoEm: entrada.ocorridoEm,
      nome: entrada.nomeContato,
      telefone: entrada.contato,
    })
  } catch (error) {
    console.error('Falha ao registrar o lead da conversa', { cause: error })
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/server/lead-ingestao.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde. Os três fluxos tocados têm testes próprios que não podem regredir.

- [ ] **Step 8: Commit**

```bash
git add src/server/pedido-service.ts src/server/emitir-etiqueta-service.ts src/server/conversa-service.ts src/server/lead-ingestao.test.ts
git commit -m "feat: pedido, envio e conversa alimentam a base de leads

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 5: Carga inicial do que já existe

**Files:**
- Create: `scripts/carregar-leads.ts`

**Interfaces:**
- Consumes: `registrarLead` (Task 3).
- Produces: nada. Script operacional.

- [ ] **Step 1: Escrever o script**

`scripts/carregar-leads.ts`:

```typescript
/**
 * Cria os leads do que já está no banco.
 *
 * A base de leads passa a ser alimentada na escrita, mas tudo que aconteceu
 * antes dela existir ficou de fora — e é a maior parte. Este script percorre
 * pedidos, envios e conversas já gravados e os apresenta ao mesmo
 * `registrarLead` que roda ao vivo.
 *
 * A ORDEM CRONOLÓGICA importa: ela reproduz a mesma sequência de fusões que
 * teria acontecido ao vivo. Processar fora de ordem produz uma base
 * diferente — correta, mas com outros `primeiroContatoEm` e outros nomes
 * vencedores.
 *
 * É idempotente: a trava de duplicata em `LeadOrigem` recusa a origem já
 * registrada, então rodar duas vezes dá o mesmo resultado e o script pode
 * ser interrompido e retomado.
 *
 * Chama a função de produção, não uma cópia: se a regra de identidade
 * mudar, isto muda junto. Copiar a lógica aqui é como se escreve o defeito
 * que só existe na migração.
 *
 * Uso: DATABASE_URL=… LEAD_FINGERPRINT_KEY=… npx tsx scripts/carregar-leads.ts [--aplicar]
 */
import { prisma } from '../src/infra/db/client'
import { registrarLead, type EntradaLead } from '../src/server/lead-service'

const aplicar = process.argv.includes('--aplicar')

type Destinatario = {
  nome?: string
  email?: string
  telefone?: string
  documento?: string
}

async function coletar(): Promise<EntradaLead[]> {
  const pedidos = await prisma.pedido.findMany({
    select: {
      id: true,
      perfilId: true,
      status: true,
      clienteNome: true,
      clienteFone: true,
      clienteEmail: true,
      valorCentavos: true,
      criadoEm: true,
    },
  })

  const envios = await prisma.shipment.findMany({
    where: { sandbox: false, codigoRastreio: { not: null } },
    select: {
      id: true,
      perfilId: true,
      destinatario: true,
      geradoEm: true,
      criadoEm: true,
    },
  })

  const conversas = await prisma.conversa.findMany({
    select: { id: true, perfilId: true, contato: true, nomeContato: true, criadoEm: true },
  })

  const entradas: EntradaLead[] = [
    ...pedidos.map((p): EntradaLead => ({
      tipo: p.status === 'PAGO' ? 'PEDIDO_PAGO' : 'PEDIDO_PENDENTE',
      perfilId: p.perfilId,
      pedidoId: p.id,
      ocorridoEm: p.criadoEm,
      nome: p.clienteNome,
      email: p.clienteEmail,
      telefone: p.clienteFone,
      valorCentavos: p.status === 'PAGO' ? p.valorCentavos : 0,
    })),
    ...envios.map((e): EntradaLead => {
      const destinatario = (e.destinatario as Destinatario | null) ?? {}
      return {
        tipo: 'ENVIO',
        perfilId: e.perfilId,
        shipmentId: e.id,
        ocorridoEm: e.geradoEm ?? e.criadoEm,
        nome: destinatario.nome,
        email: destinatario.email,
        telefone: destinatario.telefone,
        cpf: destinatario.documento,
      }
    }),
    ...conversas.map((c): EntradaLead => ({
      tipo: 'CONVERSA',
      perfilId: c.perfilId,
      conversaId: c.id,
      ocorridoEm: c.criadoEm,
      nome: c.nomeContato,
      telefone: c.contato,
    })),
  ]

  return entradas.sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime())
}

async function principal(): Promise<void> {
  const entradas = await coletar()
  console.log(`${entradas.length} aparições a processar, em ordem cronológica.`)

  if (!aplicar) {
    console.log('Simulação. Rode com --aplicar para gravar.')
    return
  }

  let processadas = 0
  let semChave = 0

  for (const entrada of entradas) {
    try {
      const id = await registrarLead(entrada)
      if (id === null) semChave += 1
    } catch (error) {
      // Uma aparição que falha não pode levar as seguintes junto: a próxima
      // execução a reencontra, e as que passaram não são refeitas.
      console.error('Falha ao processar aparição', { entrada, cause: error })
    }

    processadas += 1
    if (processadas % 500 === 0) {
      console.log(`  ${processadas}/${entradas.length}`)
    }
  }

  const total = await prisma.lead.count()
  console.log(`Pronto. ${processadas} processadas, ${semChave} sem chave utilizável.`)
  console.log(`Base com ${total} leads.`)
}

principal()
  .catch((erro) => {
    console.error(erro)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Rodar em simulação contra o banco de teste**

Run: `npx tsx scripts/carregar-leads.ts`
Expected: imprime a contagem e avisa que é simulação, sem gravar nada.

- [ ] **Step 3: Verificar a idempotência**

Run: `npx tsx scripts/carregar-leads.ts --aplicar` duas vezes seguidas.
Expected: a segunda execução termina com exatamente a mesma contagem de leads da primeira.

- [ ] **Step 4: Verificar tipos e lint**

Run: `npm run typecheck && npx eslint scripts/carregar-leads.ts`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add scripts/carregar-leads.ts
git commit -m "feat: carga inicial da base de leads a partir do histórico

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 6: Consulta administrativa

**Files:**
- Create: `src/server/admin/consulta-leads.ts`
- Create: `src/server/admin/consulta-leads.test.ts`
- Create: `src/lib/leads-schema.ts`

**Interfaces:**
- Consumes: `impressaoDigitalCpf`, `normalizarCpf`, `normalizarTelefoneLead`, `normalizarEmail` (Task 2); `decifrar` de `src/infra/crypto/segredo.ts`.
- Produces:

```typescript
export type FiltroLeads = {
  busca?: string
  perfilId?: string
  origem?: OrigemLead
  desde?: Date
  ate?: Date
  pagina?: number
}
export type LeadResumo = { /* definido no Step 1 */ }
export async function listarLeads(filtro?: FiltroLeads): Promise<ResultadoLeads>
export async function obterLead(leadId: string): Promise<LeadDetalhe | null>
export async function revelarCpf(leadId: string, adminUserId: string): Promise<string | null>
```

- [ ] **Step 1: Escrever o schema compartilhado**

`src/lib/leads-schema.ts`:

```typescript
import { z } from 'zod'

/** Página pedida na URL. Valor estranho cai em 1 em vez de quebrar a tela. */
export const paginaLeadsSchema = z.coerce.number().int().min(1).catch(1)

/**
 * Busca livre. O limite de 120 caracteres não é regra de negócio: é para não
 * carregar consulta com texto arbitrariamente longo vindo da query string.
 */
export const buscaLeadsSchema = z.string().trim().max(120).catch('')

export const ORIGENS = ['PEDIDO_PAGO', 'PEDIDO_PENDENTE', 'ENVIO', 'CONVERSA'] as const

export const ROTULO_ORIGEM: Readonly<Record<(typeof ORIGENS)[number], string>> = {
  PEDIDO_PAGO: 'Pedido pago',
  PEDIDO_PENDENTE: 'Pedido não finalizado',
  ENVIO: 'Envio',
  CONVERSA: 'Conversa',
}

export const POR_PAGINA = 50

export type LeadResumo = {
  id: string
  nome: string | null
  email: string | null
  telefone: string | null
  /** Sempre mascarado. O completo não sai da listagem em hipótese nenhuma. */
  cpfMascarado: string | null
  lojas: string[]
  totalPedidos: number
  totalEnvios: number
  valorTotalCentavos: number
  ultimoContatoEm: string
}

export type ResultadoLeads = {
  leads: LeadResumo[]
  total: number
  pagina: number
  porPagina: number
}
```

- [ ] **Step 2: Escrever o teste que falha**

`src/server/admin/consulta-leads.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { registrarLead } from '@/server/lead-service'
import { listarLeads, obterLead } from './consulta-leads'

const CPF = '52998224725'

afterEach(async () => {
  await prisma.lead.deleteMany({})
})

async function semear() {
  await registrarLead({
    tipo: 'PEDIDO_PAGO',
    pedidoId: 'p1',
    ocorridoEm: new Date('2026-09-01T10:00:00Z'),
    nome: 'Maria Aparecida',
    email: 'maria@exemplo.com',
    telefone: '21999990001',
    cpf: CPF,
    valorCentavos: 9990,
  })
  await registrarLead({
    tipo: 'CONVERSA',
    conversaId: 'c1',
    ocorridoEm: new Date('2026-09-05T10:00:00Z'),
    nome: 'João Pedro',
    telefone: '21999990002',
  })
}

describe('listarLeads', () => {
  it('lista do contato mais recente para o mais antigo', async () => {
    await semear()

    const { leads, total } = await listarLeads()

    expect(total).toBe(2)
    expect(leads[0]?.nome).toBe('João Pedro')
  })

  it('nunca devolve o CPF completo na listagem', async () => {
    await semear()

    const { leads } = await listarLeads()

    expect(JSON.stringify(leads)).not.toContain(CPF)
    expect(leads.find((l) => l.nome === 'Maria Aparecida')?.cpfMascarado).toBe('***.982.247-**')
  })

  it('acha pelo CPF digitado, comparando impressão digital', async () => {
    await semear()

    const { leads } = await listarLeads({ busca: '529.982.247-25' })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.nome).toBe('Maria Aparecida')
  })

  it('acha por nome, e-mail e telefone', async () => {
    await semear()

    expect((await listarLeads({ busca: 'maria' })).leads).toHaveLength(1)
    expect((await listarLeads({ busca: 'maria@exemplo.com' })).leads).toHaveLength(1)
    expect((await listarLeads({ busca: '21999990002' })).leads).toHaveLength(1)
  })

  it('filtra por período pelo último contato', async () => {
    await semear()

    const { leads } = await listarLeads({ desde: new Date('2026-09-03T00:00:00Z') })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.nome).toBe('João Pedro')
  })
})

describe('obterLead', () => {
  it('devolve o histórico em ordem e não devolve o CPF completo', async () => {
    await semear()
    const lead = await prisma.lead.findFirstOrThrow({ where: { nome: 'Maria Aparecida' } })

    const detalhe = await obterLead(lead.id)

    expect(detalhe?.origens).toHaveLength(1)
    expect(JSON.stringify(detalhe)).not.toContain(CPF)
  })

  it('devolve null para id que não existe', async () => {
    expect(await obterLead('nao-existe')).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/server/admin/consulta-leads.test.ts`
Expected: FAIL — `Failed to resolve import "./consulta-leads"`.

- [ ] **Step 4: Escrever a implementação**

`src/server/admin/consulta-leads.ts`:

```typescript
import type { OrigemLead, Prisma } from '@prisma/client'
import { prisma } from '@/infra/db/client'
import { decifrar } from '@/infra/crypto/segredo'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from '@/domain/lead/identidade'
import { POR_PAGINA, type LeadResumo, type ResultadoLeads } from '@/lib/leads-schema'

/**
 * Consulta da base de leads, para a administração.
 *
 * Nenhuma função daqui devolve CPF completo. A única que o decifra é
 * `revelarCpf`, e ela registra quem pediu — ver o comentário lá embaixo.
 */

export type FiltroLeads = {
  busca?: string
  perfilId?: string
  origem?: OrigemLead
  desde?: Date
  ate?: Date
  pagina?: number
  /**
   * Traz TODOS os que casam com o filtro, sem paginar. Só a exportação usa.
   *
   * Existe porque exportar "a lista filtrada" paginada exportaria as
   * primeiras cinquenta linhas e nada diria que o resto ficou de fora —
   * quem baixasse o arquivo concluiria que a base tem cinquenta pessoas.
   * O teto de dez mil é a proteção contra montar um CSV de centenas de
   * megabytes na memória do servidor; passando dele, a resposta avisa que
   * o filtro precisa ser mais estreito.
   */
  todas?: boolean
}

/** Teto de linhas por exportação. Acima disso, o filtro precisa estreitar. */
export const TETO_EXPORTACAO = 10_000

/**
 * Mascara o CPF preservando o miolo.
 *
 * O miolo basta para conferir que é a pessoa certa quando alguém dita o
 * número pelo telefone, e não basta para reconstituir o documento.
 */
function mascarar(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`
}

/**
 * Monta o `where` da busca livre.
 *
 * A busca por CPF é diferente das outras: o termo digitado vira impressão
 * digital e a comparação é hash contra hash. Consequência direta de não
 * guardar o número em claro — busca por CPF parcial não funciona, e não tem
 * como funcionar sem desfazer a proteção.
 */
function filtroDeBusca(termo: string): Prisma.LeadWhereInput | null {
  const limpo = termo.trim()
  if (!limpo) return null

  const cpf = normalizarCpf(limpo)
  if (cpf) return { cpfHash: impressaoDigitalCpf(cpf) }

  const telefone = normalizarTelefoneLead(limpo)
  if (telefone) return { telefoneNormalizado: telefone }

  const email = normalizarEmail(limpo)
  if (email) return { emailNormalizado: email }

  return { nome: { contains: limpo, mode: 'insensitive' } }
}

export async function listarLeads(filtro: FiltroLeads = {}): Promise<ResultadoLeads> {
  const pagina = Math.max(1, filtro.pagina ?? 1)
  const busca = filtro.busca ? filtroDeBusca(filtro.busca) : null

  const where: Prisma.LeadWhereInput = {
    ...(busca ?? {}),
    ...(filtro.desde || filtro.ate
      ? {
          ultimoContatoEm: {
            ...(filtro.desde ? { gte: filtro.desde } : {}),
            ...(filtro.ate ? { lte: filtro.ate } : {}),
          },
        }
      : {}),
    ...(filtro.perfilId || filtro.origem
      ? {
          origens: {
            some: {
              ...(filtro.perfilId ? { perfilId: filtro.perfilId } : {}),
              ...(filtro.origem ? { tipo: filtro.origem } : {}),
            },
          },
        }
      : {}),
  }

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { ultimoContatoEm: 'desc' },
      skip: filtro.todas ? 0 : (pagina - 1) * POR_PAGINA,
      take: filtro.todas ? TETO_EXPORTACAO : POR_PAGINA,
      include: {
        origens: { select: { perfilId: true }, distinct: ['perfilId'] },
      },
    }),
  ])

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  const nomeDoPerfil = new Map(perfis.map((p) => [p.id, p.nome]))

  const resumos: LeadResumo[] = leads.map((lead) => ({
    id: lead.id,
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone,
    /*
      O CPF sai MASCARADO da listagem, sempre.

      Numa lista, mil CPFs são lidos de uma vez por qualquer um que abra a
      tela ou tire um print. No detalhe, ler mil exige mil ações — e cada uma
      fica registrada.
    */
    cpfMascarado: lead.cpfCifrado ? mascarar(decifrar(lead.cpfCifrado)) : null,
    lojas: lead.origens
      .map((o) => (o.perfilId ? nomeDoPerfil.get(o.perfilId) : null))
      .filter((nome): nome is string => nome !== null && nome !== undefined),
    totalPedidos: lead.totalPedidos,
    totalEnvios: lead.totalEnvios,
    valorTotalCentavos: lead.valorTotalCentavos,
    ultimoContatoEm: lead.ultimoContatoEm.toISOString(),
  }))

  return { leads: resumos, total, pagina, porPagina: POR_PAGINA }
}

export type LeadDetalhe = LeadResumo & {
  primeiroContatoEm: string
  origens: {
    tipo: OrigemLead
    loja: string | null
    pedidoId: string | null
    shipmentId: string | null
    conversaId: string | null
    ocorridoEm: string
  }[]
}

export async function obterLead(leadId: string): Promise<LeadDetalhe | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { origens: { orderBy: { ocorridoEm: 'desc' } } },
  })

  if (!lead) return null

  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  const nomeDoPerfil = new Map(perfis.map((p) => [p.id, p.nome]))

  return {
    id: lead.id,
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone,
    cpfMascarado: lead.cpfCifrado ? mascarar(decifrar(lead.cpfCifrado)) : null,
    lojas: [
      ...new Set(
        lead.origens
          .map((o) => (o.perfilId ? nomeDoPerfil.get(o.perfilId) : null))
          .filter((nome): nome is string => nome !== null && nome !== undefined),
      ),
    ],
    totalPedidos: lead.totalPedidos,
    totalEnvios: lead.totalEnvios,
    valorTotalCentavos: lead.valorTotalCentavos,
    primeiroContatoEm: lead.primeiroContatoEm.toISOString(),
    ultimoContatoEm: lead.ultimoContatoEm.toISOString(),
    origens: lead.origens.map((o) => ({
      tipo: o.tipo,
      loja: o.perfilId ? (nomeDoPerfil.get(o.perfilId) ?? null) : null,
      pedidoId: o.pedidoId,
      shipmentId: o.shipmentId,
      conversaId: o.conversaId,
      ocorridoEm: o.ocorridoEm.toISOString(),
    })),
  }
}

/**
 * Decifra e devolve o CPF completo de um lead.
 *
 * **É a única porta por onde o número sai do sistema**, e por isso cada
 * chamada grava `AuditLog`. O registro é o que permite responder, depois,
 * quem leu o documento de quem e quando — sem ele, "alguém exportou a base"
 * não tem como ser investigado.
 */
export async function revelarCpf(leadId: string, adminUserId: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { cpfCifrado: true },
  })

  if (!lead?.cpfCifrado) return null

  await prisma.auditLog.create({
    data: {
      actorUserId: adminUserId,
      acao: 'LEAD_CPF_REVELADO',
      entidade: 'Lead',
      entidadeId: leadId,
    },
  })

  return decifrar(lead.cpfCifrado)
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/server/admin/consulta-leads.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin/consulta-leads.ts src/server/admin/consulta-leads.test.ts src/lib/leads-schema.ts
git commit -m "feat: consulta da base de leads para a administração

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 7: Tela `/admin/leads` e detalhe

**Files:**
- Create: `src/app/(admin)/admin/leads/page.tsx`
- Create: `src/app/(admin)/admin/leads/[id]/page.tsx`
- Create: `src/app/api/admin/leads/[id]/cpf/route.ts`
- Create: `src/app/api/admin/leads/[id]/cpf/route.test.ts`
- Modify: `src/components/admin/nav-admin.tsx`

**Interfaces:**
- Consumes: `listarLeads`, `obterLead`, `revelarCpf` (Task 6); `exigirAdmin`, `exigirAdminNaPagina` de `src/server/admin/guarda.ts`; `TabelaResponsiva` de `src/components/admin/tabela-responsiva.tsx`.
- Produces: `POST /api/admin/leads/[id]/cpf` devolvendo `{ cpf: string }`.

- [ ] **Step 1: Escrever o teste de acesso que falha**

`src/app/api/admin/leads/[id]/cpf/route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/admin/leads/[id]/cpf', () => {
  it('devolve 404 para quem não é admin, nunca 403', async () => {
    /*
      403 confirmaria que existe um painel administrativo ali, dando alvo a
      quem sonda. Para quem não é admin a área simplesmente não existe.
    */
    const requisicao = new NextRequest('http://localhost/api/admin/leads/abc/cpf', {
      method: 'POST',
    })

    const resposta = await POST(requisicao, { params: Promise.resolve({ id: 'abc' }) })

    expect(resposta.status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/api/admin/leads/[id]/cpf/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Escrever a rota**

`src/app/api/admin/leads/[id]/cpf/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin } from '@/server/admin/guarda'
import { revelarCpf } from '@/server/admin/consulta-leads'

/**
 * `POST /api/admin/leads/[id]/cpf` — revela o CPF completo de um lead.
 *
 * É POST, e não GET, de propósito: a chamada tem efeito colateral — grava
 * `AuditLog`. Um GET seria pré-carregado por navegador e por robô de
 * indexação, enchendo o registro de leituras que ninguém pediu e afogando as
 * que importam.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id } = await context.params

  try {
    const cpf = await revelarCpf(id, guarda.sessao.userId)

    if (!cpf) {
      return NextResponse.json(
        { codigo: 'SEM_CPF', mensagem: 'Este lead não tem CPF registrado.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ cpf })
  } catch (error) {
    console.error('Erro inesperado ao revelar o CPF do lead', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao revelar o CPF.' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/api/admin/leads/[id]/cpf/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Acrescentar o item de navegação**

Em `src/components/admin/nav-admin.tsx`, dentro de `ITENS`, depois de `{ rotulo: 'Usuários', href: '/admin/usuarios' }`:

```typescript
  { rotulo: 'Leads', href: '/admin/leads' },
```

- [ ] **Step 6: Escrever a página da lista**

`src/app/(admin)/admin/leads/page.tsx`, seguindo a estrutura de
`src/app/(admin)/admin/pedidos/page.tsx`: `export const dynamic = 'force-dynamic'`,
`await exigirAdminNaPagina()` como primeira linha do componente, filtros lidos de
`searchParams` pelos schemas de `src/lib/leads-schema.ts`, e a tabela montada com
`TabelaResponsiva`.

Colunas, nesta ordem: nome, e-mail, telefone, CPF mascarado, lojas, pedidos,
envios, valor total, último contato. Cada linha leva a `/admin/leads/[id]`.

Cabeçalho com a contagem total e a paginação (anterior/próxima), preservando os
filtros na query string.

- [ ] **Step 7: Escrever a página de detalhe**

`src/app/(admin)/admin/leads/[id]/page.tsx`: `await exigirAdminNaPagina()`,
`obterLead(id)` e `notFound()` quando vier `null`.

Mostra os dados da pessoa, o CPF mascarado com um botão "ver CPF" (componente
cliente que chama `POST /api/admin/leads/[id]/cpf`) e a linha do tempo das
origens, cada uma com link para a tela que já existe:

- `PEDIDO_PAGO` / `PEDIDO_PENDENTE` → `/admin/pedidos`
- `ENVIO` → `/admin/envios`
- `CONVERSA` → `/whatsapp/conversas`

- [ ] **Step 8: Conferir tipos, lint e suíte**

Run: `npm run typecheck && npm run lint && npm test`
Expected: tudo verde.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/admin/leads" "src/app/api/admin/leads" src/components/admin/nav-admin.tsx
git commit -m "feat: aba de leads na administração, com detalhe e histórico

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 8: Exportação CSV

**Files:**
- Create: `src/app/api/admin/leads/exportar/route.ts`
- Create: `src/app/api/admin/leads/exportar/route.test.ts`
- Modify: `src/app/(admin)/admin/leads/page.tsx`

**Interfaces:**
- Consumes: `listarLeads`, `TETO_EXPORTACAO` (Task 6); `exigirAdmin` (guarda); `decifrar` de `src/infra/crypto/segredo.ts`.
- Produces: `GET /api/admin/leads/exportar?...&cpfCompleto=true` devolvendo `text/csv`.

- [ ] **Step 1: Escrever os testes que falham**

`src/app/api/admin/leads/exportar/route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/admin/leads/exportar', () => {
  it('devolve 404 para quem não é admin', async () => {
    const requisicao = new NextRequest('http://localhost/api/admin/leads/exportar')

    expect((await GET(requisicao)).status).toBe(404)
  })
})
```

O teste com sessão de admin exige a fábrica de sessão usada nos outros testes de
rota administrativa; siga o padrão de `src/app/api/admin/envios/[id]/simulacao/route.test.ts`
para criar a sessão e acrescente dois casos:

- exportação padrão traz o CPF mascarado, e o número completo não aparece em
  lugar nenhum do corpo;
- exportação com `cpfCompleto=true` grava `AuditLog` com ação
  `LEADS_EXPORTADOS`;
- a exportação traz TODAS as linhas do filtro, não só a primeira página —
  semeie mais de `POR_PAGINA` leads e conte as linhas do CSV.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/api/admin/leads/exportar/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Escrever a rota**

`src/app/api/admin/leads/exportar/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { exigirAdmin } from '@/server/admin/guarda'
import { decifrar } from '@/infra/crypto/segredo'
import { listarLeads, TETO_EXPORTACAO } from '@/server/admin/consulta-leads'

/**
 * `GET /api/admin/leads/exportar` — a base filtrada, em CSV.
 *
 * O CPF sai MASCARADO por padrão. Sair completo exige `cpfCompleto=true`, que
 * na tela é uma caixa que diz o que está fazendo.
 *
 * Toda exportação grava `AuditLog` com o número de linhas e os filtros
 * usados. Quando o arquivo sai do sistema ninguém mais controla onde ele
 * para — o registro é a única forma de responder depois quem levou esses
 * dados e quando.
 */

/** Escapa um campo para CSV, protegendo contra injeção de fórmula. */
function celula(valor: string | number | null): string {
  const texto = String(valor ?? '')

  /*
    Um valor começando por `=`, `+`, `-` ou `@` é interpretado como FÓRMULA
    pelo Excel e pelo Google Sheets ao abrir o arquivo. Um nome cadastrado
    como `=HYPERLINK(...)` vira código executado na máquina de quem abre a
    planilha — e o nome vem do comprador, que digitou o que quis no checkout.
    O apóstrofo à frente neutraliza isso.
  */
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto

  return `"${seguro.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const parametros = request.nextUrl.searchParams
  const cpfCompleto = parametros.get('cpfCompleto') === 'true'

  /*
    `todas: true` — a exportação leva tudo que casa com o filtro, não a
    primeira página. Exportar cinquenta linhas de uma base de oito mil e
    chamar o arquivo de "leads.csv" seria entregar um recorte silencioso.
  */
  const filtro = {
    busca: parametros.get('busca') ?? undefined,
    perfilId: parametros.get('loja') ?? undefined,
    todas: true,
  }

  try {
    const { leads, total } = await listarLeads(filtro)

    if (total > TETO_EXPORTACAO) {
      return NextResponse.json(
        {
          codigo: 'EXPORTACAO_GRANDE_DEMAIS',
          mensagem: `São ${total} leads e o limite por arquivo é ${TETO_EXPORTACAO}. Estreite o filtro por período ou por loja.`,
        },
        { status: 422 },
      )
    }

    const linhas = [
      ['Nome', 'E-mail', 'Telefone', 'CPF', 'Lojas', 'Pedidos', 'Envios', 'Valor total', 'Último contato']
        .map(celula)
        .join(','),
    ]

    /*
      Com CPF completo, decifra em LOTE e registra UMA linha de auditoria para
      a exportação inteira — a que já é gravada logo abaixo.

      Chamar `revelarCpf` por lead gravaria uma linha por pessoa: dez mil
      registros para uma exportação afogariam justamente o log que existe para
      ser lido. A linha do lote já responde quem exportou, quantos e com quais
      filtros, que é a pergunta que se faz depois.
    */
    const cpfPorLead = new Map<string, string>()

    if (cpfCompleto) {
      const cifrados = await prisma.lead.findMany({
        where: { id: { in: leads.map((l) => l.id) } },
        select: { id: true, cpfCifrado: true },
      })

      for (const registro of cifrados) {
        if (registro.cpfCifrado) cpfPorLead.set(registro.id, decifrar(registro.cpfCifrado))
      }
    }

    for (const lead of leads) {
      const cpf = cpfCompleto
        ? (cpfPorLead.get(lead.id) ?? '')
        : (lead.cpfMascarado ?? '')

      linhas.push(
        [
          lead.nome,
          lead.email,
          lead.telefone,
          cpf,
          lead.lojas.join(' | '),
          lead.totalPedidos,
          lead.totalEnvios,
          (lead.valorTotalCentavos / 100).toFixed(2),
          lead.ultimoContatoEm,
        ]
          .map(celula)
          .join(','),
      )
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: guarda.sessao.userId,
        acao: 'LEADS_EXPORTADOS',
        entidade: 'Lead',
        entidadeId: 'exportacao',
        depois: {
          linhas: leads.length,
          totalNaBase: total,
          cpfCompleto,
          filtros: Object.fromEntries(parametros.entries()),
        },
      },
    })

    return new NextResponse(linhas.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Erro inesperado ao exportar leads', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao exportar.' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/app/api/admin/leads/exportar/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Acrescentar o botão na tela**

Em `src/app/(admin)/admin/leads/page.tsx`, no cabeçalho: um link "Exportar CSV"
apontando para `/api/admin/leads/exportar` com os filtros atuais na query
string, e ao lado uma caixa "incluir CPF completo" que acrescenta
`cpfCompleto=true`, com o texto de apoio:

> O arquivo sai do sistema e não há como recolhê-lo. A exportação fica registrada.

- [ ] **Step 6: Conferir tudo**

Run: `npm run typecheck && npm run lint && npm test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/leads/exportar "src/app/(admin)/admin/leads/page.tsx"
git commit -m "feat: exportar a base de leads em CSV, com registro de auditoria

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Autorrevisão do plano

**Cobertura do spec**

| Requisito do spec | Task |
|---|---|
| Modelos `Lead` e `LeadOrigem`, enum `OrigemLead` | 1 |
| Índice único com `NULLS NOT DISTINCT` | 1, Step 3 |
| `LEAD_FINGERPRINT_KEY` no schema de ambiente | 2 |
| HMAC em vez de SHA-256 puro | 2 |
| Normalização de CPF, telefone (sem DDI) e e-mail | 2 |
| Cascata CPF → telefone → e-mail | 3 |
| Fusão, com o absorvido apagado antes da reatribuição | 3 |
| CPF nunca em claro | 3 (teste), 6 (listagem) |
| Precedência de campos e nome do envio vencendo o da conversa | 3 |
| Ingestão nos três fluxos, sem derrubar o chamador | 4 |
| Fora da transação em `emitirEtiqueta` | 4, Step 4 |
| Envio sandbox não vira lead | 4 |
| Carga inicial idempotente, em ordem cronológica | 5 |
| Lista com filtros e paginação | 6, 7 |
| Busca por CPF comparando impressão digital | 6 |
| Detalhe com histórico | 6, 7 |
| CPF completo só no detalhe, com `AuditLog` | 6, 7 |
| Aba na navegação administrativa | 7 |
| 404 e não 403 | 7 |
| CSV com CPF mascarado por padrão e exportação registrada | 8 |
| CSV leva todas as linhas do filtro, não só a primeira página | 6 (`todas`), 8 |

Sem lacunas.

**Consistência de tipos**

`registrarLead(entrada: EntradaLead): Promise<string | null>` é usada com essa
assinatura nas Tasks 4, 5 e 6. `LeadResumo` é definido na Task 6 Step 1 e
estendido por `LeadDetalhe` no Step 4 da mesma task. `FiltroLeads` é consumido
pelas Tasks 7 e 8 com os mesmos nomes de campo.

**Fora de escopo, registrado**

Exclusão de lead pela tela, conforme decidido no spec. O modelo já suporta por
cascata quando for acrescentada.

**Ponto que exige atenção na execução**

A Task 4, Step 4 reestrutura o `return` de `emitirEtiqueta`, que é o caminho
crítico da emissão e tem testes próprios em
`src/server/emitir-etiqueta-service.test.ts`. Rode a suíte inteira antes do
commit dessa task, não só o teste novo.

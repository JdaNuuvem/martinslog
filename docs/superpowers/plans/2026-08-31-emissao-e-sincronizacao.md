# Emissão da etiqueta e sincronização da simulação — Plano

Fecha dois itens pedidos pelo dono do produto em 31/08/2026:

- **Item 2 — gerar código de rastreio.** Hoje o código existe como função e ninguém a chama.
- **Item 4 — status atualizado conforme configuração do painel.** Hoje o motor de roteiro
  existe e nada o liga ao banco nem ao painel.

Base já pronta e **não** reescrita por este plano: `src/domain/shipment/codigo-rastreio.ts`,
`src/server/codigo-rastreio-service.ts`, `src/domain/simulacao/roteiro.ts`,
`src/server/simulacao-config.ts`, `src/server/rastreio-service.ts`,
`src/domain/shipment/estados.ts`.

Referências: `docs/superpowers/specs/2026-08-31-simulacao-transporte.md` (seções 1, 2, 5, 6, 8)
e `docs/superpowers/plans/2026-08-30-fase-1-nucleo-transacional.md` (Tasks 14, 16, 17).

## Fronteira com as outras sessões

Acordado com a frete-1a e a frete-32 em 31/08:

- **Deste plano:** `emitir-etiqueta-service.ts`, `POST /api/envios/[id]/etiqueta`,
  sincronização de status, serviços e rotas administrativas da simulação, telas da simulação.
- **Da frete-1a:** `src/infra/labels/etiqueta-pdf.ts`, `GET /api/envios/[id]/etiqueta`
  (`application/pdf`), o gancho após o commit de `pagarEnvio`, `POST /api/envios`,
  `(app)/envios/novo`, `src/server/shipment-service.ts`.
- **Da frete-32:** painel administrativo geral (Task 17), fora dos controles da simulação.

`Shipment.labelUrl` fica intocada aqui — quem a preenche é a frete-1a.

## Restrições globais

- TDD: teste primeiro, confirmar vermelho, implementar, confirmar verde. Sem exceção nos
  itens de dinheiro e de concorrência.
- Banco de teste próprio desta sessão (`frete_test_3d` via `DATABASE_URL_TEST`), para que
  teste vermelho signifique bug e não corrida entre sessões.
- Nada de job, cron ou fila: o roteiro inteiro nasce na emissão, já datado no futuro
  (spec seção 1). A consulta corta por relógio.
- Toda intervenção administrativa grava `AuditLog` com ator, envio, antes e depois.
- Ao final de cada task: `npx tsc --noEmit`, `npx eslint .`, suíte inteira.

---

# Item 2 — Emissão da etiqueta

### Task A: Serviço de emissão

**Arquivos:** criar `src/server/emitir-etiqueta-service.ts` e
`src/server/emitir-etiqueta-service.test.ts`.

**Interface produzida** (contrato já combinado com a frete-1a, que a chama no gancho de
pagamento):

```ts
export async function emitirEtiqueta(shipmentId: string): Promise<{ codigoRastreio: string }>
```

Sem `userId`: o gancho roda depois de `pagarEnvio`, que já provou a posse, e o admin também
emite. A checagem de dono fica na rota HTTP.

- [ ] **Passo 1 — escrever os testes**

  1. Emite: envio em `RELEASED` passa a `GENERATED`, ganha `codigoRastreio` casando com
     `/^[A-Z]{2}\d{9}BR$/`, `geradoEm`, `simulacaoIniciadaEm` e `fatorSimulacao` preenchidos.
  2. Grava a timeline inteira do cenário do envio, com `sequencia` de 1..n e
     `offsetMinutos` crescentes.
  3. **Só o primeiro evento é visível na emissão.** `ETIQUETA_EMITIDA` tem offset 0, os
     demais estão no futuro — logo `rastrearEnvio` imediatamente após a emissão devolve
     exatamente um evento.
  4. **Copia o fator, não o referencia.** Emitir com `fatorVelocidade` global 1, depois
     mudar o global para 288, e conferir que `Shipment.fatorSimulacao` do envio antigo
     continua 1 e as datas dos eventos não se moveram (spec seção 2).
  5. **Idempotência.** Duas chamadas seguidas: a segunda lança `TransicaoInvalidaError`, o
     envio fica com um código só e a contagem de `TrackingEvent` não muda.
  6. Envio em `PENDING` (não pago) recusa com `TransicaoInvalidaError` e não gera código.
  7. Envio inexistente lança `EnvioNaoEncontradoError`.
  8. **Origem e destino na mesma cidade não geram duas transferências** (spec seção 8) —
     asserção sobre a timeline persistida, não só sobre o roteiro puro.
  9. Falha ao gravar os eventos não deixa envio com código e sem timeline: forçar erro no
     meio e conferir que nada foi commitado (o sequencial consumido se perde, e isso é aceito).

- [ ] **Passo 2 — rodar e confirmar vermelho**

  `DATABASE_URL_TEST=... npx vitest run src/server/emitir-etiqueta-service.test.ts`

- [ ] **Passo 3 — implementar**

  Uma transação, nesta ordem:

  1. `findUnique` do envio com `service: { select: { codigo, prazoBase, nome } }`.
  2. `garantirTransicao(envio.status, 'GENERATED')` — **antes** de qualquer escrita, é o que
     dá a idempotência sem `if` de ocasião.
  3. `obterConfigSimulacao(tx)` — lê `fatorVelocidade` e `operador` dentro da transação.
  4. `atribuirCodigoRastreio(tx, shipmentId)`.
  5. `gerarRoteiro({ cenario, prazoDias, origem, destino, operador })`. Origem e destino
     saem de `Shipment.remetente`/`destinatario` (cópia JSON, campos `cidade`/`uf`).
  6. `createMany` dos `TrackingEvent`, cada `ocorridoEm` via
     `calcularOcorridoEm(simulacaoIniciadaEm, offsetMinutos, fator)`.
  7. `update` do envio: `status: 'GENERATED'`, `geradoEm`, `simulacaoIniciadaEm`,
     `fatorSimulacao`.

  `simulacaoIniciadaEm` é um único `new Date()` capturado no início e reusado — dois relógios
  na mesma emissão produziriam offsets inconsistentes.

- [ ] **Passo 4 — rodar e confirmar verde**

- [ ] **Passo 5 — commit**

  `git add src && git commit -m "feat: emissão da etiqueta com código de rastreio e timeline simulada"`

### Task B: Rota de emissão

**Arquivos:** criar `src/app/api/envios/[id]/etiqueta/route.ts` (só `POST`; o `GET` do PDF é
da frete-1a, mesmo arquivo — coordenar antes de escrever) e o teste ao lado.

- [ ] **Passo 1 — testes**

  Sem sessão devolve 401. Envio de outro usuário devolve **404, nunca 403** (mesmo padrão de
  `enderecos-service`: o chamador não distingue "não existe" de "não é seu"). Envio não pago
  devolve 409 com código de erro estável. Sucesso devolve 200 com `codigoRastreio`. Segunda
  chamada devolve 409 e não altera nada.

- [ ] **Passo 2 — vermelho; Passo 3 — implementar; Passo 4 — verde**

  Mapeamento de erro de domínio para HTTP igual ao das rotas existentes.

- [ ] **Passo 5 — commit**

  `git add src && git commit -m "feat: rota de emissão de etiqueta"`

**Critério de pronto do item 2:** um envio pago vira código de rastreio consultável em
`/r/[codigo]`, com timeline nascida e o primeiro evento visível.

---

# Item 4 — Status conforme o painel

### Task C: Sincronização do status pelo relógio

O status do `Shipment` é **derivado do último evento visível**, nunca escrito à mão em
paralelo (spec seção 5). Hoje `rastreio-service.ts` já deriva na leitura pública, mas não
persiste — e é a persistência que dispara o estorno de extravio.

**Arquivos:** criar `src/server/sincronizar-envio-service.ts` e seu teste.

```ts
export async function sincronizarEnvio(shipmentId: string, agora?: Date): Promise<StatusShipment>
```

- [ ] **Passo 1 — testes**

  1. Envio emitido com fator alto: avançando `agora`, o status caminha
     `GENERATED → POSTED → DELIVERED`, respeitando o mapa da spec seção 5.
  2. **Fator de velocidade:** com fator 1440, evento de offset de um dia ocorre em um minuto.
  3. **`EXTRAVIADO` credita a carteira exatamente uma vez, mesmo sincronizando duas vezes**
     — a garantia vem do `@@unique([refTipo, refId, tipo])` do `LedgerEntry`, não de um `if`.
  4. **`DEVOLVIDO` não credita.**
  5. **Envio cancelado não avança**, nem com o relógio muito à frente.
  6. **Sincronização concorrente:** duas chamadas simultâneas não duplicam evento nem
     lançamento (`Promise.allSettled`, mesmo padrão do teste de `pagarEnvio`, com
     `SELECT ... FOR UPDATE` na carteira quando houver estorno).
  7. Transição inválida não corrompe: respeita `garantirTransicao`.

- [ ] **Passo 2 — vermelho; Passo 3 — implementar; Passo 4 — verde**

  Chamar `sincronizarEnvio` na leitura de envio e na listagem (dentro de transação), como diz
  a spec. Ponto de atenção: a listagem não pode virar N+1 de transações — sincronizar em lote
  ou só os envios cujo próximo evento já venceu.

- [ ] **Passo 5 — commit**

  `git add src && git commit -m "feat: sincronização do status do envio pelo relógio da simulação"`

### Task D: Serviços administrativos da simulação

**Arquivos:** criar `src/server/admin/simulacao.ts` e seu teste.

```ts
export async function definirFatorVelocidade(actorUserId: string, fator: number): Promise<void>
export async function trocarCenario(actorUserId: string, shipmentId: string, cenario: CenarioSimulacao): Promise<void>
export async function forcarProximoEvento(actorUserId: string, shipmentId: string): Promise<void>
export async function reiniciarLinhaDoTempo(actorUserId: string, shipmentId: string): Promise<void>
```

- [ ] **Passo 1 — testes**

  1. `definirFatorVelocidade` recusa zero, negativo e não inteiro (`ValorInvalidoError`), e
     **não altera envios já em curso** (asserção sobre `fatorSimulacao` e sobre as datas dos
     eventos de um envio pré-existente).
  2. `trocarCenario` **preserva os eventos passados e substitui só os futuros** (spec seção
     6) — reescrever passado que o cliente já viu é mentir para ele. Asserção: os `id` dos
     eventos passados sobrevivem.
  3. `forcarProximoEvento` antecipa o próximo pendente para agora com `forcado = true` e
     **desloca os seguintes pelo mesmo intervalo** (a timeline não se embaralha).
  4. `reiniciarLinhaDoTempo` apaga os eventos e regenera a partir de agora.
  5. **Todas as quatro gravam `AuditLog`** com ator, entidade, antes e depois.
  6. Envio já entregue ou cancelado: definir o comportamento e testá-lo (proposta: recusar
     `forcarProximoEvento` e `trocarCenario`, permitir `reiniciarLinhaDoTempo`).

- [ ] **Passo 2 — vermelho; Passo 3 — implementar; Passo 4 — verde**

- [ ] **Passo 5 — commit**

  `git add src && git commit -m "feat: controles administrativos da simulação de transporte"`

### Task E: Rotas administrativas

**Arquivos:** criar `src/app/api/admin/simulacao/route.ts` (fator global),
`src/app/api/admin/envios/[id]/simulacao/route.ts` (cenário, forçar, reiniciar) e os testes.

- [ ] **Passo 1 — testes**

  Cliente autenticado e anônimo recebem **404** em todas elas, via `exigirAdmin` — chamada
  direta à API, não navegação (Task 17, passo 1). Corpo inválido devolve 400 por schema Zod
  em `src/lib/simulacao-schema.ts`. Sucesso devolve 200 e grava `AuditLog`.

- [ ] **Passo 2 — vermelho; Passo 3 — implementar; Passo 4 — verde**

- [ ] **Passo 5 — commit**

  `git add src && git commit -m "feat: rotas administrativas da simulação"`

### Task F: Telas

**Arquivos:** criar `src/app/(admin)/admin/simulacao/page.tsx` e
`src/app/(admin)/admin/envios/[id]/page.tsx` (coordenar com a frete-32, dona da listagem de
envios do painel).

- [ ] **Passo 1 — construir**

  Fator global com os presets da spec (1 = tempo real, 24 = um dia por hora, 288 = um dia
  em cinco minutos) e o aviso explícito de que só vale para envios novos. Por envio: timeline
  atual com passado e futuro separados visualmente, troca de cenário, forçar próximo evento e
  reiniciar (este com confirmação, conforme a spec).

- [ ] **Passo 2 — commit**

  `git add src && git commit -m "feat: telas administrativas da simulação"`

---

## Critério de conclusão

- [ ] Envio pago rende código de rastreio consultável sem login em `/r/[codigo]`.
- [ ] Timeline nasce inteira na emissão; evento futuro nunca aparece, nem esmaecido.
- [ ] Mudar o fator global não move a linha do tempo de quem já está em trânsito.
- [ ] Com fator 288, um envio de 5 dias completa em ~25 minutos, sem nenhum job.
- [ ] Extravio credita a carteira uma única vez; devolução não credita.
- [ ] Cliente recebe 404 em toda rota administrativa da simulação.
- [ ] Toda intervenção administrativa aparece no `AuditLog`.
- [ ] `tsc` limpo, `eslint` limpo, suíte verde em banco próprio.

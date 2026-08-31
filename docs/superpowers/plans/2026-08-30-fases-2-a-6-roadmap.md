# Fases 2 a 6 — Roadmap de Implementação

> **For agentic workers:** este documento está em granularidade de **tarefa**, não de passo. Antes de executar qualquer fase, refine-a em um plano próprio em granularidade de passo TDD usando superpowers:writing-plans, em `docs/superpowers/plans/YYYY-MM-DD-fase-N-<nome>.md`. Refinar antes da execução, e não agora, é deliberado: as assinaturas exatas só existem depois que a fase anterior roda.

**Spec:** `docs/superpowers/specs/2026-08-30-plataforma-frete-design.md`
**Fase anterior:** `docs/superpowers/plans/2026-08-30-fase-1-nucleo-transacional.md`

## Global Constraints

Valem todas as restrições globais da Fase 1: Node 22, pnpm, TypeScript strict, `src/domain/` sem I/O, dinheiro em centavos inteiros, peso em gramas inteiras, CEP normalizado com 8 dígitos, Zod na borda, erros de domínio tipados, cobertura ≥ 80%, interface em português com acentuação correta, conventional commits em português.

---

# Fase 2 — Volume

**Objetivo:** permitir que quem despacha dezenas de pedidos por dia pague e imprima tudo de uma vez.

**Por que agora:** sem carrinho, quem faz 20 envios paga 20 vezes. É o primeiro gargalo real de quem vira cliente pesado.

### Tarefa 2.1: Domínio do carrinho

**Arquivos:** criar `src/domain/cart/carrinho.ts` e o teste ao lado.

**Produz:**
- `totalCarrinho(itens: { precoCobradoCentavos: number }[]): number`
- `garantirCarrinhoPagavel(itens: ItemCarrinho[]): void` — lança `CarrinhoVazioError` se vazio, `TransicaoInvalidaError` se algum item não está em `PENDING`

**Aceite:** total de carrinho vazio lança erro; total soma em inteiros sem perda de centavo; item já pago no carrinho impede o checkout inteiro.

### Tarefa 2.2: Modelo e checkout multi-etiqueta

**Arquivos:** modificar `prisma/schema.prisma` (adicionar `Cart`, `Shipment.cartId`), criar `src/server/cart-service.ts`.

**Consome:** `aplicarDebito` (Fase 1, Task 10), `garantirTransicao` (Fase 1, Task 12), o padrão de `SELECT ... FOR UPDATE` de `pagarEnvio` (Fase 1, Task 13).

**Produz:** `checkoutCarrinho(userId: string, cartId: string): Promise<void>` — um único `LedgerEntry` de débito com o total, todos os envios movidos para `RELEASED`, tudo em uma transação.

**Aceite:** um débito só para N envios; saldo insuficiente não move nenhum envio; teste de concorrência com dois checkouts simultâneos do mesmo usuário, análogo ao da Fase 1.

### Tarefa 2.3: Impressão em lote

**Arquivos:** modificar `src/infra/labels/etiqueta-pdf.ts`, criar `src/app/api/etiquetas/lote/route.ts`.

**Produz:** `gerarLotePdf(shipmentIds: string[], formato: 'TERMICA'|'A4'): Promise<Uint8Array>`

**Aceite:** 300 envios em A4 geram 75 páginas; envio de outro usuário na lista aborta a requisição inteira com 404; PDF de 300 etiquetas gera em menos de 10 segundos.

### Tarefa 2.4: Cancelamento com estorno

**Arquivos:** modificar `src/server/shipment-service.ts`, criar `src/app/api/envios/[id]/cancelar/route.ts`.

**Consome:** `podeCancelar`, `deveEstornar` (Fase 1, Task 12), `aplicarCredito` (Fase 1, Task 10).

**Aceite:** cancelar envio pago credita a carteira e grava novo `LedgerEntry` sem apagar o débito original; cancelar envio em `POSTED` devolve 422 com `CANCELAMENTO_NAO_PERMITIDO`; cancelar duas vezes credita uma vez só (idempotência).

### Tarefa 2.5: Filtros, busca e paginação

**Arquivos:** modificar `src/app/(app)/etiquetas/page.tsx` e a rota GET de envios.

**Aceite:** filtro por status, período e serviço; busca por código, nome do destinatário e CEP; paginação por cursor com total; consulta de 10.000 envios responde em menos de 300ms com os índices da Fase 1.

### Tarefa 2.6: Importação de tabela por planilha

**Arquivos:** modificar `src/server/admin/importar-tabela.ts`.

**Aceite:** aceita `.csv` e `.xlsx`; pré-visualização das 20 primeiras linhas antes de confirmar; importação é atômica — uma linha inválida aborta tudo relatando a linha; importar nova vigência não apaga a anterior, apenas encerra `vigenteAte`.

---

# Fase 3 — Multi-transportadora

**Objetivo:** paridade com a tela de resultado do SuperFrete: várias transportadoras, opcionais precificados e pontos de postagem.

### Tarefa 3.1: Opcionais precificados por linha

**Arquivos:** criar `src/domain/pricing/opcionais.ts`, modificar `cotacao.ts` e o schema.

**Produz:** `calcularOpcionais(base: OpcaoPreco, opcionais: Opcionais, regra: RegraOpcionais): ValoresOpcionais` — `{ valorDeclaradoCentavos, maoPropriaCentavos, avisoRecebimentoCentavos, totalCentavos }`

**Regra:** seguro é percentual sobre o valor declarado com piso; mão própria e aviso de recebimento são valores fixos por serviço. Cada linha da cotação soma os seus próprios opcionais — não existe opcional aplicado ao total, como observado na API do SuperFrete.

**Aceite:** valor declarado zero não cobra seguro; seguro respeita o piso; opcional indisponível no serviço não é cobrado e a interface não o oferece.

### Tarefa 3.2: Transportadoras e serviços configuráveis

**Arquivos:** modificar seed, criar `src/app/(admin)/admin/transportadoras/**`.

**Aceite:** admin cria transportadora e serviço com limites de peso e dimensão, prazo base e regras de opcionais; desativar serviço o remove da cotação sem apagar histórico de envios já feitos.

### Tarefa 3.3: Restrições dimensionais com observação

**Arquivos:** modificar `src/domain/pricing/cotacao.ts`.

**Aceite:** serviço com limite de dimensão excedido aparece na lista com `disponivel: false` e observação citando os limites exatos, no formato do SuperFrete: *"certifique-se de que a embalagem possui medidas iguais ou inferiores a 4cm x 16cm x 24cm e até 300g"*. Nunca sumir da lista em silêncio.

### Tarefa 3.4: Pontos de postagem (PUDO)

**Arquivos:** criar `src/domain/geo/distancia.ts`, `src/server/pudo-service.ts`, `src/app/(admin)/admin/pontos/**`; modificar o schema (`Pudo`, `Shipment.pontoPostagemId`).

**Produz:**
- `distanciaKm(a: Coordenada, b: Coordenada): number` — Haversine
- `pontosMaisProximos(pontos: Pudo[], origem: Coordenada, carrierSlug: string, limite: number): PudoComDistancia[]`

**Aceite:** Haversine validado contra pares de coordenadas conhecidos com tolerância de 1%; devolve no máximo 10 pontos ordenados por distância crescente; filtra por transportadora aceita no ponto; serviço com `exigePudo` não deixa criar envio sem ponto escolhido; a interface mostra endereço, horário de funcionamento e distância, com o aviso *"Poste no local selecionado para garantir o melhor preço"*.

### Tarefa 3.5: Geocodificação de CEP

**Arquivos:** modificar `src/infra/geo/*`.

**Aceite:** CEP resolve para lat/lon com cache persistente — o mesmo CEP não bate no provedor externo duas vezes; falha de geocodificação degrada com elegância (a cotação sai, os pontos de postagem não aparecem, e a interface diz por quê).

---

# Fase 4 — Integrações

**Objetivo:** API pública compatível com os contratos do SuperFrete, para que plugins de terceiros funcionem trocando a base URL.

### Tarefa 4.1: Tokens de API

**Arquivos:** criar `src/server/api-token-service.ts`, `src/app/(app)/integracoes/page.tsx`; modificar o schema (`ApiToken`).

**Aceite:** token gerado com 32 bytes aleatórios criptograficamente seguros, armazenado só como hash; o valor em claro aparece uma única vez, na criação; ambientes sandbox e produção separados, com dados isolados; token revogado devolve 401 imediatamente; rate limit por token.

### Tarefa 4.2: Endpoints públicos

**Arquivos:** criar `src/app/api/v0/**`.

**Produz** — contratos idênticos aos analisados no SuperFrete:

```
POST /api/v0/calculator      → [{ id, name, price, discount, delivery_time, ... }]
POST /api/v0/cart            → { id, price, status }
POST /api/v0/checkout        → { success, purchase: { status, orders: [...] } }
GET  /api/v0/order/info/:id  → objeto completo do envio
GET  /api/v0/tag/:id         → { url }
GET  /api/v0/tag/list        → lista paginada
POST /api/v0/order/cancel    → { success }
GET  /api/v0/user/addresses  → lista
GET  /api/v0/user/info       → dados e saldo
```

**Aceite:** testes de contrato afirmam a forma exata do JSON, campo a campo; ambiente sandbox não debita saldo real; toda rota exige `Authorization: Bearer`; erro segue o formato `{ codigo, mensagem }` documentado.

### Tarefa 4.3: Webhooks

**Arquivos:** criar `src/server/webhook-service.ts`, `src/app/api/v0/webhook/**`; modificar o schema (`WebhookApp`, `WebhookDelivery`).

**Eventos:** `order.created`, `order.released`, `order.generated`, `order.posted`, `order.delivered`, `order.cancelled`.

**Aceite:** payload no formato do SuperFrete, com `tracking` e `tracking_url` nulos antes de `order.generated`; assinatura HMAC-SHA256 no header, com procedimento de verificação documentado; retentativa exponencial (1min, 5min, 30min, 2h, 12h) e desistência após 5 falhas; entregas registradas em `WebhookDelivery`; endpoint que responde 500 não trava a fila dos outros.

### Tarefa 4.4: Documentação da API

**Arquivos:** criar `docs/api/**`, `src/app/(publico)/docs/page.tsx`.

**Aceite:** cada endpoint com exemplo de requisição e resposta reais, copiáveis; guia de primeiros passos com autenticação e ambiente sandbox; tabela de códigos de erro.

---

# Fase 5 — Crescimento

**Objetivo:** retenção e aquisição — o que faz o cliente voltar e trazer outro.

### Tarefa 5.1: Indicação

**Arquivos:** criar `src/server/referral-service.ts`, `src/app/(app)/indique/page.tsx`; modificar o schema (`Referral`).

**Aceite:** código único por usuário; crédito para os dois lados só quando o indicado paga o **primeiro** envio, nunca no cadastro (senão vira fraude de cadastro em massa); autoindicação bloqueada; crédito idempotente; teste explícito de que o mesmo indicado não credita duas vezes.

### Tarefa 5.2: Cupons

**Arquivos:** criar `src/domain/pricing/cupom.ts`, modificar checkout; schema (`Coupon`).

**Produz:** `aplicarCupom(totalCentavos: number, cupom: Cupom): { descontoCentavos: number; totalFinalCentavos: number }`

**Aceite:** percentual e valor fixo; desconto nunca ultrapassa o total (mínimo zero, nunca negativo); limite de usos respeitado sob concorrência (contador com lock); cupom expirado devolve erro claro.

### Tarefa 5.3: Notificações

**Arquivos:** criar `src/infra/notifications/**`, `src/server/notification-service.ts`; schema (`Notification`).

**Produz:** `interface NotificationProvider { enviar(destino: string, template: string, dados: object): Promise<void> }` — implementações `Console` (desenvolvimento), `Email`, `WhatsApp`.

**Aceite:** cada mudança de status dispara notificação ao destinatário quando houver contato; falha de envio não quebra a transição de status (fila, não caminho crítico); usuário controla quais notificações recebe; toda notificação registrada com resultado.

### Tarefa 5.4: Relatórios

**Arquivos:** criar `src/app/(app)/relatorios/page.tsx`, `src/server/relatorio-service.ts`.

**Aceite:** economia acumulada (soma de `descontoCentavos`), volume por período, gasto por transportadora e ticket médio; exportação CSV; consultas agregadas usam índice e respondem em menos de 1s com 100.000 envios.

*Observação sobre gamificação:* o SuperFrete tem níveis e pontos (`level`, `superpoints`). Deixei fora por decisão de prioridade — é o item de menor retorno por esforço de tudo que eles têm, e não muda a economia do cliente. Se quiser, entra como Tarefa 5.5 depois que os relatórios mostrarem quem são os clientes de alto volume.

---

# Fase 6 — Integração real

**Objetivo:** trocar o simulado pelo real. Nenhuma mudança de domínio prevista — só novas implementações das interfaces já existentes.

### Tarefa 6.1: Integração da transportadora

**Arquivos:** criar `src/infra/carriers/<transportadora>.ts`.

**Consome:** a interface `CarrierProvider` definida na Fase 1.

**Aceite:** cotação e emissão reais atrás da mesma interface; timeout e retentativa configurados; falha da transportadora degrada para a tabela própria em vez de derrubar a cotação; todos os testes de domínio continuam passando sem alteração — se algum precisar mudar, o isolamento da Fase 1 falhou e isso precisa ser investigado antes de seguir.

### Tarefa 6.2: Pix real

**Arquivos:** criar `src/infra/payments/pix-real.ts`.

**Aceite:** QR dinâmico com expiração; webhook do provedor confirma e credita de forma idempotente (mesma confirmação duas vezes credita uma); conciliação diária entre extrato do provedor e `LedgerEntry`, com relatório de divergência; segredos apenas em variáveis de ambiente.

### Tarefa 6.3: Rastreio real

**Arquivos:** modificar `src/server/tracking-service.ts`.

**Aceite:** ingestão por webhook da transportadora quando existir, com sincronização periódica como reserva; evento duplicado não duplica na timeline; status desconhecido da transportadora é registrado sem quebrar a máquina de estados, e alerta o admin.

### Tarefa 6.4: Preparação para produção

**Aceite:** backup automatizado com restauração testada de verdade (restaurar em base limpa e conferir integridade, não apenas agendar o dump); monitoramento com alerta de erro; logs estruturados sem dado pessoal; revisão de segurança completa; teste de carga no checkout; plano de retorno documentado.

---

## Ordem e dependências

```
Fase 1  ──▶ Fase 2 ──▶ Fase 3 ──▶ Fase 4 ──▶ Fase 5
                              └──────────────▶ Fase 6
```

A Fase 6 depende da Fase 3 (transportadoras configuráveis), não das Fases 4 e 5. Se o contrato com API real aparecer antes do previsto, ela pode ser antecipada, deixando integrações e crescimento para depois.

## Refinamento antes de executar

Ao iniciar cada fase, gerar o plano em granularidade de passo a partir das tarefas acima, com as assinaturas reais do código já existente. Cada tarefa deste roadmap vira de 4 a 8 passos TDD.

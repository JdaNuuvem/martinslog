# Plataforma de Frete — Design (paridade SuperFrete)

Data: 2026-08-30
Status: aguardando revisão

## 1. Objetivo

Construir plataforma web de gestão de envios com paridade funcional ao SuperFrete
(`web.superfrete.com`): cotação pública com desconto, carteira pré-paga, emissão de
etiqueta com declaração de conteúdo, carrinho multi-etiqueta, rastreio, pontos de
postagem, integrações e programa de indicação.

Público-alvo: vendedor pessoa física (CPF) de Shopee/Instagram/WhatsApp, sem CNPJ,
volume baixo a médio, pouca familiaridade com logística.

## 2. Contexto e restrições

- A empresa tem contrato com transportadora privada, **sem API disponível**.
- Nesta etapa **tudo é simulado**: tarifa vem de tabela própria, etiqueta é gerada por
  nós, código de rastreio é nosso, pagamento não movimenta dinheiro real.
- Consequência de projeto: toda dependência externa fica atrás de uma interface, com
  implementação simulada hoje e implementação real depois, sem reescrita de domínio.
- Superfície: web app responsivo. Sem app nativo.

## 3. Decisões de arquitetura

**Stack:** Next.js (App Router) + TypeScript + Prisma + PostgreSQL, deploy único.
Escolhido sobre API separada (dobra a configuração para um ganho que só aparece na
fase de plugins) e sobre BaaS (a carteira exige transação atômica em código próprio,
não espalhada entre RLS e edge functions).

**Camadas:**

```
src/domain/      regra de negócio pura, sem I/O, sem Prisma, sem Next
  pricing/       peso cubado, faixa de CEP, desconto, opcionais
  wallet/        débito, crédito, estorno, ledger
  shipment/      máquina de estados
  cart/          agrupamento e checkout
src/app/         rotas Next (UI + route handlers)
src/infra/
  db/            Prisma
  carriers/      CarrierProvider  → MockCarrier | JadlogCarrier | CorreiosCarrier
  payments/      PaymentProvider  → SimulatedPix | PixReal
  geo/           GeoProvider      → ViaCEP + geocoder
  labels/        gerador de PDF
  notifications/ NotificationProvider → Console | Email | WhatsApp
```

Regra dura: `src/domain/` não importa `@prisma/client` nem nada de `next`.
Toda entrada externa validada com Zod na borda.

**Dinheiro:** sempre inteiro em centavos. Nunca ponto flutuante.

## 4. Modelo de dados

```
User            id, tipo(PF|PJ), documento(unique), nome, email(unique), senhaHash,
                telefone, emailVerificadoEm, criadoEm
Session         id, userId, expiraEm, userAgent, ip
AnonSession     id, criadoEm            -- cotação sem login

Address         id, userId, apelido, cep, logradouro, numero, complemento, bairro,
                cidade, uf, latitude, longitude, tipo(REMETENTE|DESTINATARIO),
                padrao(bool), documento, nome, email, telefone

Carrier         id, nome, slug, ativo, logoUrl
Service         id, carrierId, codigo, nome, prazoBase, exigePudo(bool),
                entregaSabado(bool), limitePesoG, limiteDimensoes(json), ativo

PriceRule       id, serviceId, cepOrigemIni, cepOrigemFim, cepDestinoIni,
                cepDestinoFim, pesoMinG, pesoMaxG,
                precoBalcaoCentavos,   -- tabela pública, referência do desconto
                precoCustoCentavos,    -- nosso custo com a transportadora
                precoVendaCentavos,    -- o que cobramos
                prazoDias, ativo, vigenteDe, vigenteAte

Pudo            id, nome, cep, logradouro, numero, bairro, cidade, uf,
                latitude, longitude, horarioFuncionamento, carriers(json), ativo

Quote           id, userId?, anonSessionId?, cepOrigem, cepDestino, formato,
                pesoG, altura, largura, comprimento, diametro,
                pesoCubadoG, pesoTaxavelG, opcionais(json),
                opcoes(json), expiraEm, criadoEm

Cart            id, userId, status(OPEN|PAID|CANCELLED), criadoEm, pagoEm
Shipment        id, userId, cartId?, quoteId?, serviceId, codigoRastreio(unique, null
                até GENERATED), status, remetente(json), destinatario(json),
                pontoPostagemId?, precoBalcaoCentavos, precoCobradoCentavos,
                descontoCentavos, opcionais(json), valorDeclaradoCentavos,
                produtos(json), labelUrl, dceNumero,
                criadoEm, pagoEm, geradoEm, postadoEm, entregueEm, canceladoEm

Wallet          id, userId(unique), saldoCentavos
LedgerEntry     id, walletId, tipo(CREDITO|DEBITO), valorCentavos, saldoAposCentavos,
                refTipo, refId, descricao, criadoEm         -- append-only, imutável
PaymentIntent   id, userId, valorCentavos, metodo(PIX|CARTAO), status, qrCode,
                expiraEm, confirmadoEm

TrackingEvent   id, shipmentId, status, descricao, local, ocorridoEm

ApiToken        id, userId, nome, tokenHash, ambiente(SANDBOX|PROD), ultimoUsoEm,
                revogadoEm
WebhookApp      id, userId, url, eventos(json), segredo, ativo
WebhookDelivery id, webhookAppId, evento, payload(json), tentativas, statusHttp,
                entregueEm

Referral        id, userId, codigo(unique), indicadoPorUserId?, recompensaCentavos,
                creditadoEm
Coupon          id, codigo(unique), tipo(PERCENTUAL|FIXO), valor, usosMax, usosFeitos,
                validoAte, ativo

Notification    id, userId, canal(EMAIL|PUSH|WHATSAPP), template, payload(json),
                enviadoEm, erro
AuditLog        id, actorUserId, acao, entidade, entidadeId, antes(json), depois(json),
                criadoEm
```

## 5. Regras de domínio

### 5.1 Cotação

1. Normaliza CEPs, resolve endereço e coordenadas via `GeoProvider`.
2. Peso cubado: `(altura × largura × comprimento) / 6000` em kg. Para rolo, usa
   diâmetro conforme fórmula do serviço.
3. Peso taxável: `max(pesoReal, pesoCubado)`.
4. Para cada `Service` ativo, busca `PriceRule` vigente cobrindo ambos os CEPs e a
   faixa de peso taxável.
5. Aplica opcionais por linha: `valorDeclarado`, `maoPropria`, `avisoRecebimento` —
   cada um com valor próprio por serviço, somado ao preço daquela linha.
6. Serviço cujo limite de peso ou dimensão é excedido **não some da lista**: retorna com
   `observacao` explicando a restrição. Copiado do SuperFrete, e é a decisão certa —
   sumir sem explicação faz o usuário achar que o sistema quebrou.
7. Se o serviço exige PUDO, anexa os 10 pontos mais próximos da origem, ordenados por
   distância (Haversine sobre lat/lon).
8. Retorna, por opção: `precoBalcao`, `precoFinal`, `descontoValor`, `descontoPercentual`,
   `prazoDias`, `exigePudo`, `pudos[]`, `observacao`, `carrier`, `logoUrl`.
9. Cotação **não exige login**. Vale 24h com preço travado, vinculada a `AnonSession` ou
   a `userId`. No cadastro, a `AnonSession` é migrada para o usuário.

### 5.2 Carteira

Ledger append-only. Saldo é campo materializado em `Wallet`, sempre escrito junto com a
entrada de ledger na mesma transação. Nada de recalcular saldo somando o ledger em
tempo de leitura, e nada de atualizar saldo sem gravar a entrada.

**Não há estorno automático em nenhuma situação** (decisão do usuário, 2026-08-31). Envio
extraviado, cancelado antes da postagem ou cancelado depois dela **não** devolve valor à
carteira. O débito feito no pagamento é definitivo.

Consequência de projeto, e é o motivo de a regra estar escrita aqui: o único caminho que
credita a carteira passa a ser a recarga confirmada por administrador. Nenhum evento de
rastreio, cancelamento ou sincronização move dinheiro. Isso elimina a classe inteira de
defeitos de crédito duplicado por retentativa ou por corrida, e torna o ledger de crédito
auditável por uma única origem.

Se um caso concreto exigir devolução, ela acontece como **crédito manual administrativo**,
com justificativa registrada em `AuditLog` — visível, rastreável e decidido por uma pessoa.

### 5.3 Carrinho e checkout

`Cart` agrupa N `Shipment` em status `PENDING`. O checkout é uma transação única:

```
BEGIN
  SELECT wallet WHERE userId = ? FOR UPDATE     -- lock pessimista
  total := soma dos shipments do carrinho
  se saldo < total → ROLLBACK, erro SALDO_INSUFICIENTE
  INSERT LedgerEntry (DEBITO, saldoApos, ref = cartId)
  UPDATE Wallet
  UPDATE Shipment SET status = 'RELEASED', pagoEm = now()
  UPDATE Cart SET status = 'PAID', pagoEm = now()
COMMIT
```

O `FOR UPDATE` é o que impede saldo negativo sob duas requisições simultâneas.

Após o commit, um job gera etiqueta e código de rastreio, movendo cada envio para
`GENERATED`. Falha na geração do PDF não desfaz o pagamento — a etiqueta é regenerável e
o envio fica em `RELEASED` até conseguir.

### 5.4 Máquina de estados do envio

```
PENDING ──pago──▶ RELEASED ──etiqueta gerada──▶ GENERATED
                                                   │
                                                postado
                                                   ▼
                                                POSTED ──▶ DELIVERED
                                                   │
                                                   ├──▶ LOST
PENDING ─┐                                         │
RELEASED ─┼──cancelado──▶ CANCELLED  (estorna) ◀───┘ (extravio estorna)
GENERATED ┘
```

Cancelamento permitido até `GENERATED`; a partir de `POSTED`, não. Toda transição
inválida levanta erro de domínio, nunca é ignorada em silêncio.

`codigoRastreio` só é atribuído em `GENERATED` — antes disso é nulo, igual ao
SuperFrete.

### 5.5 Etiqueta

PDF em dois formatos: térmica 100×150mm e A4 (4 etiquetas por folha, para impressão em
lote). Conteúdo: código de rastreio com Code128, remetente, destinatário, serviço,
peso, e declaração de conteúdo com itens, quantidades e valor declarado.
Bibliotecas: `pdf-lib` + `bwip-js`.

Impressão em lote: seleciona N envios, gera um PDF único.

### 5.6 Rastreio

Página pública em `/r/[codigo]`, sem login. Mostra timeline de eventos com status, data
e cidade. **Não mostra endereço completo nem nome completo** — quem tem o código não é
necessariamente o dono do envio.

Notificação ao destinatário por e-mail a cada mudança de status, se houver e-mail.

### 5.7 Integrações

API pública espelhando os contratos do SuperFrete, para que plugins existentes sejam
portáveis com troca de base URL:

```
POST /api/v0/calculator     cotação
POST /api/v0/cart           cria envio, devolve { id, price, status }
POST /api/v0/checkout       { orders: [ids] } debita saldo
GET  /api/v0/order/info/:id detalhe do envio
GET  /api/v0/tag/:id        link de impressão
GET  /api/v0/tag/list       lista de etiquetas
POST /api/v0/order/cancel   cancelamento
GET  /api/v0/user/addresses endereços
GET  /api/v0/user/info      dados do usuário
```

Autenticação por Bearer token (`ApiToken`), com ambientes sandbox e produção separados.

Webhooks com os mesmos eventos: `order.created`, `order.released`, `order.generated`,
`order.posted`, `order.delivered`, `order.cancelled`. Entrega assinada com HMAC do
`segredo`, com retentativa exponencial e registro em `WebhookDelivery`.

### 5.8 Indicação e cupons

Cada usuário tem um código de indicação. Quando o indicado faz o primeiro envio pago,
ambos recebem crédito na carteira via `LedgerEntry`. Cupons aplicam desconto percentual
ou fixo no checkout, com limite de usos e validade.

## 6. Telas

**Público:** landing/calculadora, resultado da cotação, rastreio `/r/[codigo]`,
cadastro, login, recuperação de senha.

**Autenticado:** calculadora, novo envio (remetente → destinatário → produtos →
opcionais → ponto de postagem), carrinho, checkout, minhas etiquetas (lista com filtro
por status, busca por código/destinatário, ações imprimir/cancelar/rastrear), carteira
(saldo, recarga, extrato), endereços, integrações (tokens e webhooks), indique e ganhe,
perfil.

**Admin:** envios (busca, avanço manual de status), tabelas de preço (importação de
planilha por faixa de CEP), transportadoras e serviços, pontos de postagem, usuários,
crédito manual em carteira, cupons, auditoria.

## 7. Erros

Erros de domínio tipados, traduzidos para português na borda HTTP:
`SaldoInsuficienteError`, `RotaNaoAtendidaError`, `CepInvalidoError`,
`PesoExcedidoError`, `TransicaoInvalidaError`, `CotacaoExpiradaError`,
`CarrinhoVazioError`, `CancelamentoNaoPermitidoError`.

Nenhum erro é engolido. Log estruturado no servidor com contexto; mensagem amigável na
interface.

## 8. Testes

TDD, cobertura mínima de 80%.

- **Unidade** (`src/domain/`): cubagem, seleção de faixa de CEP, cálculo de desconto,
  opcionais, ledger, transições de estado, Haversine.
- **Integração**: rotas com Postgres real e descartável. Caso obrigatório: dois
  checkouts simultâneos com saldo para apenas um — o segundo deve falhar com
  `SALDO_INSUFICIENTE` e o saldo nunca ficar negativo.
- **E2E** (Playwright): cotação anônima → cadastro → recarga → envio → checkout →
  etiqueta → rastreio público.

## 9. Segurança

- Senha com argon2id. Sessão em cookie `httpOnly`, `Secure`, `SameSite=Lax`.
- Rate limit em login, cadastro, recuperação de senha, cotação e API pública.
- CPF/CNPJ validado por dígito verificador, armazenado normalizado.
- Rastreio público expõe apenas status e cidade.
- Rotas admin verificam papel no servidor, nunca só na interface.
- Tokens de API armazenados com hash; o valor em claro aparece uma única vez na criação.
- Webhook assinado com HMAC-SHA256; verificação de assinatura documentada.
- Nenhum segredo no código: variáveis de ambiente validadas com Zod no boot.
- `AuditLog` em toda ação administrativa que altera dinheiro ou status.

## 10. Fases

Cada fase termina em algo operável.

**Fase 1 — Núcleo transacional.** Auth, endereços, cotação pública com tabela por faixa
de CEP, peso cubado, carteira com recarga simulada e extrato, envio único, etiqueta PDF,
rastreio público, admin mínimo. *É o sistema mínimo que já dá para operar.*

**Fase 2 — Volume.** Carrinho e checkout multi-etiqueta, impressão em lote, filtros e
busca em minhas etiquetas, importação de tabela por planilha, cancelamento com estorno.

**Fase 3 — Multi-transportadora.** Transportadoras e serviços configuráveis, opcionais
precificados (seguro, mão própria, aviso de recebimento), restrições por dimensão com
observação, PUDO com pontos de postagem e ordenação por distância.

**Fase 4 — Integrações.** API pública compatível com os contratos acima, tokens,
sandbox, webhooks com retentativa, documentação.

**Fase 5 — Crescimento.** Indicação, cupons, notificações por e-mail e WhatsApp,
relatórios de economia e volume.

**Fase 6 — Real.** Substituição do `MockCarrier` pela integração real da transportadora
e do `SimulatedPix` por Pix real. Nenhuma mudança de domínio prevista — só novas
implementações das interfaces.

## 10.1. Adendo de 2026-08-31 — paridade visual e funcionalidades reveladas

Capturas do app logado do SuperFrete (ver `docs/ui/referencia-visual.md`) revelaram
funcionalidades ausentes desta especificação. Decisão do usuário: entram todas, distribuídas
por fase. Replicamos layout, fluxo e comportamento; não replicamos marca.

| Funcionalidade | Fase |
|---|---|
| Shell da aplicação: topbar com saldo, sidebar de 7 itens, paleta | 1 |
| Copiar código de rastreio | 1 |
| Compartilhar rastreio | 1 |
| CEP de origem salvo como padrão | 1 |
| Limite de etiquetas por usuário, com barra e pedido de aumento | 2 |
| Diferença de peso/medida com cobrança posterior | 2 |
| Dimensão emitida vs. dimensão postada no detalhe | 2 |
| Ponto de postagem exibido no detalhe do envio | 3 |
| Notificações (sino na topbar) | 5 |
| Adicionar rastreio manual de encomenda de terceiro | 5 |

### Diferença de peso/medida — regra decidida

A transportadora remede o pacote na postagem e pode cobrar a diferença **depois** do envio já
pago. Exemplo real observado: declarado 15×15×15 cm e 0,3 kg, postado 25×52×32 cm e 8,95 kg,
com débito de R$ 28,80.

**Decisão: a carteira nunca fica negativa.** A diferença vira uma `Pendencia` — dívida
registrada em separado, que **bloqueia a emissão de novas etiquetas até ser quitada**. Isso
mantém o saldo da carteira sempre confiável como número, ao custo de um conceito a mais.

```
Pendencia   id, userId, shipmentId, valorCentavos, motivo, status(ABERTA|QUITADA|CANCELADA),
            criadoEm, quitadaEm, ledgerEntryId (preenchido na quitação)
Shipment    + dimensoesPostadas(json), pesoPostadoG, diferencaApuradaEm
```

Regras:
- Apurada a diferença, cria-se `Pendencia` com status `ABERTA`. Nada é debitado da carteira
  nesse momento.
- O checkout recusa novo envio enquanto houver `Pendencia` aberta, com erro
  `PendenciaAbertaError` e mensagem explicando o valor e o envio que a originou.
- Quitação: débito normal na carteira (exige saldo), gerando `LedgerEntry` referenciado pela
  pendência. Recarregar a carteira não quita sozinho — a quitação é ação explícita.
- Pendência cancelada pelo admin exige justificativa e grava `AuditLog`.

## 11. Fora de escopo

App nativo, emissão de NF-e, DC-e oficial junto aos Correios (o MVP emite declaração de
conteúdo própria), frota própria e roteirização.

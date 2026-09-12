# Base de leads — desenho

**Data:** 2026-09-12
**Estado:** aprovado no brainstorming, aguardando plano de implementação

## O problema

O dado de quem compra está espalhado por quatro lugares que não se falam:

| Onde | O que tem | Escopo |
|---|---|---|
| `Pedido` | `clienteNome`, `clienteFone`, `clienteEmail` | por perfil (loja) |
| `Shipment.destinatario` (JSON) | nome, **CPF**, e-mail, telefone, endereço | por envio, congelado |
| `Address` | nome, e-mail, telefone, documento | agenda da conta do lojista |
| `Conversa` | `contato` (telefone), `nomeContato` | por perfil |

Não existe nenhuma entidade que diga "esta pessoa". A mesma compradora que
fez três pedidos em duas lojas e conversou no WhatsApp é sete linhas
desconexas, e não há como responder "quem são os compradores da
plataforma".

## O que se quer

Uma base única, da plataforma, somando todas as lojas, com o mesmo
comprador aparecendo **uma vez** ainda que tenha comprado em três lojas
diferentes. Visível apenas para a administração.

Decisões tomadas no brainstorming:

- **Lead é o comprador do lojista**, não prospect de novo lojista.
- **Identidade por CPF**, com telefone e e-mail de reserva.
- **CPF guardado como impressão digital + cifrado**, nunca em claro.
- **Base da plataforma**, deduplicada entre lojas.
- **Origens:** pedidos pagos, pedidos não finalizados, envios e conversas.
- **Ações:** listar com busca e filtros, detalhe com histórico, exportar CSV.
- **Acesso:** só `ADMIN`. O lojista não ganha tela nem seleção nenhuma.

## Escopo — o que NÃO entra

- **Nenhuma mudança para o lojista.** O WhatsApp continua sendo só o aviso
  automático de atualização para quem já tem envio. `campanha-service` não
  é tocado, e não existe seleção de público a partir de leads. Como não há
  seleção por lead, não há como uma loja alcançar comprador de outra.
- **Exclusão de lead pela tela.** A LGPD dá ao titular o direito de pedir a
  remoção dos dados dele; sem essa ação, atender o pedido exige mexer no
  banco à mão. Fica registrado como decisão consciente, para ser
  acrescentado depois. O modelo já suporta: apagar o `Lead` leva junto os
  `LeadOrigem` por cascata.
- **Endereço copiado para o lead.** Ele já está congelado em cada envio;
  duplicá-lo criaria uma segunda versão para divergir na primeira correção.
  O detalhe lê do envio.

## 1. Modelo de dados

### `Lead` — a pessoa

| Campo | Tipo | Papel |
|---|---|---|
| `id` | `String @id` | |
| `nome` | `String?` | melhor valor conhecido |
| `email` | `String?` | como foi informado |
| `emailNormalizado` | `String? @unique` | minúsculas, sem espaços — chave de reserva |
| `telefone` | `String?` | como foi informado |
| `telefoneNormalizado` | `String? @unique` | só dígitos, sem DDI — chave de reserva |
| `cpfHash` | `String? @unique` | HMAC-SHA256 do CPF — chave principal |
| `cpfCifrado` | `String?` | AES-256-GCM, para exibir quando pedido |
| `primeiroContatoEm` | `DateTime` | |
| `ultimoContatoEm` | `DateTime` | ordenação padrão da lista |
| `totalPedidos` | `Int @default(0)` | resumo, para a lista não somar na hora |
| `totalEnvios` | `Int @default(0)` | |
| `valorTotalCentavos` | `Int @default(0)` | |
| `criadoEm` / `atualizadoEm` | `DateTime` | |

Índices: `ultimoContatoEm`, `nome`.

### `LeadOrigem` — cada vez que a pessoa apareceu

| Campo | Tipo | Papel |
|---|---|---|
| `id` | `String @id` | |
| `leadId` | `String` | `onDelete: Cascade` |
| `tipo` | enum `OrigemLead` | `PEDIDO_PAGO`, `PEDIDO_PENDENTE`, `ENVIO`, `CONVERSA` |
| `perfilId` | `String?` | de qual loja veio |
| `pedidoId` / `shipmentId` / `conversaId` | `String?` | um deles preenchido |
| `ocorridoEm` | `DateTime` | |

Único em `(tipo, pedidoId, shipmentId, conversaId)` para que reprocessar a
mesma origem não crie linha repetida — é o que torna a carga inicial
idempotente.

Alimenta o detalhe com histórico e a coluna "de quais lojas veio".

## 2. Identidade e unificação

### A impressão digital do CPF

**Um SHA-256 simples do CPF não protege nada.** Existem cerca de um bilhão
de CPFs válidos, e testar todos contra um hash leva segundos numa placa de
vídeo comum — um "hash de CPF" sem segredo é o CPF em claro com passos a
mais.

A impressão digital é **HMAC-SHA256 com um segredo do servidor**. Sem o
segredo, a tabela de hashes não diz nada a quem a rouba.

- Segredo novo: `LEAD_FINGERPRINT_KEY`, validado em `src/env.ts` junto com
  as outras variáveis, mínimo de 32 caracteres, sem valor padrão.
- Separado de `SECRET_ENCRYPTION_KEY` de propósito: são finalidades
  diferentes, e trocar uma não deve invalidar a outra.
- **Trocar esse segredo torna todos os leads antigos inencontráveis.** As
  impressões digitais deixam de bater e a mesma pessoa vira lead novo. É
  consequência inevitável de qualquer chave derivada de segredo; precisa
  estar escrito no comentário do código para ninguém rotacionar sem saber.

O CPF em si vai cifrado em `cpfCifrado`, com o `cifrar` que já existe em
`src/infra/crypto/segredo.ts` (AES-256-GCM). Aquela função usa sal e IV
aleatórios, então o resultado muda a cada chamada — por isso ela **não**
serve de chave, e a impressão digital precisa de função própria.

### Normalização, antes de qualquer comparação

- **CPF:** só dígitos.
- **Telefone:** só dígitos, com DDI `55` removido quando presente. Sem
  isso, `(21) 99999-0001` e `5521999990001` viram duas pessoas.
- **E-mail:** minúsculas, sem espaços nas pontas.

### A cascata

Na ordem:

1. `cpfHash` bate → mesma pessoa.
2. Sem CPF no dado que chegou: `telefoneNormalizado` bate → mesma pessoa.
3. Sem telefone: `emailNormalizado` bate → mesma pessoa.
4. Nada bate → lead novo.

### A fusão

O caso que quebra a cascata: a pessoa entra primeiro por conversa de
WhatsApp (só telefone) e depois faz um envio (com CPF). É o mesmo lead,
encontrado pelo telefone — e aí o `cpfHash`, antes vazio, é preenchido. Se
nesse momento já existir **outro** lead com aquele `cpfHash`, os dois são a
mesma pessoa que entrou por dois caminhos.

Fusão, dentro de uma transação:

1. As `LeadOrigem` do mais novo passam para o mais antigo.
2. Os totais somam; `primeiroContatoEm` é o menor, `ultimoContatoEm` o maior.
3. O mais novo é **apagado antes** de os campos serem reatribuídos.
   `emailNormalizado`, `telefoneNormalizado` e `cpfHash` são `unique`: tentar
   copiar o telefone do mais novo para o mais antigo enquanto os dois existem
   viola a restrição e aborta a transação. A ordem é apagar, depois preencher.
4. Campos vazios do mais antigo são preenchidos pelos valores que ficaram.

Sem essa fusão a base acumula duplicatas silenciosas exatamente nos leads
mais completos — os que têm CPF **e** WhatsApp.

### Precedência dos campos

O campo só é sobrescrito quando o novo valor existe e o antigo não, com
duas exceções:

- **CPF:** uma vez conhecido, nunca é trocado.
- **Nome:** o vindo de envio tem precedência sobre o vindo de conversa. O
  do envio foi digitado para uma etiqueta; o da conversa é o apelido que a
  pessoa pôs no WhatsApp.

Sem uma regra assim, o último a chegar sempre ganha e o nome do lead fica
oscilando a cada mensagem.

## 3. Ingestão

Um serviço só — `registrarLead(entrada)` em
`src/server/lead-service.ts` — chamado de três pontos que já existem:

| Origem | Onde | O que traz |
|---|---|---|
| Pedido pago e pendente | `pedido-service.ts` → `registrarPedido` | nome, telefone, e-mail, valor, loja |
| Envio | `emitir-etiqueta-service.ts` → `emitirEtiqueta` | **CPF**, nome, e-mail, telefone |
| Conversa | `conversa-service.ts` → `registrarEntrada` | telefone, às vezes nome |

Três regras valem para os três pontos:

**Nunca derruba a operação que o chamou.** `try/catch` com log, igual ao
aviso por e-mail em `sincronizar-envio-service` e ao SMS de pagamento em
`shipment-service`. Erro ao gravar lead não pode desfazer pedido
registrado nem etiqueta emitida — o lead é subproduto, a operação é o
produto.

**Fora da transação do chamador.** `emitirEtiqueta` roda numa transação
que gera código de rastreio e cria a timeline inteira; enfiar a fusão de
leads lá dentro alongaria uma transação crítica por causa de um
subproduto. Roda depois, com o dado já comprometido.

**Envio sandbox não vira lead.** Comprador de teste não existe; a base
ficaria poluída com os dados fictícios de quem está integrando.

### Carga inicial

Script em `scripts/`, idempotente, varrendo pedidos, envios e conversas
existentes em ordem cronológica e chamando o mesmo `registrarLead`. Rodar
duas vezes dá o mesmo resultado — é o que permite interromper e retomar. A
ordem cronológica importa: ela reproduz a mesma sequência de fusões que
teria acontecido ao vivo.

## 4. Telas

Só administração. O lojista não ganha nada.

### `/admin/leads`

Item novo em `src/components/admin/nav-admin.tsx`. Rota fechada pelo papel
`ADMIN` lido da sessão, nunca por parâmetro de URL — mesmo padrão de
`listarEtiquetas`.

Colunas: nome, e-mail, telefone, CPF mascarado (`***.456.789-**`), lojas de
origem, nº de pedidos, nº de envios, valor total, último contato.

Filtros: texto livre (nome, e-mail, telefone, CPF), loja, origem, período.
Paginação no banco, com teto por página — a base cresce com a plataforma
inteira.

Busca por CPF: o termo digitado é normalizado e transformado em impressão
digital, e a consulta compara hash com hash. Busca por CPF parcial não
funciona, e isso é consequência direta de não guardar o número em claro.

### `/admin/leads/[id]`

Dados da pessoa e a linha do tempo unindo pedidos, envios e conversas em
ordem, cada item com link para a tela que já existe.

**O CPF completo não aparece na lista.** Fica no detalhe, atrás de um
clique explícito em "ver CPF", e o clique grava `AuditLog`. O motivo é
prático: numa lista, mil CPFs são lidos de uma vez por qualquer um que
abra a tela ou tire um print; no detalhe, ler mil exige mil ações
registradas.

### Exportação CSV

Só admin. Respeita os filtros aplicados. Cada exportação grava `AuditLog`
com o número de linhas e os filtros usados.

CPF sai **mascarado** por padrão; completo só marcando uma caixa que diz o
que está fazendo. Quando o arquivo sai do sistema ninguém mais controla
onde ele para — o registro é o que permite responder depois "quem levou
esses dados e quando".

## 5. Testes

Cobertura mínima antes de considerar pronto:

**Unificação**
- Dois pedidos do mesmo CPF em lojas diferentes → um lead, duas origens.
- Conversa e depois envio com o mesmo telefone → um lead, CPF preenchido.
- Conversa por telefone e envio com CPF que já existe em outro lead → fusão,
  totais somados, um lead a menos.
- Telefone com e sem DDI `55` → mesma pessoa.
- E-mail com caixa diferente → mesma pessoa.
- Ninguém com CPF, telefone ou e-mail em comum → leads separados.

**Ingestão**
- Falha ao registrar lead não derruba `registrarPedido` nem `emitirEtiqueta`.
- Envio sandbox não cria lead.
- Reprocessar a mesma origem não duplica `LeadOrigem`.

**Impressão digital**
- Mesma entrada, mesmo hash; entradas diferentes, hashes diferentes.
- Hash não é reversível por comparação com SHA-256 puro do mesmo CPF (prova
  de que o segredo entra no cálculo).

**Acesso**
- Conta sem papel `ADMIN` recebe 404 em `/api/admin/leads`, não 403.
- CPF completo não aparece na resposta da listagem, em nenhum campo.

**Carga inicial**
- Rodar duas vezes produz exatamente o mesmo estado.

## 6. Riscos registrados

| Risco | Mitigação |
|---|---|
| Base concentrada de CPFs vira alvo de maior valor que os dados espalhados de hoje | CPF cifrado e nunca em claro no banco; impressão digital com segredo; exibição atrás de ação registrada |
| Perda ou rotação de `LEAD_FINGERPRINT_KEY` torna os leads inencontráveis | Documentado no spec e em comentário no código; tratar como as demais chaves de produção |
| Exportação CSV tira os dados do alcance de qualquer controle | Mascarado por padrão, completo exige ação deliberada, toda exportação registrada |
| Sem exclusão pela tela, pedido de remoção do titular exige banco | Registrado como fora de escopo consciente; modelo já preparado por cascata |
| Fusão errada junta duas pessoas diferentes | Só funde por CPF, que é único; telefone e e-mail nunca disparam fusão, só encontram |

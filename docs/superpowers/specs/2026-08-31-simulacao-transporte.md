# Simulação de transporte e rastreio — Design

Data: 2026-08-31
Decisão do usuário: frete próprio, sem integração com transportadora. Todo o transporte é
simulado, e a simulação precisa **avançar sozinha com a passagem do tempo**.

Complementa `2026-08-30-plataforma-frete-design.md` e substitui a versão simples da Task 16
(rastreio) do plano da Fase 1.

## 1. Princípio

**O roteiro inteiro é gerado no momento em que a etiqueta é emitida**, com cada evento já
datado no futuro. A consulta mostra apenas os eventos cuja data já passou.

Três consequências, e são as razões da escolha:
- **Nenhum processo em segundo plano.** Sem job, sem fila, sem cron para dar manutenção.
- **Determinismo.** Duas consultas no mesmo instante devolvem exatamente a mesma timeline.
- **Reprodutibilidade.** Dá para inspecionar o futuro de um envio antes de ele acontecer.

## 2. Modelo de dados

```
SimulacaoConfig   id (registro único), fatorVelocidade Int (padrão 1), atualizadoEm

Shipment        + cenario            CenarioSimulacao  (padrão ENTREGA_NORMAL)
                + simulacaoIniciadaEm DateTime?
                + fatorSimulacao     Int               (copiado da config na geração)

TrackingEvent   + sequencia          Int
                + offsetMinutos      Int    -- minutos de simulação desde o início
                + codigo             String -- identificador estável do tipo de evento
                + unidadeOrigem      String?
                + unidadeDestino     String?
                + cidade             String
                + uf                 String
                + forcado            Boolean (padrão false)
```

`enum CenarioSimulacao { ENTREGA_NORMAL, ATRASO, TENTATIVA_FALHA, EXTRAVIO, DEVOLUCAO }`

**O fator é copiado para o envio na geração**, não lido da configuração a cada consulta.
Assim, mudar a velocidade global afeta apenas envios novos — envios em curso não têm a linha
do tempo reescrita debaixo do usuário.

`ocorridoEm = simulacaoIniciadaEm + (offsetMinutos × 60_000) / fatorSimulacao`

É materializado na geração, para que a consulta seja uma comparação simples de data.

## 3. Roteiros por cenário

Offsets em minutos de simulação. `P` = prazo do serviço em dias úteis, convertido para minutos
(`P × 1440`). Os eventos se distribuem proporcionalmente ao prazo, para que um serviço de 1 dia
e outro de 5 dias tenham a mesma forma, em escalas diferentes.

### ENTREGA_NORMAL

| # | offset | código | título | unidades |
|---|---|---|---|---|
| 1 | 0 | `ETIQUETA_EMITIDA` | Etiqueta emitida | De: INTERFACE DO SISTEMA - BR |
| 2 | 0,10·P | `POSTADO` | Objeto postado | De: AGÊNCIA - {cidadeOrigem}/{ufOrigem} |
| 3 | 0,25·P | `TRANSFERENCIA` | Objeto em transferência - por favor aguarde | De: AGÊNCIA - {origem} → Para: UNIDADE DE TRATAMENTO - {origem} |
| 4 | 0,55·P | `TRANSFERENCIA` | Objeto em transferência - por favor aguarde | De: UNIDADE DE TRATAMENTO - {origem} → Para: UNIDADE DE TRATAMENTO - {destino} |
| 5 | 0,85·P | `SAIU_PARA_ENTREGA` | Objeto saiu para entrega ao destinatário | {cidadeDestino}/{ufDestino} |
| 6 | 1,00·P | `ENTREGUE` | Objeto entregue ao destinatário | De: UNIDADE DE DISTRIBUIÇÃO - {destino} |

Descrições fixas, copiadas da referência: evento 5 leva "É preciso ter alguém no endereço para
receber o carteiro"; evento 1 leva "Aguardando postagem pelo remetente".

Quando origem e destino são a mesma cidade, os eventos 3 e 4 se fundem em um só — encomenda
local não passa por duas unidades de tratamento.

### ATRASO

Igual ao normal até o evento 4. Depois insere `AGUARDANDO_TRATAMENTO` ("Objeto aguardando
tratamento na unidade") em `1,10·P` e desloca `SAIU_PARA_ENTREGA` para `1,60·P` e `ENTREGUE`
para `1,80·P`. Ou seja: entrega acontece, com atraso de ~80% sobre o prazo.

### TENTATIVA_FALHA

Igual ao normal até `SAIU_PARA_ENTREGA` (0,85·P). Então:
- `1,00·P` — `TENTATIVA_FRUSTRADA`: "Carteiro não atendido, será realizada nova tentativa"
- `1,05·P` — `AGUARDANDO_RETIRADA`: "Objeto aguardando retirada no endereço indicado"
- `1,90·P` — `SAIU_PARA_ENTREGA` (segunda tentativa)
- `2,00·P` — `ENTREGUE`

### EXTRAVIO

Igual ao normal até o evento 4. Então `1,50·P` — `EXTRAVIADO`: "Objeto não localizado no fluxo
postal". **Move o envio para `LOST`. NÃO estorna** — decisão do usuário de 2026-08-31:
nenhuma situação devolve valor à carteira. Ver a seção 5.2 da spec principal.

### DEVOLUCAO

Igual à tentativa falha até `AGUARDANDO_RETIRADA`. Então:
- `2,50·P` — `DEVOLUCAO_INICIADA`: "Objeto devolvido ao remetente por prazo de retirada expirado"
- `3,00·P` — `DEVOLVIDO`: "Objeto entregue ao remetente"

Devolução **não** estorna, assim como nenhum outro desfecho. Desde 2026-08-31 não existe
estorno automático em situação alguma — extravio, devolução e cancelamento mantêm o débito.

## 4. Nomes de unidade

Derivados da cidade e UF de origem e destino do próprio envio, no formato observado na
referência, sempre em maiúsculas:

```
AGÊNCIA DOS CORREIOS- SAO PAULO/SP
UNIDADE DE TRATAMENTO- SAO PAULO/SP
UNIDADE DE DISTRIBUIÇÃO- NOVA IGUACU/RJ
INTERFACE DO SISTEMA- BR
```

Como o frete é nosso, o nome do operador é configurável em `SimulacaoConfig`, com padrão
neutro. Não usar o nome dos Correios em produção; o formato é que é copiado, não a marca.

## 5. Estado do envio

O status do `Shipment` é derivado do **último evento visível**, nunca escrito à mão em paralelo:

| código do evento | status resultante |
|---|---|
| `ETIQUETA_EMITIDA` | `GENERATED` |
| `POSTADO`, `TRANSFERENCIA`, `AGUARDANDO_TRATAMENTO`, `SAIU_PARA_ENTREGA`, `TENTATIVA_FRUSTRADA`, `AGUARDANDO_RETIRADA` | `POSTED` |
| `ENTREGUE` | `DELIVERED` |
| `EXTRAVIADO` | `LOST` |
| `DEVOLVIDO` | `DELIVERED` (com marcação de devolução) |

A sincronização acontece na leitura do envio e na listagem, dentro de uma transação, e respeita
`garantirTransicao`. Um envio cancelado antes da postagem **não** avança: o cancelamento
descarta os eventos futuros.

## 6. Controle administrativo

- **Fator de velocidade global** (`SimulacaoConfig.fatorVelocidade`): 1 = tempo real;
  24 = um dia em uma hora; 288 = um dia em cinco minutos. Aplica-se a envios novos.
- **Trocar o cenário de um envio**: regenera apenas os eventos **futuros**; os já ocorridos
  são preservados — reescrever passado que o cliente já viu é mentir para ele.
- **Forçar o próximo evento**: antecipa o próximo evento pendente para agora, marcando
  `forcado = true`, e desloca os seguintes pelo mesmo intervalo.
- **Reiniciar a linha do tempo**: apaga os eventos e regenera a partir de agora. Exige
  confirmação e grava `AuditLog`.

Toda intervenção administrativa grava `AuditLog` com ator, envio, antes e depois.

## 7. Interface do rastreio

Conforme `docs/ui/referencia-visual.md` seção 6, replicada campo a campo:

- **Faixa superior** com a cor do status atual (verde entregue, azul em trânsito, laranja
  aguardando, vermelho extraviado), ícone, título do último evento e, à direita, data e hora.
- **Caixa azul de ajuda** com link para as informações do envio.
- **Resumo em três colunas com ícones**: serviço, código de rastreio, duração.
- **Timeline vertical**, mais recente no topo: data (`13 Ago`) e hora (`às 13:41`) à esquerda;
  ícone circular ligado por linha vertical ao próximo; à direita o título colorido, a
  descrição, `De:` e `Para:` quando houver, e a localização com ícone de pin.
- **Eventos futuros nunca aparecem**, nem esmaecidos. O cliente não pode ver o que ainda não
  aconteceu.

A página pública (`/r/[codigo]`) mostra a mesma timeline, mas **sem nome e sem endereço** —
apenas status, cidade e UF, conforme a regra de privacidade já estabelecida.

## 8. Testes obrigatórios

- Roteiro gerado tem os eventos na ordem certa, com offsets crescentes, para cada um dos cinco
  cenários.
- Evento futuro não aparece na consulta; ao avançar o relógio, aparece.
- Fator de velocidade: com fator 1440, um evento de offset de 1 dia ocorre em 1 minuto.
- Mudar o fator global **não** altera envios já em curso.
- Trocar o cenário preserva os eventos passados e substitui só os futuros.
- `EXTRAVIADO` credita a carteira exatamente uma vez, mesmo se a sincronização rodar duas vezes.
- `DEVOLVIDO` **não** credita.
- Envio cancelado não avança de status.
- Origem e destino na mesma cidade não geram duas transferências.
- Rastreio público não devolve nome nem logradouro em nenhum cenário.
- Sincronização concorrente (duas leituras simultâneas) não duplica evento nem lançamento.

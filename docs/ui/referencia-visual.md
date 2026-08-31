# Referência visual — paridade com o app logado do SuperFrete

Extraído de capturas do app real (`web.superfrete.com`) fornecidas pelo usuário em 2026-08-31.
Este documento é a fonte de verdade da interface. Quem implementa não vê as imagens — o que
não estiver descrito aqui não será replicado.

**Marca:** replicamos layout, fluxo e comportamento. Não replicamos logo, nome nem as artes de
campanha do SuperFrete. Onde a referência mostra a marca deles, usamos a nossa.

## 1. Estrutura global (shell)

Todas as telas autenticadas compartilham o mesmo esqueleto:

```
┌──────────────────────────────────────────────────────────────┐
│  NOME DO USUÁRIO  [ícone]  R$ 0,00        [logo]        🔔   │  topbar
├───────────────┬──────────────────────────────────────────────┤
│ ▎Calcular     │                                              │
│  Etiquetas    │              conteúdo da página              │
│  Rastreio     │                                              │
│  Ajuda        │                                              │
│  Integrações  │                                              │
│  Convide e    │                                              │
│    ganhe      │                                              │
│  Perfil       │                                              │
│               │                                              │
│ [banner]      │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

**Topbar** (fundo branco, borda inferior sutil, altura ~64px):
- Esquerda: nome do usuário em maiúsculas, peso bold, cor quase preta. Ao lado, um ícone
  pequeno de carteira e o **saldo em verde, sublinhado, clicável** (`R$ 0,00`). O saldo é
  elemento de navegação — leva à carteira.
- Centro: logo.
- Direita: sino de notificações.

**Sidebar** (largura ~240px, fundo branco, borda direita sutil):
- Sete itens, cada um com ícone à esquerda e rótulo: **Calcular, Etiquetas, Rastreio, Ajuda,
  Integrações, Convide e ganhe, Perfil**.
- Item ativo: rótulo e ícone em verde, mais uma **barra vertical verde grudada na borda
  esquerda** do item. Os demais em cinza-escuro.
- No rodapé da sidebar, um banner promocional vertical (card com imagem e texto curto).

**Conteúdo**: fundo cinza muito claro (`#F5F6F7` aproximado), conteúdo centralizado com largura
máxima em torno de 760px nas telas de formulário e mais largo nas de tabela.

**Paleta** (extraída das capturas, com ajuste de contraste — ver nota abaixo):
- Verde de preenchimento de botão (texto branco em cima): `#0A6E4A` — 6,28:1 sobre branco.
- Verde de texto/links sobre fundo claro (branco ou cinza de página): `#0B7A52` — 5,36:1 sobre
  branco, 4,95:1 sobre o fundo de página.
- Verde claro de fundo de selo: `#D6F5E6`
- Texto principal: `#1A1A1A`; secundário: `#5B6472` — 5,98:1 sobre branco, 5,53:1 sobre o fundo
  de página. Texto riscado (preço de balcão sobre card branco): `#6B7280` — 4,84:1 sobre branco.
- Fundo de página: `#F5F6F7`; superfícies: `#FFFFFF`; blocos de formulário: `#F0F1F2`
- Borda de campo: `#CBD5E1`
- Laranja de alerta: `#F59E0B` com texto branco
- Azul de informação: `#E8F4FD` com texto azul-escuro

> **Nota de contraste (2026-08-31, rodada de correção 2 da Task 7.5):** os tons de verde e de
> cinza secundário desta paleta foram **escurecidos em relação à captura original do
> concorrente**. As capturas usavam `#0E8A5F` (verde) e `#6B7280` (cinza secundário), que medem
> 4,36:1 e 4,47:1 respectivamente contra os fundos onde aparecem — abaixo do mínimo de 4,5:1
> do WCAG 2.1 AA para texto normal. O app de origem falha esse critério; não replicamos a
> falha. Os valores acima (`#0A6E4A`, `#0B7A52`, `#5B6472`) foram medidos e confirmados acima de
> 4,5:1 nas combinações onde são usados. **Não reverta para os tons originais** sem repetir essa
> medição — veja `src/components/layout/*.tsx` e `tailwind.config.ts` (tokens `brand`,
> `brand.texto`, `texto.secundario`) para onde cada tom é consumido.

Tipografia sem serifa, títulos em peso bold, rótulos de seção em **maiúsculas com espaçamento
entre letras** (`INFORME A ORIGEM`).

## 2. Tela Calcular

Título de seção `INFORME A ORIGEM` em maiúsculas, fora do card, cinza-escuro.

Card cinza claro contendo:
- **CEP de origem** — campo com rótulo flutuante acima, placeholder `XXXXX-XXX`, sublinhado
  (borda apenas embaixo, estilo Material). À direita, dois botões-pílula verdes:
  **SALVAR** (ícone de disquete) e **LIMPAR** (ícone de lixeira).
- Linha com dois campos: **Formato** (select, padrão `Caixa / Pacote`) e **Peso**
  (select, padrão `Selecione`).
- Linha com três campos: **Altura**, **Largura**, **Comprimento**, placeholder `00`, com o
  sufixo `cm` à direita dentro do campo.
- **Seguro, aviso e mão própria** — acordeão centralizado, com chevron à direita.

Título `INFORME O DESTINO`, card com:
- **CEP de destino** (mesmo estilo) e, à direita, o link **Pesquisar CEP** em verde sublinhado.

Botão de largura total, verde, texto branco em maiúsculas: **CALCULAR FRETE COM DESCONTO**.

Acima do formulário há um banner horizontal de campanha.

## 3. Tela Etiquetas

Cabeçalho: título **Etiquetas** à esquerda, ícone de engrenagem à direita.

Abaixo, três elementos na mesma faixa:
- **Limite restante 5 de 5** com uma **barra de progresso** fina abaixo, e o link
  **Pedir aumento de limite** em verde sublinhado ao lado.
- À direita, campo de busca com ícone de lupa: `Buscar por destinatário`.

**Abas em formato de pílula**, com contagem entre parênteses: `Todas (4)`, `A Emitir (0)`,
`A Postar (0)`. A aba ativa tem borda e texto verdes, fundo branco; as inativas, borda cinza.

**Tabela** com cabeçalho de fundo cinza claro e colunas:
`Destinatário` · `Tipo` · `Rastreio` · `Valor` · `Status` · `Ações`

- **Destinatário**: nome em verde, clicável (abre os detalhes).
- **Tipo**: nome do serviço (`JADLOG.PACKAGE`, `SEDEX`) ou vazio.
- **Rastreio**: código monoespaçado com um **ícone de copiar** à esquerda; quando não há
  código, exibe `-`.
- **Valor**: `R$ 14,79`.
- **Status**: **pílula de largura fixa**, fundo cinza claro, texto centralizado —
  `Completa`, `Cancelada`.
- **Ações**: ícones à direita.

**Estado vazio**: a tabela aparece ao fundo **borrada/esmaecida**, e sobre ela, centralizado:
título em duas linhas — "Emita o seu primeiro frete com a gente / para ter acesso aos nossos
benefícios" —, botão verde **Emitir frete**, e abaixo o texto "Caso queira saber mais sobre os
nossos descontos" com link **veja aqui**.

## 4. Detalhes da etiqueta

Cabeçalho com seta de voltar, título **Detalhes Da Etiqueta**, ícone de suporte à direita.

Blocos, de cima para baixo:

1. **Alerta de diferença de peso/medida** (só quando houver) — bloco laranja, texto branco,
   título **Diferença de Peso/Medida**, explicação de que a transportadora alterou o valor por
   divergência entre o que foi declarado e o que foi postado, e link sublinhado
   **Por que isso acontece?**.
2. **Lançamento relacionado** — linha com ícone, rótulo `Outro`, descrição
   "Débito na carteira de R$ -28,8 referente à diferença de valor calculado e postado para o
   pedido N", data e número do pedido. Expansível por chevron.
3. **Caixa azul de ajuda** — "Tem dúvidas com o envio? / Acessar informações do envio".
4. **RASTREIO** — rótulo em maiúsculas, `Código de Rastreio:` seguido do código em verde
   sublinhado, e ícone de compartilhar à direita.
5. **CONTEÚDO** — tabela de três colunas: `Descrição`, `Quantidade`, `Valor`.
6. **PAGAMENTO** — linha `Valor usado da carteira:` com o valor à direita.
7. **RESUMO** — duas linhas com ícone de caixa:
   - `Dimensão emitida` — o que o cliente declarou.
   - `Dimensão postada` — o que a transportadora mediu, **destacada com borda laranja** quando
     diverge da emitida.
8. **Bloco da transportadora** — nome e prazo (`LOGGI (5 dias úteis)`), destinatário, e:
   - **PONTO DE POSTAGEM**: nome do estabelecimento, endereço completo, bairro, cidade/UF, CEP
     e **horário de funcionamento**.
   - **ORIGEM** e **DESTINO** ligados por uma **linha vertical conectora** com marcadores
     (círculo na origem, pin no destino), cada um com CEP, endereço, nome e telefone.
9. **Totais** — linha do serviço com valor cheio à direita e, abaixo, **Desconto pelo app** com
   o valor negativo em verde.

## 5. Tela Rastreio

Banner horizontal no topo.

**Abas em texto sublinhado** (não pílula), com contagem: `TODOS (2)`, `PENDENTES (0)`,
`ENTREGUES (2)`. A ativa tem sublinhado verde.

**Lista de cards**, cada um com:
- Círculo verde com ícone de check à esquerda (quando entregue).
- Nome do destinatário, status em **verde bold** (`Entregue`), e o código de rastreio em cinza.
- À direita, separado por uma borda vertical: transportadora (`LOGGI`, `SEDEX`), data (`12 Ago`)
  e duração (`2 Dias`).
- Ícone de compartilhar no canto direito.

**Botão flutuante circular verde com `+`** no canto inferior direito — adicionar rastreio manual.

## 6. Timeline de rastreio

- **Faixa verde no topo** com ícone de check, o status atual em branco
  (`Objeto entregue ao destinatário`) e, à direita, data e hora.
- Caixa azul de ajuda.
- **Resumo em três colunas com ícones**: serviço (`SEDEX`), código de rastreio, duração
  (`2 Dias`).
- **Timeline vertical**: para cada evento, à esquerda a data (`13 Ago`) e a hora (`às 13:41`);
  no centro um **ícone circular** ligado por linha vertical ao evento seguinte; à direita o
  título do evento (verde quando concluído, azul quando em trânsito), a descrição, as linhas
  `De:` e `Para:` quando houver transferência, e a **localização com ícone de pin**
  (`NOVA IGUACU/RJ`).
- Ordem: **mais recente no topo**.
- Eventos observados, nesta ordem cronológica inversa: `Objeto entregue ao destinatário`,
  `Objeto saiu para entrega ao destinatário`, `Objeto em transferência - por favor aguarde`
  (repetível), `Objeto postado`, `Etiqueta emitida` (com "Aguardando postagem pelo remetente").

## 7. Funcionalidades reveladas por estas telas e ainda não previstas no spec

Registradas aqui para decisão; nenhuma está implementada.

| Funcionalidade | Onde aparece | Fase sugerida |
|---|---|---|
| Limite de etiquetas por usuário, com barra e pedido de aumento | Etiquetas | nova — controle de risco/antifraude |
| Diferença de peso/medida, com débito complementar na carteira | Detalhes | nova — afeta a carteira, precisa de regra |
| Dimensão emitida vs. dimensão postada | Detalhes | acompanha a anterior |
| Ponto de postagem no detalhe do envio | Detalhes | Fase 3 (PUDO) |
| Compartilhar rastreio | Rastreio, Detalhes | Fase 1 (barato) |
| Adicionar rastreio manual de terceiros | Rastreio (botão `+`) | Fase 5 |
| CEP de origem salvo como padrão | Calcular (botão SALVAR) | Fase 1 (barato) |
| Notificações (sino) | Topbar | Fase 5 |
| Copiar código de rastreio | Etiquetas | Fase 1 (barato) |

**Diferença de peso/medida** merece atenção: a transportadora remede o pacote e cobra a
diferença, que vira **débito adicional na carteira depois da postagem**. Isso significa que a
carteira pode ficar negativa, o que o modelo atual não prevê — `aplicarDebito` recusa débito
maior que o saldo. Precisa de decisão de produto antes de implementar.

# Martins Log — landing page

Página institucional estática da transportadora Martins Log, com a barra de
rastreio de encomenda como elemento central.

HTML5 + CSS puro + JavaScript vanilla. **Sem framework, sem build, sem
dependência** — é só servir a pasta.

## Estrutura

```
index.html
assets/css/style.css
assets/js/main.js
assets/img/            logo em png/webp + favicons
```

## Integração com o backend

Os dois pontos de integração ficam no topo do `index.html`, em um único bloco
inline — é o único JavaScript embutido na página:

```js
window.MARTINS_CONFIG = {
  rastreioEndpoint: '/api/rastreio',    // GET  {base}/{codigo}
  contatoEndpoint:  '/api/contato',     // POST
  whatsapp:         '5500000000000'
};
```

O backend deste projeto (repositório `martins-log`) já expõe as duas rotas.
Se a landing for servida de outro domínio, defina `CORS_ORIGINS` no backend
com a origem do site.

### Formato esperado do rastreio

```json
{
  "codigo": "ML123456789BR",
  "status": "Em trânsito",
  "origem": "São Paulo/SP",
  "destino": "Curitiba/PR",
  "previsao": "2026-09-01T12:00:00.000Z",
  "eventos": [
    { "data": "...", "status": "...", "local": "...", "descricao": "..." }
  ]
}
```

A função `normalizarResposta()` em `assets/js/main.js` também aceita as
variações mais comuns (`events`, `history`, `date`, `location`, `city`…) e
esconde o que não vier. **É o ponto de ajuste** se o contrato mudar.

## Modo demonstração

Abra com `?demo=1` para ver o rastreio com dados de exemplo, sem backend.
Também entra em demo sozinho se `rastreioEndpoint` estiver vazio.

Deep link: `?codigo=ML123456789BR` preenche o campo e consulta na hora.

## Rodando

Qualquer servidor estático serve:

```bash
npx serve -l 4173 .
```

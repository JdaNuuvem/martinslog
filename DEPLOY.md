# Publicação

Este repositório tem `Dockerfile` e `nginx.conf`: a imagem é um nginx com os
arquivos estáticos dentro. Qualquer lugar que construa a imagem serve o site
com o mesmo comportamento de cache.

## Coolify

**New Resource → Private Repository** → este repositório →
**Build Pack: Dockerfile** → domínio `https://martinslog.net`.

A landing atende o domínio inteiro **menos** `/api`, `/admin` e `/_next`, que
pertencem à aplicação do repositório `martins-log`. O guia completo da
migração, com a ordem correta dos passos, está em `DEPLOY.md` lá.

## Integração com o backend

Os endpoints ficam no bloco `window.MARTINS_CONFIG`, no topo do `index.html`.
Enquanto a landing e a API estiverem no mesmo domínio, o caminho relativo
basta e não há CORS envolvido:

```js
rastreioEndpoint: '/api/rastreio',
contatoEndpoint:  '/api/contato',
```

## Situação atual

Hoje o site é servido por um contêiner criado à mão na VPS (`martins-site`),
com os arquivos montados de `/root/martins/landing`. Há um `robots.txt` com
`Disallow: /` **apenas lá**, enquanto os dados de contato forem provisórios —
ele não está neste repositório e precisa ser apagado quando o conteúdo real
entrar no ar, senão o site nunca é indexado.

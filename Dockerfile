# A landing é estática: a imagem é só um nginx com os arquivos dentro.
# Existir como Dockerfile é o que permite o Coolify (ou qualquer outro lugar)
# publicar este repositório sem nenhuma configuração manual de servidor.
FROM nginx:alpine

# Remove a página padrão do nginx para ela não sobrar na imagem.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Faixas de IP do Brasil, para o bloqueio por país. O prefixo `00-` importa:
# arquivos de conf.d são incluídos em ordem alfabética, e a diretiva `geo` tem
# que existir antes de o server que a consulta ser lido.
COPY geo-br.conf /etc/nginx/conf.d/00-geo-br.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
# A página que quem está fora do Brasil vê. Estilo embutido nela: um arquivo
# externo pediria uma segunda requisição, que passaria de novo pelo bloqueio.
COPY fora-do-brasil.html /usr/share/nginx/html/
# Politica de privacidade. Existe porque o site grava sessao de visitante
# (Microsoft Clarity): sem a pagina, o link do rodape apontava para lugar
# nenhum enquanto a gravacao ja acontecia.
COPY privacidade.html /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
# Documentação pública da API, servida em /docs. Sem esta linha a pasta some da
# imagem e a rota responde 404 — sem nenhum erro no build que denuncie isso.
COPY docs /usr/share/nginx/html/docs

EXPOSE 80

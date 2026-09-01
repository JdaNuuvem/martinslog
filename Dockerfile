# A landing é estática: a imagem é só um nginx com os arquivos dentro.
# Existir como Dockerfile é o que permite o Coolify (ou qualquer outro lugar)
# publicar este repositório sem nenhuma configuração manual de servidor.
FROM nginx:alpine

# Remove a página padrão do nginx para ela não sobrar na imagem.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
# Documentação pública da API, servida em /docs. Sem esta linha a pasta some da
# imagem e a rota responde 404 — sem nenhum erro no build que denuncie isso.
COPY docs /usr/share/nginx/html/docs

EXPOSE 80

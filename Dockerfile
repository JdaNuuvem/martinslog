# A landing é estática: a imagem é só um nginx com os arquivos dentro.
# Existir como Dockerfile é o que permite o Coolify (ou qualquer outro lugar)
# publicar este repositório sem nenhuma configuração manual de servidor.
FROM nginx:alpine

# Remove a página padrão do nginx para ela não sobrar na imagem.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

EXPOSE 80

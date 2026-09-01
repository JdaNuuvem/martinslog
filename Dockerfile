# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /app

# ---- dependências ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
# Valores de fachada: `src/env.ts` valida o ambiente no carregamento do
# módulo, e o `next build` carrega as rotas para coletar os dados de página.
# Nada disso vai para a imagem final — o runtime lê o ambiente de verdade.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV SESSION_SECRET=build-build-build-build-build-build
RUN pnpm build

# ---- CLI do Prisma ----
# Instalado isolado porque o `node_modules` do pnpm é uma teia de symlinks
# para `.pnpm/` que não sobrevive a um COPY seletivo. O cliente gerado, esse
# sim, já vem dentro do standalone; aqui só precisamos do `migrate deploy`.
FROM base AS prisma-cli
WORKDIR /opt/prisma
RUN npm init -y > /dev/null && npm install prisma@6.19.3

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# CLI do Prisma para aplicar as migrations na subida.
COPY --from=prisma-cli /opt/prisma /opt/prisma
COPY --from=builder /app/prisma ./prisma

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]

#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL não definida" >&2
  exit 1
fi

echo "Aplicando migrations..."
node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma

exec "$@"

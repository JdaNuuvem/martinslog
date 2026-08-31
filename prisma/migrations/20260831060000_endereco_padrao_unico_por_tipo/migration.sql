-- Invariante no banco: no máximo um endereço padrão por usuário e por tipo,
-- entre os não arquivados. Índice único parcial — o Prisma não expressa
-- isso no schema.prisma, então esta migration é SQL bruto.
CREATE UNIQUE INDEX "address_padrao_unico_por_tipo"
  ON "addresses" ("userId", "tipo")
  WHERE "padrao" = true AND "arquivadoEm" IS NULL;

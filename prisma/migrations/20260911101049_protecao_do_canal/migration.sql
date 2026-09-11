-- Protecao do canal: quem pediu para parar, e a hora de ficar quieto.
--
-- NAO mexe nos indices de `pedidos` nem de `mensagem_envios`. Ver a
-- migration 20260911062749.

-- AlterTable
ALTER TABLE "perfis" ADD COLUMN     "silencioAtivo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "silencioFimHora" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "silencioInicioHora" INTEGER NOT NULL DEFAULT 22;

-- CreateTable
CREATE TABLE "nao_perturbe" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "contato" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'CLIENTE',
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nao_perturbe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nao_perturbe_contato_idx" ON "nao_perturbe"("contato");

-- CreateIndex
CREATE UNIQUE INDEX "nao_perturbe_perfilId_contato_key" ON "nao_perturbe"("perfilId", "contato");

-- AddForeignKey
ALTER TABLE "nao_perturbe" ADD CONSTRAINT "nao_perturbe_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

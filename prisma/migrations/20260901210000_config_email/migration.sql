-- Configuração de e-mail por conta: cada cliente conecta o Resend dele.
--
-- A chave de API fica **cifrada** (AES-256-GCM, ver src/infra/crypto). Chave
-- de terceiro em texto puro transforma um vazamento do banco no
-- comprometimento da conta Resend de todos os clientes — quem obtém a chave
-- envia e-mail em nome deles, com o domínio deles.
--
-- `dicaChave` guarda só o prefixo e os quatro últimos caracteres, para a tela
-- confirmar qual chave está conectada sem nunca devolver a chave.
--
-- Uma configuração por conta: o remetente é um só, e permitir várias abriria
-- a pergunta de qual vale no envio.
CREATE TABLE "email_configs" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "provedor"     TEXT NOT NULL DEFAULT 'RESEND',
  "apiKeyCifrada" TEXT NOT NULL,
  "dicaChave"    TEXT NOT NULL,
  "remetente"    TEXT NOT NULL,
  "ativo"        BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "email_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_configs_userId_key" ON "email_configs" ("userId");

ALTER TABLE "email_configs"
  ADD CONSTRAINT "email_configs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Registro de cada envio, para o cliente ver o que saiu e por quê falhou.
-- Sem isso, "o e-mail não chegou" não tem como ser investigado.
CREATE TABLE "email_deliveries" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "shipmentId"  TEXT,
  "para"        TEXT NOT NULL,
  "assunto"     TEXT NOT NULL,
  "evento"      TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "erro"        TEXT,
  "idExterno"   TEXT,
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_deliveries_userId_criadoEm_idx" ON "email_deliveries" ("userId", "criadoEm");

-- Um e-mail por evento e por envio: a sincronização pode rodar várias vezes
-- sobre a mesma timeline, e sem esta trava o destinatário receberia o mesmo
-- aviso repetido a cada leitura do rastreio.
CREATE UNIQUE INDEX "email_deliveries_shipment_evento_key"
  ON "email_deliveries" ("shipmentId", "evento")
  WHERE "shipmentId" IS NOT NULL;

ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

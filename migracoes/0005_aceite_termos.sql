-- Aceite dos Termos do Passeio. Somente inclusão: UPDATE e DELETE disparam erro.
-- NÃO APLICADA EM PRODUÇÃO por este PR. O _worker.js cria a tabela sozinho na
-- primeira reserva (garantirEsquemaAceite). Para aplicar à mão, se preferir:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0005_aceite_termos.sql
-- Não rode isso daqui. 0004 já está usado em outro PR; esta é a 0005.
--
-- Retenção: 5 anos. O expurgo NÃO é automático (o DELETE está bloqueado).
-- No dia do expurgo, com um corte em UTC cinco anos atrás (ex.: 2021-10-31T00:00:00.000Z):
--   DROP TRIGGER IF EXISTS aceite_termos_bloqueia_update;
--   DROP TRIGGER IF EXISTS aceite_termos_bloqueia_delete;
--   DELETE FROM aceite_termos WHERE aceito_em < '2021-10-31T00:00:00.000Z';
--   e recrie os dois triggers com o SQL abaixo.
-- O IP e o user-agent não saem na API do painel nem no site.

ALTER TABLE reservas ADD COLUMN consentiu_whatsapp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS aceite_termos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id TEXT NOT NULL,
  termo_versao TEXT NOT NULL,
  termo_hash TEXT NOT NULL,
  aceito_em TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  UNIQUE (reserva_id, termo_versao)
);

CREATE TRIGGER IF NOT EXISTS aceite_termos_bloqueia_update
BEFORE UPDATE ON aceite_termos
BEGIN
  SELECT RAISE(ABORT, 'aceite_termos é somente inclusão');
END;

CREATE TRIGGER IF NOT EXISTS aceite_termos_bloqueia_delete
BEFORE DELETE ON aceite_termos
BEGIN
  SELECT RAISE(ABORT, 'aceite_termos é somente inclusão');
END;

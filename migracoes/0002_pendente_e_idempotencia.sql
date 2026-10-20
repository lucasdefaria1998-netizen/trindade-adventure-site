-- Prazo da reserva pendente e chave de idempotência (S05).
-- O _worker.js aplica isto sozinho, uma vez, na primeira reserva ou consulta depois do deploy
-- (e ignora se já estiver aplicado). Este arquivo registra o esquema e permite aplicar à mão ANTES
-- de publicar, se preferir:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0002_pendente_e_idempotencia.sql
-- Se algum ALTER responder "duplicate column name", é porque já foi aplicado (pelo worker): pode ignorar.
--
-- Nenhuma linha existente é alterada: reservas antigas ficam com expira_em vazio, ou seja,
-- NUNCA expiram e continuam contando na vaga como sempre (a regra de prazo só vale para
-- reservas criadas depois deste código entrar no ar).
ALTER TABLE reservas ADD COLUMN expira_em TEXT;            -- ISO UTC; só a pendente nova tem prazo
ALTER TABLE reservas ADD COLUMN chave_idempotencia TEXT;   -- UUID enviado pelo site no cabeçalho Idempotency-Key
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_chave_idem
  ON reservas (chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

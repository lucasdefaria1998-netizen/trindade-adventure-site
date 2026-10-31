-- Crianças até 12 anos não pagam. O saldo de 70% é no dia do passeio (presencial).
-- NÃO APLICADA À MÃO EM PRODUÇÃO. O _worker.js cria estas colunas sozinho na primeira
-- reserva ou consulta de disponibilidade (garantirEsquemaReservas), com ou sem o
-- pagamento online ligado. Para aplicar antes, se preferir:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0004_criancas_saldo_no_dia.sql
-- "duplicate column name" significa que o worker já aplicou: pode ignorar.
--
-- Reservas antigas ficam com adultos/criancas vazios: o código trata isso como
-- "todo o pax paga", que era a regra de antes.
ALTER TABLE reservas ADD COLUMN adultos INTEGER;          -- pagantes (13 anos ou mais); vazio = legado, todo pax paga
ALTER TABLE reservas ADD COLUMN criancas INTEGER;         -- até 12 anos, não entram no total nem no sinal
ALTER TABLE reservas ADD COLUMN idades_criancas TEXT;     -- JSON, uma idade inteira por criança (0 a 12)

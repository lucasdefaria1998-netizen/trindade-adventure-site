-- Esquema MÍNIMO, deduzido das consultas do _worker.js, só para testes locais
-- (wrangler pages dev --local). NÃO é o esquema oficial do banco de produção.
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS reservas (
  id TEXT PRIMARY KEY, codigo TEXT, criado_em TEXT, plano TEXT, data TEXT, hora REAL, pax INTEGER,
  nome TEXT, telefone TEXT, email TEXT, obs TEXT, total REAL, voucher REAL, origem TEXT,
  origem_detalhe TEXT, como_conheceu TEXT, instagram_cliente TEXT, seguiu_instagram INTEGER,
  status TEXT, canal TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS bloqueios (id TEXT PRIMARY KEY, data TEXT, hora REAL, motivo TEXT, criado_em TEXT);
CREATE TABLE IF NOT EXISTS eventos (ts TEXT, tipo TEXT, origem TEXT, origem_detalhe TEXT, sessao TEXT, reserva_codigo TEXT);
INSERT OR IGNORE INTO config (chave, valor) VALUES ('capacidade','20'), ('proximo_codigo','1001');

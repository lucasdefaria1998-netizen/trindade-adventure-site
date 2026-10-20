-- Esquema do banco D1 usado SÓ nos testes locais (wrangler pages dev --local).
-- Espelha o esquema de produção (conferido em 2026-10-20, leitura): mesmas colunas,
-- tipos e restrições (codigo UNIQUE, NOT NULL…). Não é uma migração: nada daqui roda
-- na produção. A tabela rate_limit se cria sozinha pelo _worker.js (ver migracoes/).
CREATE TABLE IF NOT EXISTS reservas (
  id TEXT PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  criado_em TEXT NOT NULL,
  plano TEXT NOT NULL,
  data TEXT NOT NULL,
  hora REAL NOT NULL,
  pax INTEGER NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT,
  obs TEXT,
  total INTEGER NOT NULL,
  voucher INTEGER NOT NULL DEFAULT 0,
  origem TEXT,
  origem_detalhe TEXT,
  como_conheceu TEXT,
  instagram_cliente TEXT,
  seguiu_instagram INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  canal TEXT NOT NULL DEFAULT 'site',
  atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS bloqueios (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  hora REAL,
  motivo TEXT,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tipo TEXT NOT NULL,
  origem TEXT,
  origem_detalhe TEXT,
  sessao TEXT,
  reserva_codigo TEXT
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT OR IGNORE INTO config (chave, valor) VALUES
  ('capacidade','20'), ('slot_inicio','8'), ('slot_fim','15'), ('saida_apos','20'), ('cancelamento_h','12'),
  ('proximo_codigo','1001'), ('whatsapp','5524993337247'), ('instagram','trindadeadventure'), ('cupom','TRINDADE10'),
  ('beneficio_instagram','Siga e receba as fotos do seu dia de passeio por lá.');

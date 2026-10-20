-- Contador do limite de pedidos por IP (portão dos POST públicos, S03).
-- O _worker.js cria esta tabela sozinho na primeira vez que precisa dela; este
-- arquivo existe para registrar o esquema e permitir aplicar à mão:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0001_rate_limit.sql
-- (só o Lucas roda comandos --remote).
CREATE TABLE IF NOT EXISTS rate_limit (
  chave   TEXT    NOT NULL,   -- "<rota>|<ip>"
  janela  INTEGER NOT NULL,   -- floor(epoch_s / tamanho_da_janela_s)
  n       INTEGER NOT NULL,   -- pedidos contados nesta janela
  expira  INTEGER NOT NULL,   -- epoch_s do fim da janela (para limpeza)
  PRIMARY KEY (chave, janela)
);

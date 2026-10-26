-- Pagamento online das trilhas guiadas pelo Asaas (30% ou 100% em outro dia; 100% no mesmo dia).
-- NÃO APLICADA EM PRODUÇÃO. O _worker.js aplica isto sozinho, uma vez, mas SÓ quando o pagamento
-- online está ligado (PAGAMENTO_ONLINE=1 + ASAAS_API_KEY + ASAAS_WEBHOOK_TOKEN). Para aplicar à mão
-- antes de ligar, se preferir:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0003_pagamento_asaas.sql
-- Se algum ALTER responder "duplicate column name", é porque já foi aplicado (pelo worker): pode ignorar.
--
-- Nenhuma linha existente é alterada: reservas antigas ficam com as colunas novas vazias (fluxo de
-- sempre, confirmadas pela operação no WhatsApp).
ALTER TABLE reservas ADD COLUMN pagamento_modalidade TEXT;  -- 'sinal' (30%) | 'integral' (100%) | vazio = sem pagamento online
ALTER TABLE reservas ADD COLUMN pagamento_status TEXT;      -- 'aguardando' | 'sinal_pago' | 'quitado' | 'pago_sem_vaga' | 'falha_asaas'

-- Um link de pagamento (Checkout do Asaas) por linha.
CREATE TABLE IF NOT EXISTS cobrancas (
  id TEXT PRIMARY KEY,
  reserva_id TEXT NOT NULL,
  tipo TEXT NOT NULL,                       -- 'sinal' | 'integral' | 'saldo'
  valor_centavos INTEGER NOT NULL,
  asaas_id TEXT UNIQUE,                     -- id do checkout no Asaas
  ref_publica TEXT NOT NULL UNIQUE,         -- sorteio de 128 bits: a página de volta consulta o status por ele
  link TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando', -- 'aguardando' | 'paga' | 'expirada' | 'cancelada'
  criado_em TEXT NOT NULL,
  expira_em TEXT,
  pago_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_cobrancas_reserva ON cobrancas (reserva_id);

-- Eventos do webhook do Asaas já processados (o Asaas pode reenviar o mesmo evento).
CREATE TABLE IF NOT EXISTS asaas_eventos (
  id TEXT PRIMARY KEY,
  evento TEXT,
  recebido_em TEXT NOT NULL
);

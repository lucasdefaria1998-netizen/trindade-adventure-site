-- Rede de parceiros indicadores (estacionamentos, restaurantes, pousadas, comércio): cadastro, QR/link de
-- atribuição, check-in do guia, comissão por participante presente e vouchers de alimentação.
-- NÃO APLICADA EM PRODUÇÃO. O _worker.js aplica isto sozinho, uma vez, mas SÓ quando
-- config.parceiros_ativo = '1' (desligado por padrão: nenhuma linha aqui roda sem essa flag). Para aplicar à
-- mão antes de ligar, se preferir:
--   npx wrangler d1 execute trindade-adventure --remote --file=migracoes/0004_parceiros.sql
-- Se algum ALTER responder "duplicate column name", é porque já foi aplicado (pelo worker): pode ignorar.
--
-- Nenhuma linha existente de "reservas" é alterada: reservas antigas ficam com as colunas novas vazias
-- (sem parceiro, sem guia — fluxo de sempre). Valores de dinheiro em centavos, como no resto do banco.

-- Quem indica: estacionamento, restaurante, pousada, comércio. "codigo" é o identificador usado no QR/link
-- (/p/<codigo> e ?parceiro=<codigo>) — sorteado pelo painel (não é o nome nem o slug do parceiro; ver S3/C6,
-- TODO(DECISAO-C6) sobre o formato definitivo). "cupom" é opcional, para o turista digitar na reserva.
CREATE TABLE IF NOT EXISTS parceiros (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,                        -- 'estacionamento' | 'restaurante' | 'pousada' | 'comercio' | 'outro'
  codigo TEXT NOT NULL UNIQUE,                -- identificador no QR/link; não adivinhável (ver S3)
  cupom TEXT UNIQUE,                          -- opcional; sem desconto ao turista (TODO(DECISAO-D2))
  contato TEXT,                               -- telefone/e-mail do parceiro (uso interno do admin, nunca exposto)
  pix_chave TEXT,                             -- só admin; nunca em resposta pública nem log (repasse manual)
  recebe_voucher INTEGER NOT NULL DEFAULT 0,  -- 1 = parceiro também é restaurante que aceita o voucher de alimentação
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_parceiros_ativo ON parceiros (ativo);

-- Guias parceiros: cadastro e escala (fase 1 — sem pagamento pelo sistema; ver D8/TODO(DECISAO-D8)).
CREATE TABLE IF NOT EXISTS guias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  whatsapp TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  obs TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);

-- Atribuição da reserva ao parceiro e designação do guia. Mantido fora da tabela "origem/origem_detalhe"
-- (que já existe e segue servindo o funil de marketing) porque aqui o servidor valida e resolve um
-- parceiro real, nunca aceita o parceiro_id vindo do cliente (ver S3).
ALTER TABLE reservas ADD COLUMN parceiro_id TEXT;      -- NULL = sem parceiro
ALTER TABLE reservas ADD COLUMN parceiro_via TEXT;     -- 'link' | 'qr' | 'cupom'
ALTER TABLE reservas ADD COLUMN parceiro_em TEXT;      -- quando a atribuição foi resolvida (ISO)
ALTER TABLE reservas ADD COLUMN guia_id TEXT;          -- guia designado (admin/escala)
CREATE INDEX IF NOT EXISTS idx_reservas_parceiro ON reservas (parceiro_id);

-- Check-in do guia: nº de presentes por reserva (0..pax; 0 = faltou). Recalcular (refazer o check-in) é
-- permitido e idempotente — ver garantirEsquemaParceiros/checkin no _worker.js.
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  reserva_id TEXT NOT NULL UNIQUE,
  presentes INTEGER NOT NULL,
  guia_id TEXT,
  status TEXT NOT NULL,                      -- 'presente' | 'faltou' (presentes = 0)
  feito_em TEXT NOT NULL,
  feito_por TEXT                              -- e-mail do admin/guia que fez o check-in (auditoria)
);

-- Comissão do parceiro: R$10 (config.comissao_por_pax_centavos) por presente, calculada só no servidor a
-- partir do check-in. status fica "atualizável" (pendente -> paga) pelo admin — ledger imutável é
-- [proposta] de segurança além do pedido do cliente (ver C9), não implementado nesta fase.
CREATE TABLE IF NOT EXISTS comissoes (
  id TEXT PRIMARY KEY,
  reserva_id TEXT NOT NULL UNIQUE,
  parceiro_id TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',   -- 'pendente' | 'paga' | 'cancelada'
  criado_em TEXT NOT NULL,
  pago_em TEXT,
  pago_obs TEXT
);
CREATE INDEX IF NOT EXISTS idx_comissoes_parceiro ON comissoes (parceiro_id, status);

-- Voucher de alimentação (planos com voucher > 0): só a estrutura nesta fase — condições de uso, validade
-- e baixa pelo restaurante ficam como TODO(DECISAO-D3).
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  reserva_id TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  valor_unit_centavos INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'emitido',    -- 'emitido' | 'usado' | 'cancelado'
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vouchers_reserva ON vouchers (reserva_id);

-- Flags e valores em centavos de config (INSERT OR IGNORE: nunca sobrescreve o que o admin já configurou).
INSERT OR IGNORE INTO config (chave, valor) VALUES
  ('parceiros_ativo', '0'),
  ('comissao_por_pax_centavos', '1000'),
  ('parceiro_validade_dias', '7'),
  ('parceiro_regra', 'ultimo_clique');

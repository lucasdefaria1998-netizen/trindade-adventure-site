// Testes da regra de pagamento online das TRILHAS GUIADAS (Asaas): 30% ou 100% para outro dia, 100% no mesmo dia,
// confirmação só depois do pagamento (webhook), link do saldo pelo painel.
//
// Roda o _worker.js DENTRO deste processo, sem wrangler e sem rede: o D1 é um SQLite em memória (node:sqlite,
// mesmo dialeto do D1), o Asaas e o Turnstile são simulados trocando o fetch global, e o relógio é fixo
// (classe Date trocada) para testar "hoje" e "amanhã" em Trindade a qualquer hora do dia.
// Nada aqui toca o Asaas de verdade nem a produção.
//
//   node testes/testar-pagamento.mjs          (Node 22.5+ por causa do node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let falhas = 0, total = 0;
function checar(nome, ok, detalhe) {
  total++; if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${nome}${!ok && detalhe !== undefined ? "  →  " + detalhe : ""}`);
}

// ---------- relógio fixo ----------
const DataReal = Date;
let agoraFixo = DataReal.parse("2026-10-26T13:00:00Z"); // 10:00 em Trindade (UTC−3), segunda 26/10/2026
class DataFixa extends DataReal {
  constructor(...a) { if (a.length) super(...a); else super(agoraFixo); }
  static now() { return agoraFixo; }
}
globalThis.Date = DataFixa;
const relogio = isoUTC => { agoraFixo = DataReal.parse(isoUTC); };
const HOJE = "2026-10-26", AMANHA = "2026-10-27";

// ---------- D1 falso sobre node:sqlite ----------
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("./schema-local.sql", import.meta.url), "utf8"));
const valor = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
class Stmt {
  constructor(sql) { this.sql = sql; this.args = []; }
  bind(...a) { this.args = a.map(valor); return this; }
  async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
}
const DB = { prepare: sql => new Stmt(sql) };
const linha = (q, ...p) => db.prepare(q).get(...p);

// ---------- Asaas e Turnstile simulados ----------
let asaasPedidos = [], asaasFalha = false, seqCk = 0;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://challenges.cloudflare.com/")) {
    return new Response(JSON.stringify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("http://asaas.teste/")) {
    const corpo = JSON.parse(opts.body);
    asaasPedidos.push({ url, headers: opts.headers, corpo });
    if (asaasFalha) return new Response(JSON.stringify({ errors: [{ code: "x", description: "fora" }] }), { status: 500 });
    const id = "ck_teste_" + (++seqCk);
    return new Response(JSON.stringify({ id, link: "https://sandbox.asaas.com/checkoutSession/show?id=" + id, status: "ACTIVE" }), { headers: { "content-type": "application/json" } });
  }
  throw new Error("fetch inesperado nos testes: " + url);
};

const src = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const TOKEN = "token-webhook-de-teste-0123456789abcdef";
const ORIGEM = "https://trindadeadventury.com.br";
const ENV_ON = {
  DB, ASSETS: { fetch: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])) },
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  PAGAMENTO_ONLINE: "1", ASAAS_API_KEY: "chave-asaas-de-teste", ASAAS_WEBHOOK_TOKEN: TOKEN, ASAAS_API_URL: "http://asaas.teste",
  ADMIN_KEY: "admin-teste"
};
const ENV_OFF = { ...ENV_ON, PAGAMENTO_ONLINE: undefined };

let seq = 0;
const tel = () => "2499" + String(1000000 + (++seq)).padStart(7, "0");
const ip = () => "10.9.8." + (++seq % 250);
async function reservar(extra = {}, env = ENV_ON, cab = {}) {
  const corpo = { plano: "essencial", data: AMANHA, hora: 9, pax: 1, nome: "Teste Pagamento", telefone: tel(), origem: "direto", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX", ...extra };
  const r = await w.default.fetch(new Request(ORIGEM + "/api/reservas", {
    method: "POST", headers: { origin: ORIGEM, "content-type": "application/json", "cf-connecting-ip": ip(), ...cab }, body: JSON.stringify(corpo)
  }), env);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
async function webhook(corpo, token = TOKEN, env = ENV_ON) {
  const r = await w.default.fetch(new Request(ORIGEM + "/api/asaas/webhook", {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { "asaas-access-token": token } : {}) }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo)
  }), env);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
async function getJSON(caminho, env = ENV_ON, cab = {}) {
  const r = await w.default.fetch(new Request(ORIGEM + caminho, { headers: { "cf-connecting-ip": ip(), ...cab } }), env);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
async function admin(caminho, metodo = "GET", corpo) {
  const r = await w.default.fetch(new Request(ORIGEM + caminho, {
    method: metodo, headers: { "X-Admin-Key": "admin-teste", origin: ORIGEM, "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined
  }), ENV_ON);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
const reservaPorRef = ref => linha("SELECT r.* FROM reservas r JOIN cobrancas c ON c.reserva_id = r.id WHERE c.ref_publica = ?", ref);
const checkoutPorRef = ref => linha("SELECT asaas_id FROM cobrancas WHERE ref_publica = ?", ref).asaas_id;
let seqEv = 0;
const pagar = (ckId, evento = "CHECKOUT_PAID", id = "evt_" + (++seqEv)) => webhook({ id, event: evento, checkout: { id: ckId, status: "PAID" } });

// ======================= funções puras =======================
{
  const c = w.calcularCobranca({ totalReais: 80, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  R$ 80 para amanhã, 30%: paga R$ 24 agora e fica R$ 56 de saldo", c.modalidade === "sinal" && c.agoraCentavos === 2400 && c.saldoCentavos === 5600 && c.totalCentavos === 8000, JSON.stringify(c));
  const i = w.calcularCobranca({ totalReais: 80, data: AMANHA, hoje: HOJE, escolha: "integral" });
  checar("P1  R$ 80 para amanhã, 100%: paga R$ 80 agora, saldo 0", i.modalidade === "integral" && i.agoraCentavos === 8000 && i.saldoCentavos === 0, JSON.stringify(i));
  const m = w.calcularCobranca({ totalReais: 80, data: HOJE, hoje: HOJE });
  checar("P1  R$ 80 para hoje: 100% obrigatório (R$ 80)", m.mesmoDia && m.modalidade === "integral" && m.agoraCentavos === 8000, JSON.stringify(m));
  const ms = w.calcularCobranca({ totalReais: 80, data: HOJE, hoje: HOJE, escolha: "sinal" });
  checar("P1  para hoje, pedir 30% é recusado (motivo mesmo_dia_integral)", ms.erro && ms.motivo === "mesmo_dia_integral", JSON.stringify(ms));
  const sem = w.calcularCobranca({ totalReais: 80, data: AMANHA, hoje: HOJE });
  checar("P1  outro dia sem escolher 30%/100% → erro (não presume)", !!sem.erro && !sem.motivo, JSON.stringify(sem));
  const r80 = w.calcularCobranca({ totalReais: 80, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  Essencial do site (R$ 80): R$ 24 + R$ 56", r80.agoraCentavos === 2400 && r80.saldoCentavos === 5600, JSON.stringify(r80));
  const q = w.calcularCobranca({ totalReais: 75, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  arredondamento: R$ 75 → R$ 22,50 + R$ 52,50 (centavos, soma fecha no total)", q.agoraCentavos === 2250 && q.saldoCentavos === 5250);
  const q2 = w.calcularCobranca({ totalReais: 0.55, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  arredondamento ao centavo mais próximo (55 centavos → 17 + 38)", q2.agoraCentavos === 17 && q2.saldoCentavos === 38, JSON.stringify(q2));
  checar("P1  trilhas guiadas = Essencial e Adventure; Boat fora", w.planoPagaOnline("essencial") && w.planoPagaOnline("adventure") && !w.planoPagaOnline("boat") && !w.planoPagaOnline("parapente") && !w.planoPagaOnline("__proto__"));
  checar("P1  sinal configurável numa constante (30)", w.PAGAMENTO.percentualSinal === 30);
  const cfg = { saidaApos: 20 };
  checar("P1  limite para quitar = 15 min antes da saída (concentração 9h → saída 9h20 → 9h05)", new DataReal(w.limiteQuitacaoMs(AMANHA, 9, cfg)).toISOString() === "2026-10-27T12:05:00.000Z");
  checar("P1  link curto demais (< 10 min, mínimo do Asaas) → null", w.minutosDoLink(0, 9 * 60000, 30) === null && w.minutosDoLink(0, 10 * 60000, 30) === 10 && w.minutosDoLink(0, 999 * 60000, 30) === 30);
  checar("P1  ligado só com PAGAMENTO_ONLINE=1 + chave + token", w.pagamentoOnlineAtivo(ENV_ON) && !w.pagamentoOnlineAtivo(ENV_OFF) && !w.pagamentoOnlineAtivo({ ...ENV_ON, ASAAS_WEBHOOK_TOKEN: "" }) && !w.pagamentoOnlineAtivo({ ...ENV_ON, PAGAMENTO_ONLINE: "true" }));
}

// ======================= desligado: nada muda =======================
{
  const r = await reservar({}, ENV_OFF);
  checar("D1  desligado: trilha segue o fluxo antigo (código + WhatsApp, sem pagamento)", r.status === 200 && /^TA-/.test(r.corpo.codigo) && r.corpo.whatsapp && !r.corpo.pagamento, JSON.stringify(r));
  const disp = await getJSON("/api/disponibilidade?data=" + AMANHA, ENV_OFF);
  checar("D1  desligado: /api/disponibilidade sem pagamentoOnline", disp.status === 200 && !("pagamentoOnline" in disp.corpo));
  const wh = await webhook({ id: "evt_x", event: "CHECKOUT_PAID", checkout: { id: "x" } }, TOKEN, ENV_OFF);
  checar("D1  desligado: webhook responde 404", wh.status === 404, wh.status);
  checar("D1  desligado: nenhuma chamada ao Asaas", asaasPedidos.length === 0);
}

// ======================= ligado: disponibilidade =======================
{
  const disp = await getJSON("/api/disponibilidade?data=" + AMANHA);
  const p = disp.corpo.pagamentoOnline;
  checar("L1  ligado: disponibilidade informa trilhas com pagamento, 30% e o 'hoje' de Trindade", p && p.planos.join() === "essencial,adventure" && p.percentualSinal === 30 && p.hoje === HOJE, JSON.stringify(p));
  relogio("2026-10-27T02:30:00Z"); // 23:30 de 26/10 em Trindade (já é 27/10 em UTC)
  const d2 = await getJSON("/api/disponibilidade?data=" + AMANHA);
  checar("L1  'hoje' segue o fuso de Trindade, não o UTC (23h30 de 26/10)", d2.corpo.pagamentoOnline.hoje === HOJE, d2.corpo.pagamentoOnline.hoje);
  relogio("2026-10-26T13:00:00Z");
}

// ======================= outro dia, 30% =======================
let refSinal, idSinal;
{
  asaasPedidos = [];
  const r = await reservar({ pax: 2, pagamento: "sinal" });
  const pg = r.corpo && r.corpo.pagamento;
  checar("S1  amanhã + 30%: 200 com link do Asaas", r.status === 200 && pg && /^https:\/\/sandbox\.asaas\.com\//.test(pg.link), JSON.stringify(r));
  checar("S1  valores: R$ 48 agora, total R$ 160, saldo R$ 112 (Essencial R$ 80 × 2)", pg.valor === 48 && pg.total === 160 && pg.saldo === 112 && pg.modalidade === "sinal" && pg.mesmoDia === false, JSON.stringify(pg));
  checar("S1  o código da reserva NÃO vem antes do pagamento", !("codigo" in r.corpo) && !("whatsapp" in r.corpo), Object.keys(r.corpo).join());
  const ped = asaasPedidos[0];
  checar("S1  checkout criado no Asaas: POST /v3/checkouts, access_token, Pix, DETACHED, valor 48", ped && ped.url === "http://asaas.teste/v3/checkouts" && ped.headers.access_token === "chave-asaas-de-teste" && ped.corpo.billingTypes.join() === "PIX" && ped.corpo.chargeTypes.join() === "DETACHED" && ped.corpo.items[0].value === 48 && ped.corpo.items[0].quantity === 1 && typeof ped.corpo.items[0].imageBase64 === "string", JSON.stringify(ped && ped.corpo));
  checar("S1  checkout: expira em 30 min, volta para /reservar?pagamento=<ref>, sem o código na descrição", ped.corpo.minutesToExpire === 30 && ped.corpo.callback.successUrl === ORIGEM + "/reservar?pagamento=" + pg.ref && !/TA-/.test(JSON.stringify(ped.corpo)));
  refSinal = pg.ref;
  const res = reservaPorRef(refSinal); idSinal = res.id;
  checar("S1  banco: reserva pendente, modalidade sinal, pagamento aguardando", res.status === "pendente" && res.pagamento_modalidade === "sinal" && res.pagamento_status === "aguardando" && ped.corpo.externalReference === res.id);
  checar("S1  a vaga fica segura só enquanto o link vale (+5 min), não 6 h", res.expira_em === "2026-10-26T13:35:00.000Z", res.expira_em);
  const st = await getJSON("/api/pagamento?ref=" + refSinal);
  checar("S1  status antes de pagar: aguardando, sem código", st.status === 200 && st.corpo.status === "aguardando" && !st.corpo.codigo, JSON.stringify(st.corpo));

  // webhook
  const semToken = await webhook({ id: "evt_a", event: "CHECKOUT_PAID", checkout: { id: checkoutPorRef(refSinal) } }, null);
  const tokenErrado = await webhook({ id: "evt_a", event: "CHECKOUT_PAID", checkout: { id: checkoutPorRef(refSinal) } }, TOKEN + "x");
  checar("S2  webhook sem token / com token errado → 401, nada muda", semToken.status === 401 && tokenErrado.status === 401 && reservaPorRef(refSinal).status === "pendente");
  checar("S2  webhook com corpo inválido → 400", (await webhook("{")).status === 400 && (await webhook({ event: "CHECKOUT_PAID" })).status === 400);
  const pago = await pagar(checkoutPorRef(refSinal), "CHECKOUT_PAID", "evt_sinal_1");
  const depois = reservaPorRef(refSinal);
  checar("S2  CHECKOUT_PAID: reserva confirmada, pagamento 'sinal_pago'", pago.status === 200 && depois.status === "confirmada" && depois.pagamento_status === "sinal_pago", JSON.stringify(depois));
  const st2 = await getJSON("/api/pagamento?ref=" + refSinal);
  checar("S2  status depois de pagar: pago, confirmada, código liberado, saldo R$ 112", st2.corpo.status === "pago" && st2.corpo.confirmada === true && st2.corpo.codigo === depois.codigo && st2.corpo.saldo === 112, JSON.stringify(st2.corpo));
  const rep = await pagar(checkoutPorRef(refSinal), "CHECKOUT_PAID", "evt_sinal_1");
  checar("S2  mesmo evento de novo: 200 'repetido', nada muda", rep.status === 200 && rep.corpo.repetido === true);
  const outroId = await pagar(checkoutPorRef(refSinal), "CHECKOUT_PAID");
  checar("S2  outro evento para o mesmo checkout: não duplica pagamento", outroId.status === 200 && linha("SELECT COUNT(*) AS n FROM cobrancas WHERE reserva_id = ? AND status = 'paga'", idSinal).n === 1);
  const desconhecido = await pagar("ck_que_nao_existe");
  checar("S2  checkout desconhecido: 200 (não trava a fila do Asaas) e nada muda", desconhecido.status === 200);
  checar("S2  ref de pagamento inválida → 400; inexistente → 404", (await getJSON("/api/pagamento?ref=abc")).status === 400 && (await getJSON("/api/pagamento?ref=" + "0".repeat(32))).status === 404);
}

// ======================= saldo pelo painel =======================
{
  asaasPedidos = [];
  const s = await admin(`/api/admin/reservas/${idSinal}/saldo`, "POST", {});
  checar("A1  painel gera o link do saldo: R$ 112", s.status === 200 && s.corpo.valor === 112 && /^https:\/\//.test(s.corpo.link), JSON.stringify(s));
  checar("A1  link do saldo no Asaas vale até 15 min antes da saída (agora 10h → amanhã 9h05 = 1385 min; teto 24 h)", asaasPedidos[0].corpo.minutesToExpire === 1385 && asaasPedidos[0].corpo.items[0].value === 112, asaasPedidos[0] && asaasPedidos[0].corpo.minutesToExpire);
  const s2 = await admin(`/api/admin/reservas/${idSinal}/saldo`, "POST", {});
  checar("A1  pedir de novo devolve o mesmo link enquanto vale (sem criar outro)", s2.status === 200 && s2.corpo.repetido === true && s2.corpo.link === s.corpo.link && asaasPedidos.length === 1);
  const lista = await admin(`/api/admin/reservas?de=${AMANHA}&ate=${AMANHA}`);
  const item = lista.corpo.reservas.find(x => x.id === idSinal);
  checar("A1  lista do painel mostra modalidade, situação e quanto já entrou", item && item.pagamento_modalidade === "sinal" && item.pagamento_status === "sinal_pago" && item.pago_centavos === 4800, JSON.stringify(item));
  const ck = linha("SELECT asaas_id FROM cobrancas WHERE reserva_id = ? AND tipo = 'saldo'", idSinal).asaas_id;
  await pagar(ck);
  const q = linha("SELECT status, pagamento_status FROM reservas WHERE id = ?", idSinal);
  checar("A1  saldo pago: reserva 'quitado'", q.status === "confirmada" && q.pagamento_status === "quitado", JSON.stringify(q));
  const s3 = await admin(`/api/admin/reservas/${idSinal}/saldo`, "POST", {});
  checar("A1  reserva quitada não gera outro link (409)", s3.status === 409, s3.status);

  // prazo do saldo
  const r = await reservar({ pagamento: "sinal" });
  await pagar(checkoutPorRef(r.corpo.pagamento.ref));
  const id = reservaPorRef(r.corpo.pagamento.ref).id;
  relogio("2026-10-27T12:00:00Z"); // amanhã 9h00 — limite era 9h05: só 5 min, menos que o mínimo do Asaas
  const tarde = await admin(`/api/admin/reservas/${id}/saldo`, "POST", {});
  checar("A2  depois do limite (15 min antes da saída) o painel não gera link do saldo (409)", tarde.status === 409, JSON.stringify(tarde));
  relogio("2026-10-27T11:30:00Z"); // 8h30 → 35 min até 9h05
  asaasPedidos = [];
  const cedo = await admin(`/api/admin/reservas/${id}/saldo`, "POST", {});
  checar("A2  perto do passeio, o link do saldo vence exatamente no limite (35 min)", cedo.status === 200 && asaasPedidos[0].corpo.minutesToExpire === 35, asaasPedidos[0] && asaasPedidos[0].corpo.minutesToExpire);
  checar("A2  saldo não pago NÃO cancela nada sozinho (reserva segue confirmada)", linha("SELECT status FROM reservas WHERE id = ?", id).status === "confirmada");
  relogio("2026-10-26T13:00:00Z");
  checar("A2  reserva pendente (sem sinal) não tem saldo a cobrar (409)", (await admin(`/api/admin/reservas/${reservaPorRef((await reservar({ pagamento: "sinal" })).corpo.pagamento.ref).id}/saldo`, "POST", {})).status === 409);
}

// ======================= outro dia, 100% =======================
{
  const r = await reservar({ plano: "adventure", hora: 8, pagamento: "integral" });
  const pg = r.corpo.pagamento;
  checar("I1  Adventure amanhã + 100%: cobra o total (R$ 150), saldo 0", r.status === 200 && pg.valor === 150 && pg.saldo === 0 && pg.modalidade === "integral", JSON.stringify(r.corpo));
  await pagar(checkoutPorRef(pg.ref));
  const res = reservaPorRef(pg.ref);
  checar("I1  pago: confirmada e 'quitado'", res.status === "confirmada" && res.pagamento_status === "quitado");
  const sem = await reservar({});
  checar("I1  outro dia sem escolher 30%/100% → 422 erros.pagamento, nada gravado", sem.status === 422 && sem.corpo.erros && sem.corpo.erros.pagamento, JSON.stringify(sem));
  const lixo = await reservar({ pagamento: "50" });
  checar("I1  escolha inválida → 422", lixo.status === 422);
}

// ======================= mesmo dia =======================
{
  asaasPedidos = [];
  const r = await reservar({ data: HOJE, hora: 11, pagamento: "integral" });
  const pg = r.corpo.pagamento;
  checar("M1  hoje 11h (agora 10h): 100% obrigatório, R$ 80", r.status === 200 && pg.mesmoDia === true && pg.modalidade === "integral" && pg.valor === 80, JSON.stringify(r.corpo));
  const r2 = await reservar({ data: HOJE, hora: 12 });
  checar("M1  hoje sem mandar escolha: também 100% (não precisa escolher)", r2.status === 200 && r2.corpo.pagamento.modalidade === "integral");
  const r3 = await reservar({ data: HOJE, hora: 13, pagamento: "sinal" });
  checar("M1  hoje pedindo 30% → 409 mesmo_dia_integral (não cobra valor diferente do que a pessoa viu)", r3.status === 409 && r3.corpo.motivo === "mesmo_dia_integral", JSON.stringify(r3));
  checar("M1  o checkout vale 30 min (há tempo até 15 min antes da saída)", asaasPedidos[0].corpo.minutesToExpire === 30);
  const st = await getJSON("/api/pagamento?ref=" + pg.ref);
  checar("M1  antes do pagamento: sem código", st.corpo.status === "aguardando" && !st.corpo.codigo);
  await pagar(checkoutPorRef(pg.ref));
  const st2 = await getJSON("/api/pagamento?ref=" + pg.ref);
  checar("M1  pago: código liberado só agora", st2.corpo.status === "pago" && /^TA-/.test(st2.corpo.codigo || ""), JSON.stringify(st2.corpo));

  const passou = await reservar({ data: HOJE, hora: 10, pagamento: "integral" });
  checar("M2  horário que já passou (10h, agora 10h) → 422 e nenhum checkout", passou.status === 422 && passou.corpo.erros.hora, JSON.stringify(passou));
  relogio("2026-10-26T13:56:00Z"); // 10h56: concentração 11h, saída 11h20, limite 11h05 → 9 min
  asaasPedidos = [];
  const apertado = await reservar({ data: HOJE, hora: 11, pagamento: "integral" });
  checar("M2  sem tempo para pagar até 15 min antes da saída → 409 sem_tempo_pagamento, nada no Asaas", apertado.status === 409 && apertado.corpo.motivo === "sem_tempo_pagamento" && asaasPedidos.length === 0, JSON.stringify(apertado));
  relogio("2026-10-26T13:45:00Z"); // 10h45 → 20 min até 11h05
  const curto = await reservar({ data: HOJE, hora: 11, pagamento: "integral", pax: 1 });
  checar("M2  com pouco tempo, o link vence no limite (20 min)", curto.status === 200 && asaasPedidos.at(-1).corpo.minutesToExpire === 20, JSON.stringify(curto.corpo));
  relogio("2026-10-26T13:00:00Z");
}

// ======================= lotação e vaga =======================
{
  const H = 14;
  db.prepare("UPDATE config SET valor = '3' WHERE chave = 'capacidade'").run();
  const a = await reservar({ hora: H, pax: 3, pagamento: "integral" });
  const b = await reservar({ hora: H, pax: 1, pagamento: "integral" });
  checar("V1  horário lotado (pendente aguardando pagamento segura a vaga) → 409 cheio, sem checkout", a.status === 200 && b.status === 409 && b.corpo.motivo === "cheio", `${a.status}/${b.status}`);
  // o link vence sem pagamento, outra pessoa ocupa a vaga, e o pagamento atrasado chega
  relogio("2026-10-26T13:40:00Z");
  const c = await reservar({ hora: H, pax: 3, pagamento: "integral" });
  checar("V1  link vencido (30 + 5 min) libera a vaga para outro cliente", c.status === 200, JSON.stringify(c.corpo));
  await pagar(checkoutPorRef(a.corpo.pagamento.ref));
  const ra = reservaPorRef(a.corpo.pagamento.ref);
  checar("V1  pagamento atrasado sem vaga: NÃO confirma (sem overbooking) e marca 'pago_sem_vaga' para a equipe", ra.status === "pendente" && ra.pagamento_status === "pago_sem_vaga", JSON.stringify(ra));
  const st = await getJSON("/api/pagamento?ref=" + a.corpo.pagamento.ref);
  checar("V1  status mostra pago mas não confirmada, sem código", st.corpo.status === "pago" && st.corpo.confirmada === false && !st.corpo.codigo, JSON.stringify(st.corpo));
  // pagamento atrasado COM vaga: confirma
  db.prepare("UPDATE config SET valor = '20' WHERE chave = 'capacidade'").run();
  const d = await reservar({ hora: 15, pax: 1, pagamento: "integral" });
  relogio("2026-10-26T14:30:00Z");
  await pagar(checkoutPorRef(d.corpo.pagamento.ref));
  checar("V1  pagamento atrasado com vaga ainda livre: confirma", reservaPorRef(d.corpo.pagamento.ref).status === "confirmada");
  relogio("2026-10-26T13:00:00Z");
  // expirado / cancelado no Asaas
  const e = await reservar({ hora: 12, pax: 1, pagamento: "sinal" });
  await pagar(checkoutPorRef(e.corpo.pagamento.ref), "CHECKOUT_EXPIRED");
  checar("V2  CHECKOUT_EXPIRED: cobrança 'expirada', reserva continua pendente (vence sozinha)", linha("SELECT status FROM cobrancas WHERE ref_publica = ?", e.corpo.pagamento.ref).status === "expirada" && reservaPorRef(e.corpo.pagamento.ref).status === "pendente");
}

// ======================= Asaas fora do ar / idempotência / outros passeios =======================
{
  asaasFalha = true;
  const telF = tel();
  const r = await reservar({ hora: 13, pagamento: "sinal", telefone: telF });
  checar("F1  Asaas fora: 503 pagamento_indisponivel (o site cai no WhatsApp)", r.status === 503 && r.corpo.motivo === "pagamento_indisponivel", JSON.stringify(r));
  checar("F1  e a reserva criada é cancelada na hora (não segura vaga)", (x => x.status === "cancelada" && x.pagamento_status === "falha_asaas")(linha("SELECT status, pagamento_status FROM reservas WHERE telefone = ?", "55" + telF) || linha("SELECT status, pagamento_status FROM reservas WHERE telefone LIKE ?", "%" + telF)));
  asaasFalha = false;

  const chave = "chave-idem-pagamento-0001";
  const corpo = { hora: 13, pax: 2, pagamento: "sinal", telefone: tel() };
  const r1 = await reservar(corpo, ENV_ON, { "idempotency-key": chave });
  const n = asaasPedidos.length;
  const r2 = await reservar(corpo, ENV_ON, { "idempotency-key": chave });
  checar("F2  reenvio com a mesma Idempotency-Key devolve o MESMO link, sem novo checkout", r1.status === 200 && r2.status === 200 && r2.corpo.repetido === true && r2.corpo.pagamento.link === r1.corpo.pagamento.link && asaasPedidos.length === n, JSON.stringify(r2.corpo));

  asaasPedidos = [];
  const boat = await reservar({ plano: "boat", hora: 8.5, pagamento: "sinal" });
  checar("F3  Boat (não é trilha) segue o fluxo antigo mesmo com o pagamento ligado", boat.status === 200 && /^TA-/.test(boat.corpo.codigo) && !boat.corpo.pagamento && asaasPedidos.length === 0, JSON.stringify(boat.corpo));
  const precos = src.match(/essencial: \{[^}]*preco: (\d+)/)[1] + "/" + src.match(/adventure: \{[^}]*preco: (\d+)/)[1] + "/" + src.match(/boat: \{[^}]*preco: (\d+)/)[1];
  checar("F3  preços dos planos (80/150/400)", precos === "80/150/400", precos);
}

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

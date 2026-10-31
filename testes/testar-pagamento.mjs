// Testes da regra de pagamento online (Asaas, só Pix) de todos os passeios com preço e horário fixos: 30% ou 100%
// para outro dia, 100% no mesmo dia, código logo após o pagamento (webhook), link do saldo (painel e automático 12 h
// antes), cancelamento com sinal retido aos 15 min da saída, pago sem vaga (reagendar / devolver).
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
let asaasPedidos = [], asaasFalha = false, seqCk = 0, estornoFalha = false;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://challenges.cloudflare.com/")) {
    return new Response(JSON.stringify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("http://asaas.teste/v3/payments")) {
    asaasPedidos.push({ url, metodo: opts.method || "GET", headers: opts.headers, corpo: opts.body ? JSON.parse(opts.body) : null });
    const m = /checkoutSession=([^&]+)/.exec(url);
    if (m) return new Response(JSON.stringify({ object: "list", data: [{ object: "payment", id: "pay_" + decodeURIComponent(m[1]), status: "RECEIVED", billingType: "PIX" }] }), { headers: { "content-type": "application/json" } });
    if (/\/refund$/.test(url)) {
      if (estornoFalha) return new Response(JSON.stringify({ errors: [{ code: "invalid_action", description: "Saldo insuficiente" }] }), { status: 400 });
      return new Response(JSON.stringify({ object: "payment", id: url.split("/")[5], status: "REFUNDED" }), { headers: { "content-type": "application/json" } });
    }
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
  DB, ASSETS: { fetch: async (req) => {
    const u = String(req && req.url || "");
    if (u.includes("apple-touch-icon")) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    return new Response(readFileSync(new URL("../site/index.html", import.meta.url), "utf8"), { headers: { "content-type": "text/html; charset=utf-8" } });
  } },
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  PAGAMENTO_ONLINE: "1", ASAAS_API_KEY: "chave-asaas-de-teste", ASAAS_WEBHOOK_TOKEN: TOKEN, ASAAS_API_URL: "http://asaas.teste",
  ADMIN_KEY: "admin-teste"
};
const ENV_OFF = { ...ENV_ON, PAGAMENTO_ONLINE: undefined };

let seq = 0;
const tel = () => "2499" + String(1000000 + (++seq)).padStart(7, "0");
const ip = () => "10.9.8." + (++seq % 250);
async function reservar(extra = {}, env = ENV_ON, cab = {}) {
  const corpo = { plano: "essencial", data: AMANHA, hora: 9, pax: 1, nome: "Teste Pagamento", telefone: tel(), origem: "direto", aceiteTermos: true, termoVersao: "v0-provisorio", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX", ...extra };
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
  checar("P1  todos os passeios com preço e horário fixos pagam online (Essencial, Adventure, Boat); parapente (sem horário, fora de PLANOS) não", w.planoPagaOnline("essencial") && w.planoPagaOnline("adventure") && w.planoPagaOnline("boat") && !w.planoPagaOnline("parapente") && !w.planoPagaOnline("__proto__"));
  const adv = w.calcularCobranca({ totalReais: 150 * 2, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  Adventure 2 pessoas: 30% sobre o TOTAL com voucher (R$ 300 → R$ 90 + R$ 210)", adv.agoraCentavos === 9000 && adv.saldoCentavos === 21000, JSON.stringify(adv));
  const para = w.calcularCobranca({ totalReais: 350, data: AMANHA, hoje: HOJE, escolha: "sinal" });
  checar("P1  regra 30% aplicada a um voo de parapente (R$ 350 → R$ 105 + R$ 245) — cálculo puro; o parapente não tem agenda, segue no WhatsApp", para.agoraCentavos === 10500 && para.saldoCentavos === 24500);
  checar("P1  só Pix online: billingTypes = [PIX] e nenhum cartão no worker nem no app.js", w.PAGAMENTO.formas.join() === "PIX" && !/CREDIT_CARD|DEBIT_CARD/.test(src) && !/CREDIT_CARD|DEBIT_CARD|cart[aã]o de cr[eé]dito/i.test(readFileSync(new URL("../site/app.js", import.meta.url), "utf8")));
  checar("P1  SALDO_ANTECEDENCIA_H: padrão 12; '6' → 6; '0' desliga; inválido → 12", w.saldoAntecedenciaH({}) === 12 && w.saldoAntecedenciaH({ SALDO_ANTECEDENCIA_H: "6" }) === 6 && w.saldoAntecedenciaH({ SALDO_ANTECEDENCIA_H: "0" }) === null && w.saldoAntecedenciaH({ SALDO_ANTECEDENCIA_H: "abc" }) === 12);
  checar("P1  nenhum PENDENTE-LUCAS sobrou no worker", !/PENDENTE-LUCAS/.test(src));
  checar("P1  sinal configurável numa constante (30)", w.PAGAMENTO.percentualSinal === 30);
  const cfg = { saidaApos: 20, cancelamentoH: 12 };
  // Saída 9h20 de 27/10 em Trindade = 12:20 UTC. 12 h antes = 00:20 UTC.
  checar("P1  estorno do sinal cabe até 12 h antes da saída (no instante exato, ainda cabe)", w.dentroDoPrazoDeEstorno(AMANHA, 9, cfg, DataReal.parse("2026-10-27T00:20:00.000Z")) === true);
  checar("P1  um minuto depois das 12 h, o sinal não é devolvido", w.dentroDoPrazoDeEstorno(AMANHA, 9, cfg, DataReal.parse("2026-10-27T00:21:00.000Z")) === false);
  checar("P1  criança até 12 anos não paga; 13 paga; pax legado continua todo mundo pagante", w.comporGrupo({ adultos: 2, criancas: 1, idadesCriancas: [12], pax: 3 }, 15).pax === 3 && !w.comporGrupo({ adultos: 2, criancas: 1, idadesCriancas: [12], pax: 3 }, 15).erros.idadesCriancas && !!w.comporGrupo({ adultos: 1, criancas: 1, idadesCriancas: [13], pax: 2 }, 15).erros.idadesCriancas && w.comporGrupo({ pax: 4 }, 15).adultos === 4 && !!w.comporGrupo({ adultos: 10, criancas: 6, idadesCriancas: [1, 2, 3, 4, 5, 6], pax: 16 }, 15).erros.pax);
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

// ======================= aceite dos termos antes de qualquer cobrança =======================
{
  asaasPedidos = [];
  const sem = await reservar({ aceiteTermos: false });
  checar("T0  sem aceite dos termos → 422 e nenhuma chamada ao Asaas", sem.status === 422 && sem.corpo.erros && sem.corpo.erros.aceiteTermos && asaasPedidos.length === 0, JSON.stringify(sem));
  const velho = await reservar({ termoVersao: "v9-inexistente" });
  checar("T0  versão de termo diferente da atual → 422 e nenhuma chamada ao Asaas", velho.status === 422 && asaasPedidos.length === 0, JSON.stringify(velho));
  const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const textoOff = w.textoTermosDe(html, false);
  checar("T0  v0-provisorio reusa o texto já publicado dos Termos (sem texto novo)", textoOff.length > 200 && textoOff.includes("O cancelamento é gratuito até 12 horas antes da saída.") && textoOff.includes("Não há pagamento pelo site.") && !/snorkel incluso/.test(textoOff), textoOff.slice(0, 180));
  const hash = await w.hashTexto(w.textoTermosDe(html, true));
  checar("T0  hash SHA-256 do texto tem 64 hex", /^[a-f0-9]{64}$/.test(hash) && hash === await w.hashTexto(w.textoTermosDe(html, true)), hash);
  const okAceite = await reservar({ consentiuWhatsapp: false, pagamento: "sinal" });
  const ref = okAceite.corpo && okAceite.corpo.pagamento && okAceite.corpo.pagamento.ref;
  const res = ref && reservaPorRef(ref);
  const aceite = res && linha("SELECT termo_versao, termo_hash, ip, user_agent FROM aceite_termos WHERE reserva_id = ?", res.id);
  checar("T0  aceite gravado com versão, hash e IP completo; a resposta pública não leva IP nem user-agent", okAceite.status === 200 && aceite && aceite.termo_versao === "v0-provisorio" && aceite.termo_hash === hash && aceite.ip.startsWith("10.9.8.") && !JSON.stringify(okAceite.corpo).includes(aceite.ip) && !("user_agent" in okAceite.corpo), JSON.stringify(aceite));
  let bloqueou = false;
  try { db.prepare("DELETE FROM aceite_termos WHERE reserva_id = ?").run(res.id); } catch { bloqueou = true; }
  checar("T0  a tabela de aceite recusa DELETE", bloqueou);
  let bloqueouUp = false;
  try { db.prepare("UPDATE aceite_termos SET termo_versao = 'x' WHERE reserva_id = ?").run(res.id); } catch { bloqueouUp = true; }
  checar("T0  a tabela de aceite recusa UPDATE", bloqueouUp);
}

// ======================= ligado: disponibilidade =======================
{
  const disp = await getJSON("/api/disponibilidade?data=" + AMANHA);
  const p = disp.corpo.pagamentoOnline;
  checar("L1  ligado: disponibilidade informa os passeios com pagamento (todos de PLANOS), 30% e o 'hoje' de Trindade", p && p.planos.join() === "essencial,adventure,boat" && p.percentualSinal === 30 && p.hoje === HOJE, JSON.stringify(p));
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
  checar("A1  link opcional do saldo vale 24 h (teto do Asaas), sem corte 15 min antes da saída", asaasPedidos[0].corpo.minutesToExpire === 1440 && asaasPedidos[0].corpo.items[0].value === 112, asaasPedidos[0] && asaasPedidos[0].corpo.minutesToExpire);
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
  relogio("2026-10-27T12:00:00Z"); // amanhã 9h00 em Trindade — a saída é 9h20; o saldo online não tem mais prazo
  asaasPedidos = [];
  const tarde = await admin(`/api/admin/reservas/${id}/saldo`, "POST", {});
  checar("A2  no dia do passeio o painel ainda gera o link opcional (24 h) e não cancela", tarde.status === 200 && asaasPedidos[0].corpo.minutesToExpire === 1440 && linha("SELECT status, pagamento_status FROM reservas WHERE id = ?", id).status === "confirmada", JSON.stringify(tarde));
  const pres = await admin(`/api/admin/reservas/${id}/saldo-presencial`, "POST", {});
  checar("A2  marcar saldo pago no dia não chama o Asaas e quita", pres.status === 200 && pres.corpo.forma === "presencial" && pres.corpo.pagamentoStatus === "quitado" && linha("SELECT pagamento_status FROM reservas WHERE id = ?", id).pagamento_status === "quitado" && linha("SELECT tipo, status FROM cobrancas WHERE reserva_id = ? AND tipo = 'saldo_presencial'", id).status === "paga", JSON.stringify(pres));
  const pres2 = await admin(`/api/admin/reservas/${id}/saldo-presencial`, "POST", {});
  checar("A2  marcar de novo é idempotente", pres2.status === 200 && pres2.corpo.repetido === true && linha("SELECT COUNT(*) AS n FROM cobrancas WHERE reserva_id = ? AND tipo = 'saldo_presencial'", id).n === 1);
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
  checar("M1  o checkout vale 30 min (há tempo até a saída)", asaasPedidos[0].corpo.minutesToExpire === 30);
  const st = await getJSON("/api/pagamento?ref=" + pg.ref);
  checar("M1  antes do pagamento: sem código", st.corpo.status === "aguardando" && !st.corpo.codigo);
  await pagar(checkoutPorRef(pg.ref));
  const st2 = await getJSON("/api/pagamento?ref=" + pg.ref);
  checar("M1  pago: código liberado só agora", st2.corpo.status === "pago" && /^TA-/.test(st2.corpo.codigo || ""), JSON.stringify(st2.corpo));

  const passou = await reservar({ data: HOJE, hora: 10, pagamento: "integral" });
  checar("M2  horário que já passou (10h, agora 10h) → 422 e nenhum checkout", passou.status === 422 && passou.corpo.erros.hora, JSON.stringify(passou));
  relogio("2026-10-26T13:56:00Z"); // 10h56: concentração 11h ainda vale; saída 11h20 → 24 min
  asaasPedidos = [];
  const curto = await reservar({ data: HOJE, hora: 11, pagamento: "integral", pax: 1 });
  checar("M2  perto da concentração, o link do Pix vence na saída (24 min)", curto.status === 200 && asaasPedidos.at(-1).corpo.minutesToExpire === 24, JSON.stringify(curto.corpo));
  relogio("2026-10-26T14:00:00Z"); // 11h00: a concentração das 11h já passou (a saída seria 11h20)
  const fechou = await reservar({ data: HOJE, hora: 11, pagamento: "integral" });
  checar("M2  concentração vencida → 422, sem checkout (o mínimo de 10 min do Asaas fica depois desse portão)", fechou.status === 422 && fechou.corpo.erros.hora && asaasPedidos.length === 1, JSON.stringify(fechou.corpo));
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
  checar("F3  Boat também paga online: 30% de R$ 400 = R$ 120, saldo R$ 280, sem código antes do pagamento", boat.status === 200 && boat.corpo.pagamento && boat.corpo.pagamento.valor === 120 && boat.corpo.pagamento.saldo === 280 && !boat.corpo.codigo && asaasPedidos.length === 1 && asaasPedidos[0].corpo.billingTypes.join() === "PIX", JSON.stringify(boat.corpo));
  const precos = src.match(/essencial: \{[^}]*preco: (\d+)/)[1] + "/" + src.match(/adventure: \{[^}]*preco: (\d+)/)[1] + "/" + src.match(/boat: \{[^}]*preco: (\d+)/)[1];
  checar("F3  preços dos planos (80/150/400)", precos === "80/150/400", precos);
}

// ======================= saldo no dia: sem cobrança automática e sem cancelar =======================
const D3 = "2026-10-28", D4 = "2026-10-29";
const ENV_TAREFA = { ...ENV_ON, TAREFAS_TOKEN: "token-tarefas-de-teste-0123456789" };
async function tarefa(token = ENV_TAREFA.TAREFAS_TOKEN, env = ENV_TAREFA) {
  const r = await w.default.fetch(new Request(ORIGEM + "/api/tarefas/pagamento", { method: "POST", headers: token ? { "x-tarefas-token": token } : {} }), env);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
let refT1, idT1, refT2, idT2;
{
  relogio("2026-10-26T13:00:00Z");
  const r = await reservar({ data: D3, hora: 9, pagamento: "sinal" });
  refT1 = r.corpo.pagamento.ref;
  asaasPedidos = [];
  await pagar(checkoutPorRef(refT1));
  idT1 = reservaPorRef(refT1).id;
  checar("T1  sinal pago: não gera link de saldo e a reserva fica sinal_pago", asaasPedidos.length === 0 && reservaPorRef(refT1).pagamento_status === "sinal_pago" && linha("SELECT COUNT(*) AS n FROM cobrancas WHERE reserva_id = ? AND tipo = 'saldo'", idT1).n === 0);
  checar("T1  rota de tarefas: sem TAREFAS_TOKEN configurado → 404; token errado → 401", (await tarefa("x", ENV_ON)).status === 404 && (await tarefa("errado")).status === 401 && (await tarefa(null)).status === 401);
  relogio("2026-10-28T00:30:00Z"); // faltam menos de 12 h para a saída das 9h20
  const t1 = await tarefa();
  checar("T1  tarefa perto da saída não cobra saldo nem cancela", t1.status === 200 && t1.corpo.saldosGerados === 0 && t1.corpo.cancelados === 0 && asaasPedidos.length === 0, JSON.stringify(t1.corpo));
  relogio("2026-10-28T13:30:00Z"); // 10h30, depois da saída das 9h20 e do antigo corte de 15 min
  const gDepois = await getJSON("/api/disponibilidade?data=" + D3);
  const ainda = reservaPorRef(refT1);
  checar("T1  saldo não pago no dia: a reserva continua confirmada, com saldo presencial", ainda.status === "confirmada" && ainda.pagamento_status === "sinal_pago" && gDepois.corpo.grade["9"].restam < 20, `${ainda.status}/${ainda.pagamento_status}`);
  const lista = await admin(`/api/admin/reservas?de=${D3}&ate=${D3}`);
  const it = lista.corpo.reservas.find(x => x.id === idT1);
  checar("T1  painel marca o saldo como presencial no dia", it && it.saldo_forma === "presencial" && it.saldo_centavos === 5600 && !it.saldo_link, JSON.stringify(it));
  asaasPedidos = [];
  const pres = await admin(`/api/admin/reservas/${idT1}/saldo-presencial`, "POST", {});
  checar("T1  equipe marca o saldo pago no dia, sem Asaas", pres.status === 200 && pres.corpo.valor === 56 && asaasPedidos.length === 0 && linha("SELECT pagamento_status FROM reservas WHERE id = ?", idT1).pagamento_status === "quitado", JSON.stringify(pres));

  relogio("2026-10-28T02:00:00Z");
  const r2 = await reservar({ data: D3, hora: 10, pagamento: "sinal" });
  refT2 = r2.corpo.pagamento.ref;
  asaasPedidos = [];
  await pagar(checkoutPorRef(refT2));
  idT2 = reservaPorRef(refT2).id;
  checar("T2  sinal confirmado perto do horário não dispara link de saldo", asaasPedidos.length === 0 && reservaPorRef(refT2).pagamento_status === "sinal_pago");
  const st = await getJSON("/api/pagamento?ref=" + refT2);
  checar("T2  código sai logo após o sinal e o saldo fica para o dia", st.corpo.status === "pago" && st.corpo.confirmada === true && st.corpo.saldoNoDia === true && /^TA-/.test(st.corpo.codigo || "") && st.corpo.situacao === "confirmada", JSON.stringify(st.corpo));
  relogio("2026-10-26T13:00:00Z");
}

// ======================= crianças grátis e webhook PAYMENT_* =======================
{
  relogio("2026-10-26T13:00:00Z");
  asaasPedidos = [];
  const r = await reservar({ data: D3, hora: 11, pax: 3, adultos: 2, criancas: 1, idadesCriancas: [12], pagamento: "sinal" });
  const pg = r.corpo.pagamento;
  checar("C1  2 pagantes + criança de 12: total R$ 160, sinal R$ 48, saldo R$ 112, vaga de 3", r.status === 200 && pg.valor === 48 && pg.total === 160 && pg.saldo === 112, JSON.stringify(r.corpo));
  const res = reservaPorRef(pg.ref);
  checar("C1  banco: pax 3, adultos 2, criança 1, total 160", Number(res.pax) === 3 && Number(res.adultos) === 2 && Number(res.criancas) === 1 && Number(res.total) === 160 && res.idades_criancas === "[12]", JSON.stringify(res));
  const idade = await reservar({ data: D3, hora: 12, adultos: 1, criancas: 1, idadesCriancas: [13], pax: 2, pagamento: "sinal" });
  checar("C1  idade 13 como criança → 422", idade.status === 422 && idade.corpo.erros && idade.corpo.erros.idadesCriancas, JSON.stringify(idade.corpo));
  const semAdulto = await reservar({ data: D3, hora: 13, adultos: 0, criancas: 2, idadesCriancas: [5, 8], pax: 2, pagamento: "sinal" });
  checar("C1  só crianças, sem pagante → 422", semAdulto.status === 422 && semAdulto.corpo.erros.adultos, JSON.stringify(semAdulto.corpo));
  const lotado = await reservar({ data: D3, hora: 14, adultos: 8, criancas: 8, idadesCriancas: [1, 2, 3, 4, 5, 6, 7, 8], pax: 16, pagamento: "sinal" });
  checar("C1  16 pessoas no total → 422 (o limite de 15 vale para todo mundo)", lotado.status === 422, JSON.stringify(lotado.corpo));

  const ck = checkoutPorRef(pg.ref);
  const tokenErrado = await webhook({ id: "evt_pay_token", event: "PAYMENT_RECEIVED", payment: { id: "pay_x", checkoutSession: ck, status: "RECEIVED", value: 48, externalReference: res.id } }, TOKEN + "x");
  checar("W1  PAYMENT_RECEIVED com token inválido → 401", tokenErrado.status === 401 && reservaPorRef(pg.ref).status === "pendente");
  const recebido = await webhook({ id: "evt_pay_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_da_crianca", checkoutSession: ck, status: "RECEIVED", value: 48, externalReference: res.id, billingType: "PIX" } });
  const depois = reservaPorRef(pg.ref);
  checar("W1  PAYMENT_RECEIVED confirma a reserva (sinal_pago)", recebido.status === 200 && depois.status === "confirmada" && depois.pagamento_status === "sinal_pago", JSON.stringify(depois));
  const repetido = await webhook({ id: "evt_pay_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_da_crianca", checkoutSession: ck, status: "RECEIVED", value: 48 } });
  checar("W1  mesmo PAYMENT_RECEIVED de novo → repetido:true", repetido.status === 200 && repetido.corpo.repetido === true);
  const confirmado = await webhook({ id: "evt_pay_2", event: "PAYMENT_CONFIRMED", payment: { id: "pay_da_crianca", checkoutSession: ck, status: "CONFIRMED", value: 48, externalReference: res.id } });
  checar("W1  PAYMENT_CONFIRMED da mesma cobrança não duplica", confirmado.status === 200 && linha("SELECT COUNT(*) AS n FROM cobrancas WHERE reserva_id = ? AND status = 'paga'", res.id).n === 1);
  const valorErrado = await webhook({ id: "evt_pay_3", event: "PAYMENT_RECEIVED", payment: { checkoutSession: ck, status: "RECEIVED", value: 1, externalReference: res.id } });
  checar("W1  valor diferente não mexe na reserva já confirmada", valorErrado.status === 200 && reservaPorRef(pg.ref).pagamento_status === "sinal_pago");

  // externalReference quando o evento não traz checkoutSession
  const rRef = await reservar({ data: D3, hora: 15, adultos: 1, criancas: 0, idadesCriancas: [], pax: 1, pagamento: "sinal" });
  const idRef = reservaPorRef(rRef.corpo.pagamento.ref).id;
  const porRef = await webhook({ id: "evt_pay_ref", event: "PAYMENT_RECEIVED", payment: { id: "pay_sem_sessao", status: "RECEIVED", value: 24, externalReference: idRef, billingType: "PIX" } });
  checar("W2  PAYMENT_RECEIVED só com externalReference + valor confirma", porRef.status === 200 && reservaPorRef(rRef.corpo.pagamento.ref).pagamento_status === "sinal_pago", JSON.stringify(reservaPorRef(rRef.corpo.pagamento.ref)));
}

// ======================= pago sem vaga: reagendar ou devolver =======================
async function pagoSemVaga(hora) {
  relogio("2026-10-26T13:00:00Z");
  const a = await reservar({ data: D4, hora, pagamento: "integral" });
  relogio("2026-10-26T13:40:00Z");
  const b = await reservar({ data: D4, hora, pagamento: "integral" });
  await pagar(checkoutPorRef(b.corpo.pagamento.ref));
  await pagar(checkoutPorRef(a.corpo.pagamento.ref));
  return a.corpo.pagamento.ref;
}
{
  db.prepare("UPDATE config SET valor = '1' WHERE chave = 'capacidade'").run();
  const ref = await pagoSemVaga(9);
  const r = reservaPorRef(ref);
  checar("R1  cenário: pagou e ficou sem vaga (pago_sem_vaga)", r.pagamento_status === "pago_sem_vaga", JSON.stringify(r));
  const st = await getJSON("/api/pagamento?ref=" + ref);
  checar("R1  página de volta: pago, sem vaga, sem código (o site avisa que a equipe entra em contato)", st.corpo.status === "pago" && st.corpo.situacao === "sem_vaga" && !st.corpo.codigo && st.corpo.confirmada === false, JSON.stringify(st.corpo));
  const cheio = await admin(`/api/admin/reservas/${r.id}/reagendar`, "POST", { data: D4, hora: 9 });
  checar("R1  reagendar para horário SEM vaga → 409 cheio, nada muda", cheio.status === 409 && cheio.corpo.motivo === "cheio" && reservaPorRef(ref).pagamento_status === "pago_sem_vaga", JSON.stringify(cheio));
  const inval = await admin(`/api/admin/reservas/${r.id}/reagendar`, "POST", { data: D4, hora: 7 });
  checar("R1  reagendar para horário que o passeio não tem → 422", inval.status === 422);
  const okR = await admin(`/api/admin/reservas/${r.id}/reagendar`, "POST", { data: D4, hora: 10 });
  const r2 = reservaPorRef(ref);
  checar("R1  reagendar para horário COM vaga: confirmada no novo horário, mantém o pagamento (quitado)", okR.status === 200 && r2.status === "confirmada" && r2.hora === 10 && r2.data === D4 && r2.pagamento_status === "quitado" && linha("SELECT COUNT(*) AS n FROM cobrancas WHERE reserva_id = ? AND status = 'paga'", r.id).n === 1, JSON.stringify(okR));
  const st2 = await getJSON("/api/pagamento?ref=" + ref);
  checar("R1  depois de reagendar, a página de volta mostra o código e o novo horário", st2.corpo.confirmada === true && /^TA-/.test(st2.corpo.codigo || "") && st2.corpo.hora === "10:00", JSON.stringify(st2.corpo));
  checar("R1  reserva que não é pago_sem_vaga não reagenda por aqui (409)", (await admin(`/api/admin/reservas/${r.id}/reagendar`, "POST", { data: D4, hora: 11 })).status === 409);

  const refD = await pagoSemVaga(11);
  const rd = reservaPorRef(refD);
  const ck = checkoutPorRef(refD);
  asaasPedidos = [];
  const dv = await admin(`/api/admin/reservas/${rd.id}/devolver`, "POST", {});
  const rd2 = reservaPorRef(refD);
  checar("D1  devolver: busca o pagamento do checkout e pede o estorno Pix ao Asaas (integral)", dv.status === 200 && dv.corpo.ok === true && asaasPedidos.length === 2 && asaasPedidos[0].metodo === "GET" && asaasPedidos[0].url === "http://asaas.teste/v3/payments?checkoutSession=" + ck + "&limit=10" && asaasPedidos[1].metodo === "POST" && asaasPedidos[1].url === "http://asaas.teste/v3/payments/pay_" + ck + "/refund" && !("value" in asaasPedidos[1].corpo) && asaasPedidos[1].headers.access_token === "chave-asaas-de-teste", JSON.stringify(asaasPedidos.map(x => x.url)));
  checar("D1  devolução pedida: reserva cancelada, 'devolucao_solicitada', valor R$ 80", rd2.status === "cancelada" && rd2.pagamento_status === "devolucao_solicitada" && dv.corpo.valorSolicitado === 80, JSON.stringify(dv.corpo));
  checar("D1  devolver de novo não pede outro estorno (409)", (await admin(`/api/admin/reservas/${rd.id}/devolver`, "POST", {})).status === 409 && asaasPedidos.length === 2);

  const refF = await pagoSemVaga(12);
  const rf = reservaPorRef(refF);
  estornoFalha = true;
  const df = await admin(`/api/admin/reservas/${rf.id}/devolver`, "POST", {});
  estornoFalha = false;
  const rf2 = reservaPorRef(refF);
  checar("D2  Asaas recusa o estorno (400): reserva fica 'devolucao_manual' e o painel recebe o aviso", df.status === 200 && df.corpo.ok === false && df.corpo.pagamentoStatus === "devolucao_manual" && rf2.pagamento_status === "devolucao_manual" && rf2.status === "cancelada" && /por fora/.test(df.corpo.erro), JSON.stringify(df.corpo));
  const st3 = await getJSON("/api/pagamento?ref=" + refF);
  checar("D2  página de volta continua 'sem vaga' (a equipe entra em contato)", st3.corpo.situacao === "sem_vaga" && !st3.corpo.codigo);
  const dr = await admin(`/api/admin/reservas/${rf.id}/devolver`, "POST", {});
  checar("D2  tentar de novo depois da falha funciona", dr.corpo.ok === true && reservaPorRef(refF).pagamento_status === "devolucao_solicitada", JSON.stringify(dr.corpo));
  db.prepare("UPDATE config SET valor = '20' WHERE chave = 'capacidade'").run();
  relogio("2026-10-26T13:00:00Z");
}

// ======================= cancelamento: estorno até 12 h, sem estorno depois =======================
async function cancelarCliente(codigo, telefone) {
  const r = await w.default.fetch(new Request(ORIGEM + "/api/reservas/cancelar", {
    method: "POST",
    headers: { origin: ORIGEM, "content-type": "application/json", "cf-connecting-ip": ip() },
    body: JSON.stringify({ codigo, telefone, "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX" })
  }), ENV_ON);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
{
  relogio("2026-10-26T13:00:00Z");
  const telC = tel();
  const r = await reservar({ data: D4, hora: 13, pagamento: "sinal", telefone: telC });
  await pagar(checkoutPorRef(r.corpo.pagamento.ref));
  const res = reservaPorRef(r.corpo.pagamento.ref);
  const ck = checkoutPorRef(r.corpo.pagamento.ref);
  asaasPedidos = [];
  const c1 = await cancelarCliente(res.codigo, telC);
  checar("K1  cliente cancela com mais de 12 h: estorno do sinal no Asaas", c1.status === 200 && c1.corpo.estorno === "solicitado" && c1.corpo.cancelada === true && asaasPedidos.length === 2 && asaasPedidos[1].url === "http://asaas.teste/v3/payments/pay_" + ck + "/refund", JSON.stringify(c1.corpo));
  checar("K1  reserva cancelada e estorno pedido", reservaPorRef(r.corpo.pagamento.ref).status === "cancelada" && reservaPorRef(r.corpo.pagamento.ref).pagamento_status === "estorno_solicitado");
  const c2 = await cancelarCliente(res.codigo, telC);
  checar("K1  cancelar de novo não pede outro estorno", c2.status === 200 && c2.corpo.repetido === true && asaasPedidos.length === 2, JSON.stringify(c2.corpo));
  const errado = await cancelarCliente(res.codigo, "21988887777");
  checar("K1  WhatsApp diferente → 404, sem novo estorno", errado.status === 404 && asaasPedidos.length === 2);

  const telT = tel();
  const tarde = await reservar({ data: D4, hora: 14, pagamento: "sinal", telefone: telT });
  await pagar(checkoutPorRef(tarde.corpo.pagamento.ref));
  const idTarde = reservaPorRef(tarde.corpo.pagamento.ref).id;
  relogio("2026-10-29T06:00:00Z"); // saída das 14h é 14h20 em Trindade = 17:20 UTC; 06:00 UTC já passou das 12 h
  asaasPedidos = [];
  const sem = await admin(`/api/admin/reservas/${idTarde}/cancelar`, "POST", {});
  checar("K2  painel cancela com menos de 12 h: sem estorno, sinal fica", sem.status === 200 && sem.corpo.estorno === "nao_coube" && asaasPedidos.length === 0 && linha("SELECT status, pagamento_status FROM reservas WHERE id = ?", idTarde).pagamento_status === "sem_devolucao", JSON.stringify(sem.corpo));
  const st = await getJSON("/api/pagamento?ref=" + tarde.corpo.pagamento.ref);
  checar("K2  página de volta: cancelada sem estorno", st.corpo.situacao === "cancelada_sem_estorno", JSON.stringify(st.corpo));
  relogio("2026-10-26T13:00:00Z");
}

// ======================= desligado: rotas novas e tarefa não fazem nada =======================
{
  const sqls = [];
  const DB_ESPIAO = { prepare: q => { sqls.push(q); return DB.prepare(q); } };
  const envOff = { ...ENV_TAREFA, PAGAMENTO_ONLINE: undefined, DB: DB_ESPIAO };
  const rt = await w.default.fetch(new Request(ORIGEM + "/api/tarefas/pagamento", { method: "POST", headers: { "x-tarefas-token": ENV_TAREFA.TAREFAS_TOKEN } }), envOff);
  let tocouDB = false;
  const DB_PROIBIDO = { prepare: () => { tocouDB = true; throw new Error("não devia tocar o D1"); } };
  await w.default.scheduled({ cron: "*/5 * * * *" }, { ...ENV_OFF, DB: DB_PROIBIDO }, { waitUntil: p => p });
  await w.default.scheduled({ cron: "*/5 * * * *" }, { DB: DB_PROIBIDO }, { waitUntil: p => p });
  checar("O1  desligado: /api/tarefas/pagamento → 404 e scheduled sai sem tocar o D1", rt.status === 404 && !tocouDB && sqls.length === 0, `${rt.status} ${tocouDB} ${sqls.length}`);
}

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

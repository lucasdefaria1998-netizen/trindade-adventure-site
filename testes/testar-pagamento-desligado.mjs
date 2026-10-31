// Prova de que, com o pagamento online DESLIGADO, o worker desta branch responde igual ao do d1ad1fc
// (o que está no ar), para os mesmos pedidos — e sem tocar nada da migração 0003.
//
// Roda os dois _worker.js DENTRO deste processo, cada um com o seu D1 em memória (node:sqlite) criado só com
// testes/schema-local.sql (esquema de produção, SEM a 0003), relógio fixo e Turnstile simulado. Nada de rede.
// A versão de referência sai do git (git show <ref>:site/_worker.js); padrão d1ad1fc.
//
//   node testes/testar-pagamento-desligado.mjs [ref]        (Node 22.5+ por causa do node:sqlite)
//
// Única diferença esperada: o preço do Essencial (R$ 70 → R$ 80), que aparece em "Total"/"Sinal" da mensagem.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REF = process.argv[2] || "d1ad1fc";
let falhas = 0, total = 0;
function checar(nome, ok, detalhe) {
  total++; if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${nome}${!ok && detalhe !== undefined ? "  →  " + detalhe : ""}`);
}

const DataReal = Date;
const AGORA = DataReal.parse("2026-10-26T13:00:00Z"); // 10:00 em Trindade
class DataFixa extends DataReal {
  constructor(...a) { if (a.length) super(...a); else super(AGORA); }
  static now() { return AGORA; }
}
globalThis.Date = DataFixa;
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://challenges.cloudflare.com/"))
    return new Response(JSON.stringify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }), { headers: { "content-type": "application/json" } });
  throw new Error("fetch inesperado (desligado não chama ninguém): " + url);
};

const ESQUEMA = readFileSync(new URL("./schema-local.sql", import.meta.url), "utf8");
const NOVO_0003 = /\bcobrancas\b|\basaas_eventos\b|pagamento_modalidade|pagamento_status|\bestorno\b/i;
function criarD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(ESQUEMA);
  const sqls = [];
  const valor = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
  class Stmt {
    constructor(sql) { this.sql = sql; this.args = []; sqls.push(sql); }
    bind(...a) { this.args = a.map(valor); return this; }
    async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
    async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
  }
  const DB = {
    prepare: sql => new Stmt(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      const out = [];
      try {
        for (const s of stmts) {
          const r = db.prepare(s.sql).run(...s.args);
          out.push({ meta: { changes: Number(r.changes) } });
        }
        db.exec("COMMIT");
        return out;
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* a transação já foi desfeita */ }
        throw e;
      }
    }
  };
  return { DB, db, sqls };
}
const carregar = src => import("data:text/javascript;base64," + Buffer.from(src).toString("base64") + "#" + Math.random());
const srcNovo = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
const srcRef = execFileSync("git", ["show", REF + ":site/_worker.js"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
// Cada rodada carrega os workers de novo (o worker guarda em memória que já ajustou o esquema do banco).

const ORIGEM = "https://trindadeadventury.com.br";
const ASSETS = { fetch: async () => new Response(readFileSync(new URL("../site/index.html", import.meta.url), "utf8"), { headers: { "content-type": "text/html; charset=utf-8" } }) };
const BASE_ENV = { ASSETS, TURNSTILE_SECRET: "1x0000000000000000000000000000000AA", ADMIN_KEY: "admin-teste" };
// Variações da flag "desligada": ausente, "0", outros valores, e "1" sem as chaves do Asaas.
const FLAGS = [
  ["ausente", {}],
  ["PAGAMENTO_ONLINE=0", { PAGAMENTO_ONLINE: "0" }],
  ["PAGAMENTO_ONLINE=true", { PAGAMENTO_ONLINE: "true" }],
  ["PAGAMENTO_ONLINE=''", { PAGAMENTO_ONLINE: "" }],
  ["PAGAMENTO_ONLINE=1 sem chave/token do Asaas", { PAGAMENTO_ONLINE: "1" }],
  ["PAGAMENTO_ONLINE=0 com chave de teste", { PAGAMENTO_ONLINE: "0", ASAAS_API_KEY: "chave-de-teste", ASAAS_WEBHOOK_TOKEN: "token-de-teste", SALDO_ANTECEDENCIA_H: "12", TAREFAS_TOKEN: "t" }]
];
const AMANHA = "2026-10-27";
const PEDIDOS = [
  ["trilha Essencial (2 pessoas)", { plano: "essencial", data: AMANHA, hora: 9, pax: 2 }],
  ["trilha Essencial mandando pagamento=sinal (campo novo, ignorado)", { plano: "essencial", data: AMANHA, hora: 10, pax: 1, pagamento: "sinal" }],
  ["trilha Essencial hoje 11h", { plano: "essencial", data: "2026-10-26", hora: 11, pax: 1 }],
  ["trilha Adventure (voucher)", { plano: "adventure", data: AMANHA, hora: 8, pax: 3 }],
  ["barco Boat 8h30", { plano: "boat", data: AMANHA, hora: 8.5, pax: 2 }],
  ["parapente (só WhatsApp: fora de PLANOS)", { plano: "parapente", data: AMANHA, hora: 9, pax: 1 }],
  ["consulta Mamanguá (só WhatsApp)", { plano: "mamangua", data: AMANHA, hora: 9, pax: 2 }],
  ["horário que já passou (hoje 9h)", { plano: "essencial", data: "2026-10-26", hora: 9, pax: 1 }],
  ["sem telefone (422)", { plano: "essencial", data: AMANHA, hora: 9, pax: 1, telefone: "" }]
];

let seq = 0;
async function chamar(w, env, caminho, { metodo = "GET", corpo, cab = {} } = {}) {
  const r = await w.default.fetch(new Request(ORIGEM + caminho, {
    method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { origin: ORIGEM, "content-type": "application/json", "cf-connecting-ip": "10.1.2." + (seq % 200), ...cab }
  }), env);
  const texto = await r.text();
  return { status: r.status, texto };
}
// Normaliza o que é sorteado (código, id) e a única diferença esperada (Essencial R$ 70 → R$ 80 na referência).
const sortear = t => t.replace(/TA-[A-Z2-7]{4}-[A-Z2-7]{4}/g, "TA-XXXX-XXXX").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
function trocaTexto(txt, de, para) {
  return [[de, para], [JSON.stringify(de).slice(1, -1), JSON.stringify(para).slice(1, -1)], [encodeURIComponent(de), encodeURIComponent(para)]]
    .reduce((t2, [x, y]) => t2.split(x).join(y), txt); // texto puro, dentro de JSON e dentro do link wa.me
}
function precoEssencial(t, pax) {
  t = trocaTexto(t, "Total: R$ " + 70 * pax + "\n", "Total: R$ " + 80 * pax + "\n");
  return trocaTexto(t, "Sinal para confirmar (30%): R$ " + Math.round(70 * pax * 0.3) + " ", "Sinal para confirmar (30%): R$ " + Math.round(80 * pax * 0.3) + " ");
}
// A mensagem do WhatsApp ganhou uma linha: o restante é no dia do passeio. O restante do corpo segue igual.
function saldoNoDia(t) {
  return trocaTexto(t, " via Pix\n\nNome:", " via Pix\nO restante (70%) é pago no dia do passeio.\n\nNome:");
}

const exemplo = {};
for (const [nomeFlag, flag] of FLAGS) {
  const novo = await carregar(srcNovo), ref = await carregar(srcRef);
  const A = criarD1(), B = criarD1();
  const envNovo = { ...BASE_ENV, ...flag, DB: A.DB }, envRef = { ...BASE_ENV, ...flag, DB: B.DB };
  let difs = [];
  for (const [nome, p] of PEDIDOS) {
    seq++;
    const tel = "2499" + String(1000000 + seq).padStart(7, "0");
    const corpo = { nome: "Teste Desligado", telefone: tel, origem: "direto", aceiteTermos: true, termoVersao: "v0-provisorio", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX", ...p };
    const cab = { "idempotency-key": "chave-desligado-" + String(seq).padStart(6, "0") };
    const rn = await chamar(novo, envNovo, "/api/reservas", { metodo: "POST", corpo, cab });
    const rr = await chamar(ref, envRef, "/api/reservas", { metodo: "POST", corpo, cab });
    let tn = sortear(rn.texto), tr = sortear(rr.texto);
    const essencial = p.plano === "essencial";
    const trAjustado = saldoNoDia(essencial ? precoEssencial(tr, p.pax) : tr);
    if (essencial && tr !== tn && trAjustado === tn) difs.push(`${nome}: só o preço do Essencial (R$ ${70 * p.pax} → R$ ${80 * p.pax})`);
    checar(`[${nomeFlag}] POST ${nome}: mesmo status (${rr.status}) e mesmo corpo do ${REF}${essencial ? " (fora o preço do Essencial)" : ""}`, rn.status === rr.status && tn === trAjustado, (() => { let i = 0; while (i < tn.length && tn[i] === trAjustado[i]) i++; return `status ${rn.status}/${rr.status}; 1ª diferença no caractere ${i}:\n   novo: …${tn.slice(Math.max(0, i - 80), i + 120)}\n   ${REF}: …${trAjustado.slice(Math.max(0, i - 80), i + 120)}`; })());
    if (nomeFlag === "ausente" && !exemplo[nome]) exemplo[nome] = { novo: rn, ref: rr };
  }
  // reenvio com a mesma chave (idempotência) e GETs
  for (const caminho of ["/api/disponibilidade?data=" + AMANHA, "/api/disponibilidade?data=2026-10-26", "/api/pagamento?ref=" + "a".repeat(32)]) {
    const rn = await chamar(novo, envNovo, caminho), rr = await chamar(ref, envRef, caminho);
    checar(`[${nomeFlag}] GET ${caminho}: igual ao ${REF}`, rn.status === rr.status && rn.texto === rr.texto, `${rn.status} ${rn.texto.slice(0, 200)} | ${rr.status} ${rr.texto.slice(0, 200)}`);
  }
  for (const [caminho, metodo, cab] of [["/api/asaas/webhook", "POST", { "asaas-access-token": "token-de-teste" }], ["/api/tarefas/pagamento", "POST", { "x-tarefas-token": "t" }]]) {
    const rn = await chamar(novo, envNovo, caminho, { metodo, corpo: { id: "evt_1", event: "CHECKOUT_PAID", checkout: { id: "x" } }, cab });
    const rr = await chamar(ref, envRef, caminho, { metodo, corpo: { id: "evt_1", event: "CHECKOUT_PAID", checkout: { id: "x" } }, cab });
    checar(`[${nomeFlag}] POST ${caminho}: 404 como no ${REF}`, rn.status === 404 && rn.status === rr.status && rn.texto === rr.texto, `${rn.status} ${rr.status}`);
  }
  // painel: listagem, ações novas, saldo
  const adm = { "X-Admin-Key": "admin-teste" };
  const ln = await chamar(novo, envNovo, "/api/admin/reservas?status=todas", { cab: adm });
  const lr = await chamar(ref, envRef, "/api/admin/reservas?status=todas", { cab: adm });
  const semPreco = t => JSON.parse(sortear(t)).reservas.map(r => {
    const o = { ...r, criado_em: "x", total: r.plano === "essencial" ? "x" : r.total };
    delete o.adultos; delete o.criancas; delete o.idades_criancas;
    return o;
  });
  checar(`[${nomeFlag}] GET /api/admin/reservas: mesmas reservas e mesmos campos do ${REF} (sem colunas de pagamento)`, ln.status === 200 && lr.status === 200 && JSON.stringify(semPreco(ln.texto)) === JSON.stringify(semPreco(lr.texto)) && !/pagamento_|pago_centavos|saldo_link/.test(ln.texto), `${ln.texto.slice(0, 300)}`);
  const id = A.db.prepare("SELECT id FROM reservas LIMIT 1").get().id;
  for (const acao of ["saldo", "reagendar", "devolver"]) {
    const r = await chamar(novo, envNovo, `/api/admin/reservas/${id}/${acao}`, { metodo: "POST", corpo: { data: AMANHA, hora: 11 }, cab: adm });
    checar(`[${nomeFlag}] POST /api/admin/reservas/:id/${acao} desligado → 409 (e nenhuma SQL da 0003, ver abaixo)`, r.status === 409 && /desligado/.test(r.texto), `${r.status} ${r.texto}`);
  }
  // scheduled
  let tocou = false;
  await novo.default.scheduled({ cron: "*/10 * * * *" }, { ...BASE_ENV, ...flag, DB: { prepare: () => { tocou = true; throw new Error("tocou o D1"); } } }, { waitUntil: p => p });
  checar(`[${nomeFlag}] scheduled: sai na hora, sem tocar o D1`, !tocou);
  // nenhuma SQL da 0003
  const tocam = A.sqls.filter(q => NOVO_0003.test(q));
  checar(`[${nomeFlag}] nenhuma SQL executada toca tabela/coluna da 0003 (${A.sqls.length} SQLs vistas)`, tocam.length === 0, tocam.slice(0, 3).join(" | "));
  const tabelas = A.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
  const cols = A.db.prepare("PRAGMA table_info(reservas)").all().map(c => c.name);
  checar(`[${nomeFlag}] o banco continua sem a 0003 (sem cobrancas/asaas_eventos/pagamento_*)`, !tabelas.includes("cobrancas") && !tabelas.includes("asaas_eventos") && !cols.some(c => c.startsWith("pagamento_")), tabelas.join());
  if (difs.length) console.log(`      diferenças esperadas [${nomeFlag}]: ${difs.join("; ")}`);
}

const novo = await carregar(srcNovo);
console.log("\nExemplo (flag ausente) — POST /api/reservas, trilha Essencial (2 pessoas):");
const ex = exemplo["trilha Essencial (2 pessoas)"];
console.log(`  novo   → ${ex.novo.status} ${ex.novo.texto}`);
console.log(`  ${REF} → ${ex.ref.status} ${ex.ref.texto}`);
console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

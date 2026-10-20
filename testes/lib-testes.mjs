// Utilidades dos testes locais (nada aqui toca produção).
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";

export const BASE = (process.env.BASE || "http://127.0.0.1:8788").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Estes testes gravam no banco D1 LOCAL e só rodam contra localhost. BASE =", BASE);
  process.exit(2);
}

let falhas = 0, total = 0;
export function checar(nome, ok, detalhe) {
  total++;
  if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${nome}${!ok && detalhe !== undefined ? "  →  " + detalhe : ""}`);
}
export const pulado = (nome, motivo) => console.log(`PULADO ${nome}  →  ${motivo}`);
export function resumo() {
  console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
  process.exit(falhas ? 1 : 0);
}

// Banco D1 local do wrangler pages dev (testes/.wrangler). Abre, consulta e fecha.
const DIR_D1 = new URL("./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/", import.meta.url);
function arquivoDoBanco() {
  const f = readdirSync(DIR_D1).find(n => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (!f) throw new Error("banco D1 local não encontrado — rode o wrangler pages dev uma vez");
  return new URL(f, DIR_D1);
}
export function sql(consulta, ...params) {
  const db = new DatabaseSync(arquivoDoBanco());
  try { return db.prepare(consulta).all(...params); } finally { db.close(); }
}
export function exec(consulta) {
  const db = new DatabaseSync(arquivoDoBanco());
  try { db.exec(consulta); } finally { db.close(); }
}
export const contar = (tabela = "reservas") => Number(sql(`SELECT count(*) AS n FROM ${tabela}`)[0].n);

export const ORIGEM_OK = BASE;
export const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const somaDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// IP e telefone novos a cada chamada: o limite por IP e o de 5 pedidos por telefone ficam isolados entre testes.
// (Localmente o wrangler aceita o header cf-connecting-ip; em produção quem define é o Cloudflare.)
let seq = 0;
export const ipNovo = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${++seq % 250}`;
export const telNovo = () => "2499" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");

export const TOKEN_TURNSTILE_TESTE = "XXXX.DUMMY.TOKEN.XXXX"; // aceito pela chave de teste (sempre passa) usada no wrangler.toml local

export function post(caminho, { corpo, tipo = "application/json", origem = ORIGEM_OK, ip = ipNovo(), cabecalhos = {}, bruto, semToken = false } = {}) {
  // Reservas exigem o token do Turnstile (S06): os testes mandam o de teste, a não ser que peçam semToken.
  if (caminho === "/api/reservas" && !semToken && corpo && typeof corpo === "object" && !("cf-turnstile-response" in corpo)) corpo = { ...corpo, "cf-turnstile-response": TOKEN_TURNSTILE_TESTE };
  const h = { ...cabecalhos };
  if (tipo) h["content-type"] = tipo;
  if (origem) h["origin"] = origem;
  if (ip) h["cf-connecting-ip"] = ip;
  const body = bruto !== undefined ? bruto : (typeof corpo === "string" ? corpo : JSON.stringify(corpo));
  return fetch(BASE + caminho, { method: "POST", headers: h, body, redirect: "manual" });
}

// Reserva válida (Essencial, amanhã às 9h) — sobrescreva o que precisar.
export const reservaValida = (extra = {}) => ({
  plano: "essencial", data: somaDias(hojeSP(), 1), hora: 9, pax: 2,
  nome: "Teste Automatizado", telefone: telNovo(), origem: "direto", sessao: "teste-sessao-01", ...extra
});

// Começa cada execução de testes com o banco LOCAL vazio (nunca toca produção): sem isso, as
// reservas das execuções anteriores enchem os horários de teste e o limite de pedidos por IP/telefone.
export function limparDadosDeTeste() {
  for (const t of ["reservas", "eventos", "bloqueios", "rate_limit"]) { try { exec(`DELETE FROM ${t}`); } catch { /* tabela ainda não existe */ } }
}

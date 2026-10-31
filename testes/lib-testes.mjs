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

// ---------- Cloudflare Access de teste (S23): chaves RSA geradas na hora, servidas como JWKS em http://127.0.0.1:8791/certs ----------
// O worker local lê ACCESS_AUD e ACCESS_CERTS_URL do wrangler.toml desta pasta. Nenhuma chave real, nenhum segredo.
import { generateKeyPairSync, createSign } from "node:crypto";
import http from "node:http";
export const ACCESS_AUD_TESTE = "aud-de-teste-local-0123456789abcdef";
export const ISS_ACCESS = "https://cold-smoke-c7c6.cloudflareaccess.com";
const KID = "chave-de-teste-" + Math.random().toString(16).slice(2, 10); // kid novo a cada execução, como numa rotação real (o worker guarda os certificados em cache)
const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
const outroPar = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const PORTA_CERTS = Number(process.env.PORTA_CERTS || 8791);
export const ACCESS_CERTS_URL_TESTE = `http://127.0.0.1:${PORTA_CERTS}/certs`;
export function iniciarServidorDeCertificados(porta = PORTA_CERTS) {
  const jwk = par.publicKey.export({ format: "jwk" });
  const srv = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [{ kid: KID, kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] })); });
  return new Promise(ok => srv.listen(porta, "127.0.0.1", () => ok(srv)));
}
const b64u = x => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
export function criarJwtAccess({ aud = ACCESS_AUD_TESTE, iss = ISS_ACCESS, exp = Math.floor(Date.now() / 1000) + 3600, nbf, email = "teste@example.com", kid = KID, alg = "RS256", comOutraChave = false } = {}) {
  const cab = b64u({ alg, kid, typ: "JWT" });
  const corpo = b64u({ aud: [aud], iss, exp, ...(nbf ? { nbf } : {}), email, iat: Math.floor(Date.now() / 1000) - 5 });
  const s = createSign("RSA-SHA256"); s.update(cab + "." + corpo);
  return cab + "." + corpo + "." + s.sign(comOutraChave ? outroPar.privateKey : par.privateKey).toString("base64url");
}

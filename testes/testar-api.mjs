// Testes da API (portão dos POST, validação, idempotência, Turnstile, admin…).
// Uso:  node testes/testar-api.mjs      (wrangler pages dev em http://127.0.0.1:8788)
// Só localhost. Grava reservas de teste no D1 LOCAL; confere a contagem de linhas antes e depois.
import { checar, resumo, contar, post, reservaValida, ipNovo, exec, sql, BASE, hojeSP, somaDias } from "./lib-testes.mjs";

const jsonDe = async r => { try { return await r.json(); } catch { return null; } };
console.log(`\nTestando a API em ${BASE}\n`);

// ---------- ETAPA 3 — portão comum dos POST públicos ----------
{
  const antes = contar();
  const r1 = await post("/api/reservas", { corpo: reservaValida(), tipo: "text/plain" });
  checar("E3  reservas com text/plain → 415", r1.status === 415, r1.status);
  const r2 = await post("/api/reservas", { corpo: reservaValida(), origem: null });
  checar("E3  reservas sem Origin e sem Sec-Fetch-Site → 403", r2.status === 403, r2.status);
  const r3 = await post("/api/reservas", { corpo: reservaValida(), origem: "https://evil.example" });
  checar("E3  reservas com Origin https://evil.example → 403", r3.status === 403, r3.status);
  const r3b = await post("/api/reservas", { corpo: reservaValida(), origem: "null" });
  checar("E3  reservas com Origin \"null\" → 403", r3b.status === 403, r3b.status);
  const r3c = await post("/api/reservas", { corpo: reservaValida(), origem: BASE + "/qualquer-caminho" });
  checar("E3  Origin com caminho (inválido) → 403", r3c.status === 403, r3c.status);
  const grande = JSON.stringify({ ...reservaValida(), obs: "x".repeat(20 * 1024) });
  const r4 = await post("/api/reservas", { corpo: grande });
  checar("E3  corpo de 20 KB → 413", r4.status === 413, r4.status);
  // sem Content-Length (transferência em partes): o limite precisa valer na leitura, não só no header
  const stream = new ReadableStream({ start(c) { const e = new TextEncoder(); for (let i = 0; i < 20; i++) c.enqueue(e.encode("a".repeat(1024))); c.close(); } });
  const r4b = await fetch(BASE + "/api/reservas", { method: "POST", duplex: "half", body: stream, redirect: "manual",
    headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ipNovo() } });
  checar("E3  corpo de 20 KB sem Content-Length (chunked) → 413", r4b.status === 413, r4b.status);
  const r5 = await post("/api/reservas", { corpo: "{nao é json" });
  checar("E3  JSON inválido → 400", r5.status === 400, r5.status);
  const r5b = await post("/api/reservas", { corpo: "[1,2,3]" });
  checar("E3  JSON que não é objeto → 400", r5b.status === 400, r5b.status);
  const r6 = await post("/api/reservas", { corpo: {} });
  checar("E3  {} com Origin certo → 422", r6.status === 422, r6.status);
  const r6b = await post("/api/reservas", { corpo: {}, origem: null, cabecalhos: { "sec-fetch-site": "same-origin" } });
  checar("E3  sem Origin, com Sec-Fetch-Site: same-origin → aceito (422 da validação)", r6b.status === 422, r6b.status);
  const r6c = await post("/api/reservas", { corpo: {}, origem: null, cabecalhos: { "sec-fetch-site": "cross-site" } });
  checar("E3  sem Origin, com Sec-Fetch-Site: cross-site → 403", r6c.status === 403, r6c.status);
  checar("E3  nenhum desses grava linha no D1", contar() === antes, `${antes} → ${contar()}`);
}
{
  const antes = contar("eventos");
  const e1 = await post("/api/eventos", { corpo: { tipo: "visita" }, tipo: "text/plain" });
  checar("E3  eventos com text/plain → 415", e1.status === 415, e1.status);
  const e2 = await post("/api/eventos", { corpo: { tipo: "visita" }, origem: null });
  checar("E3  eventos sem Origin → 403", e2.status === 403, e2.status);
  const e3 = await post("/api/eventos", { corpo: { tipo: "visita" }, origem: "https://evil.example" });
  checar("E3  eventos com Origin evil → 403", e3.status === 403, e3.status);
  const e4 = await post("/api/eventos", { corpo: { tipo: "visita", sessao: "x".repeat(3 * 1024) } });
  checar("E3  eventos com corpo > 2 KB → 413", e4.status === 413, e4.status);
  checar("E3  nenhum desses grava evento", contar("eventos") === antes, `${antes} → ${contar("eventos")}`);
  const e5 = await post("/api/eventos", { corpo: { tipo: "visita", origem: "direto", sessao: "teste-sessao-01" } });
  checar("E3  evento válido → 200", e5.status === 200 && (await jsonDe(e5))?.ok === true, e5.status);
  checar("E3  evento válido grava 1 linha", contar("eventos") === antes + 1, `${antes} → ${contar("eventos")}`);
}
{
  const g = await fetch(BASE + "/api/reservas", { redirect: "manual" });
  checar("E3  GET /api/reservas → 405 com Allow: POST", g.status === 405 && g.headers.get("allow") === "POST", `${g.status} allow=${g.headers.get("allow")}`);
  for (const rota of ["/api/reservas", "/api/eventos"]) {
    const o = await fetch(BASE + rota, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    const cors = [...o.headers.keys()].filter(k => k.startsWith("access-control-allow"));
    checar(`E3  OPTIONS ${rota} com Origin estranho → sem Access-Control-Allow-*`, !cors.length, cors.join(","));
  }
  const post405 = await post("/api/reservas", { corpo: {} });
  checar("E3  erro do portão tem formato {ok:false, erro}", (await jsonDe(await post("/api/reservas", { corpo: "x", tipo: "text/plain" })))?.ok === false);
  void post405;
}
{
  // rate limit: 5 pedidos por IP em 10 min nas reservas → o 6º é 429 com Retry-After
  const ip = ipNovo(), antes = contar();
  const codigos = [];
  for (let i = 0; i < 6; i++) { const r = await post("/api/reservas", { corpo: {}, ip }); codigos.push(r.status); if (i === 5) var ultimo = r; }
  checar("E3  reservas: 5 pedidos do mesmo IP passam e o 6º é 429", codigos.slice(0, 5).every(c => c === 422) && codigos[5] === 429, codigos.join(","));
  checar("E3  429 traz Retry-After numérico", /^\d+$/.test(ultimo.headers.get("retry-after") || ""), ultimo.headers.get("retry-after"));
  const outro = await post("/api/reservas", { corpo: {}, ip: ipNovo() });
  checar("E3  outro IP não é afetado", outro.status === 422, outro.status);
  // eventos: 60 por minuto por IP
  const ip2 = ipNovo(); let ult;
  const cods = [];
  for (let i = 0; i < 61; i++) { ult = await post("/api/eventos", { corpo: { tipo: "visita", sessao: "teste-rate" }, ip: ip2 }); cods.push(ult.status); }
  checar("E3  eventos: 60 passam e o 61º é 429", cods.slice(0, 60).every(c => c === 200) && cods[60] === 429, `${cods.filter(c => c === 200).length}×200, último ${cods[60]}`);
  checar("E3  rate limit não gravou reserva", contar() === antes, `${antes} → ${contar()}`);
}
{
  // erro de banco → 500 genérico, sem stack nem SQL
  exec("ALTER TABLE config RENAME TO config_fora");
  let r, corpo;
  try { r = await post("/api/reservas", { corpo: reservaValida() }); corpo = await r.text(); }
  finally { exec("ALTER TABLE config_fora RENAME TO config"); }
  checar("E3  falha do D1 → 500", r.status === 500, r.status);
  checar("E3  500 com mensagem genérica, sem stack/SQL/nome de tabela", /Erro interno\. Tente de novo ou fale no WhatsApp\./.test(corpo) && !/config|SQL|no such|at |D1_/i.test(corpo.replace("Erro interno. Tente de novo ou fale no WhatsApp.", "")), corpo);
}
{
  const d = await fetch(BASE + "/api/disponibilidade?data=" + somaDias(hojeSP(), 1));
  checar("E3  GET /api/disponibilidade continua 200 (fora do portão)", d.status === 200, d.status);
}

resumo();

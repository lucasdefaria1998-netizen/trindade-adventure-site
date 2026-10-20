// Testes da API (portão dos POST, validação, idempotência, Turnstile, admin…).
// Uso:  node testes/testar-api.mjs      (wrangler pages dev em http://127.0.0.1:8788)
// Só localhost. Grava reservas de teste no D1 LOCAL; confere a contagem de linhas antes e depois.
import { checar, resumo, contar, post, reservaValida, ipNovo, exec, sql, BASE, hojeSP, somaDias, limparDadosDeTeste } from "./lib-testes.mjs";

limparDadosDeTeste();

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

// ---------- ETAPA 4 — validação estrita, D1 parametrizado e atômico, WhatsApp seguro ----------
const hoje = hojeSP();
let diaSeq = 0;
const diaLivre = () => somaDias(hoje, 3 + ((Date.now() / 1000 | 0) + 7 * ++diaSeq) % 80);
const rv = (extra = {}) => reservaValida({ data: diaLivre(), ...extra });
const status422 = async (nome, extra, campo) => {
  const antes = contar();
  const r = await post("/api/reservas", { corpo: rv(extra) });
  const j = await jsonDe(r);
  checar(`E4  ${nome} → 422${campo ? " (erro em " + campo + ")" : ""}`, r.status === 422 && (!campo || (j && j.erros && j.erros[campo])), `${r.status} ${JSON.stringify(j)}`);
  checar(`E4  ${nome} não grava e não ecoa o valor`, contar() === antes && !JSON.stringify(j).includes("<script>"), `${antes} → ${contar()}`);
};

// datas
await status422("data de ontem", { data: somaDias(hoje, -1) }, "data");
await status422("data hoje+91", { data: somaDias(hoje, 91) }, "data");
await status422("data 2020-01-01", { data: "2020-01-01" }, "data");
await status422("data 2026-02-30 (não existe)", { data: "2026-02-30" }, "data");
await status422("data em formato errado", { data: "21/10/2026" }, "data");
for (const [n, d] of [["ontem", somaDias(hoje, -1)], ["hoje+91", somaDias(hoje, 91)], ["2020-01-01", "2020-01-01"], ["abc", "abc"]]) {
  const r = await fetch(`${BASE}/api/disponibilidade?data=${d}`); await r.arrayBuffer();
  checar(`E4  disponibilidade?data=${n} → 400`, r.status === 400, r.status);
}
for (const [n, d] of [["hoje", hoje], ["hoje+90", somaDias(hoje, 90)]]) {
  const r = await fetch(`${BASE}/api/disponibilidade?data=${d}`); await r.arrayBuffer();
  checar(`E4  disponibilidade?data=${n} → 200`, r.status === 200, r.status);
}
{
  const r = await post("/api/reservas", { corpo: rv({ data: somaDias(hoje, 90) }) });
  checar("E4  reserva em hoje+90 é aceita", r.status === 200, r.status);
}

// horário, plano, pax, nome, contato
await status422("hora fora do plano (Boat às 9)", { plano: "boat", hora: 9 }, "hora");
await status422("hora fora do plano (Essencial 7:30)", { hora: 7.5 }, "hora");
await status422("hora como texto", { hora: "9" }, "hora");
await status422("plano desconhecido", { plano: "luxo" }, "plano");
await status422("plano 'constructor'", { plano: "constructor" }, "plano");
await status422("plano '__proto__'", { plano: "__proto__" }, "plano");
for (const [n, v] of [["0", 0], ["1.5", 1.5], ["999", 999], ["16", 16], ["-1", -1], ["texto '2'", "2"], ["null", null]]) await status422(`pax ${n}`, { pax: v }, "pax");
await status422("nome com 2 caracteres", { nome: "Jo" }, "nome");
await status422("nome com 81 caracteres", { nome: "A".repeat(81) }, "nome");
await status422("nome com caractere de controle", { nome: "Joao\u0007Silva" }, "nome");
await status422("nome que não é texto", { nome: { a: 1 } }, "nome");
await status422("telefone com DDD inexistente (00)", { telefone: "00999990000" }, "telefone");
await status422("telefone com DDD 23 (não existe)", { telefone: "23999990000" }, "telefone");
await status422("telefone com 9 dígitos", { telefone: "999990000" }, "telefone");
await status422("celular de 11 dígitos sem o 9", { telefone: "24899990000" }, "telefone");
await status422("+55 com DDD inválido", { telefone: "+5500999990000" }, "telefone");
await status422("telefone como número", { telefone: 24999990000 }, "telefone");
await status422("e-mail inválido", { email: "sem-arroba" }, "email");
await status422("e-mail com mais de 254", { email: "a".repeat(250) + "@x.com" }, "email");
await status422("obs com 501 caracteres", { obs: "x".repeat(501) }, "obs");
await status422("Instagram inválido", { instagramCliente: "meu insta!" }, "instagramCliente");
await status422("Instagram com 31 caracteres", { instagramCliente: "a".repeat(31) }, "instagramCliente");
await status422("seguiuInstagram como texto", { seguiuInstagram: "sim" }, "seguiuInstagram");

// o que é aceito
const dig = n => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
for (const [n, tel] of [["celular BR formatado", `(24) 9${dig(4)}-${dig(4)}`], ["fixo BR de 10 dígitos", "2433" + dig(6)], ["BR com 55", "55249" + dig(8)], ["internacional E.164", "+3519" + dig(8)]]) {
  const r = await post("/api/reservas", { corpo: rv({ telefone: tel }) });
  checar(`E4  telefone ${n} é aceito`, r.status === 200, `${r.status} ${JSON.stringify(await jsonDe(r))}`);
}
{
  const r = await post("/api/reservas", { corpo: rv({ pax: 15, plano: "adventure", hora: 8 }) });
  checar("E4  pax 15 é aceito (com vaga)", r.status === 200, r.status);
}

// WhatsApp seguro, campos desconhecidos, texto perigoso
{
  const nome = `Zé "<script>alert(1)</script>" & Cia`;
  const obs = "Linha 1\r\n\r\n\r\n\r\nLinha 2 com % & = ? # e emoji 🙂";
  const antes = contar();
  const r = await post("/api/reservas", { corpo: rv({ nome, obs, whatsapp: "5511999999999", numero: "5511888888888", telefone: `(24) 9${dig(4)}-${dig(4)}`, waHref: "https://evil.example" }) });
  const j = await jsonDe(r);
  checar("E4  nome/obs perigosos são aceitos como texto", r.status === 200 && j.ok, `${r.status}`);
  checar("E4  link do WhatsApp usa o número fixo do servidor", /^https:\/\/wa\.me\/5524993337247\?text=/.test(j.whatsapp), j.whatsapp.slice(0, 50));
  const texto = decodeURIComponent(j.whatsapp.split("?text=")[1]);
  checar("E4  o texto do link decodifica para o mesmo nome e preserva a URL", texto.includes("Nome: " + nome) && !j.whatsapp.includes("<script>") && !j.whatsapp.includes(" "), j.whatsapp.slice(0, 120));
  checar("E4  quebras de linha em excesso viram uma linha em branco", texto.includes("Observações: Linha 1\n\nLinha 2") && !texto.includes("\n\n\n"), JSON.stringify(texto.split("\n").slice(9, 14)));
  const gravado = sql("SELECT nome, obs, telefone FROM reservas WHERE codigo = ?", j.codigo)[0];
  checar("E4  gravou 1 linha, com o texto original e o telefone só com dígitos", contar() === antes + 1 && gravado.nome === nome && /^249\d{8}$/.test(gravado.telefone), JSON.stringify(gravado));
  checar("E4  campos desconhecidos (whatsapp, numero, waHref) não aparecem na mensagem", !/5511999999999|5511888888888|evil/.test(texto));
}
{
  const [a, b] = [await post("/api/reservas", { corpo: rv() }), await post("/api/reservas", { corpo: rv() })];
  const [ja, jb] = [await jsonDe(a), await jsonDe(b)];
  const re = /^TA-[A-Z0-9-]{4,32}$/;
  checar("E4  código do pedido casa com /^TA-[A-Z0-9-]{4,32}$/ e muda a cada reserva", re.test(ja.codigo) && re.test(jb.codigo) && ja.codigo !== jb.codigo, `${ja.codigo} ${jb.codigo}`);
  checar("E4  código não é sequencial (não é só número)", !/^TA-\d+$/.test(ja.codigo), ja.codigo);
}

// vaga: lotado e bloqueado → 409; corrida pelo último lugar
{
  const dia = somaDias(hoje, 60 + Math.floor(Math.random() * 25));
  exec(`DELETE FROM reservas WHERE data = '${dia}' AND hora = 10`); // horário de teste começa vazio (banco local)
  const ocupar = async pax => post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora: 10, pax }) });
  const r1 = await ocupar(15); checar("E4  15 pessoas no horário (restam 5)", r1.status === 200, r1.status);
  const antes = contar();
  const [x, y] = await Promise.all([ocupar(5), ocupar(5)]);
  const cods = [x.status, y.status].sort();
  checar("E4  corrida: 2 pedidos simultâneos para o último lugar → 1 sucesso e 1 409", cods.join() === "200,409", cods.join());
  checar("E4  corrida: só 1 linha nova", contar() === antes + 1, `${antes} → ${contar()}`);
  const lotado = await post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora: 10, pax: 1 }) });
  const jl = await jsonDe(lotado);
  checar("E4  horário lotado → 409 com motivo \"cheio\"", lotado.status === 409 && jl.motivo === "cheio" && jl.restam === 0, `${lotado.status} ${JSON.stringify(jl)}`);
  const dia2 = somaDias(hoje, 50 + Math.floor(Math.random() * 9));
  exec(`INSERT INTO bloqueios (id, data, hora, motivo, criado_em) VALUES ('teste-bloq-${Date.now()}', '${dia2}', NULL, 'teste', '${new Date().toISOString()}')`);
  const bloq = await post("/api/reservas", { corpo: reservaValida({ data: dia2 }) });
  const jb2 = await jsonDe(bloq);
  exec(`DELETE FROM bloqueios WHERE motivo = 'teste' AND data = '${dia2}'`);
  checar("E4  dia bloqueado → 409 com motivo \"bloqueado\"", bloq.status === 409 && jb2.motivo === "bloqueado", `${bloq.status} ${JSON.stringify(jb2)}`);
}

// eventos: allowlist e tamanhos
{
  const antes = contar("eventos");
  const e1 = await post("/api/eventos", { corpo: { tipo: "qualquer-coisa" } });
  checar("E4  evento com tipo desconhecido → 400 e não grava", e1.status === 400 && contar("eventos") === antes, e1.status);
  const e2 = await post("/api/eventos", { corpo: { tipo: "envio_whatsapp", sessao: "curta", reservaCodigo: "<img src=x>", origemDetalhe: "d".repeat(500), origem: "link:Campanha X!" } });
  const linha = sql("SELECT * FROM eventos ORDER BY id DESC LIMIT 1")[0];
  checar("E4  evento: sessão fora do padrão, código inválido e origemDetalhe longo são normalizados", e2.status === 200 && linha.sessao === null && linha.reserva_codigo === null && linha.origem_detalhe.length === 100 && linha.origem === "link:campanhax", JSON.stringify(linha));
}

// SQL sempre parametrizado
{
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  let achados = "";
  try { achados = execFileSync("git", ["-C", fileURLToPath(new URL("..", import.meta.url)), "grep", "-nE", "prepare\\(`|prepare\\(\".*\\+|\\$\\{.*\\}.*(SELECT|INSERT|UPDATE|DELETE)", "--", "site/_worker.js"], { encoding: "utf8" }); } catch (e) { achados = e.stdout || ""; }
  checar("E4  _worker.js sem SQL montado por concatenação/template com valor do pedido", achados.trim() === "", achados.trim().slice(0, 200));
}

resumo();

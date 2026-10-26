// Testes da API (portão dos POST, validação, idempotência, Turnstile, admin…).
// Uso:  node testes/testar-api.mjs      (wrangler pages dev em http://127.0.0.1:8788)
// Só localhost. Grava reservas de teste no D1 LOCAL; confere a contagem de linhas antes e depois.
import { checar, resumo, contar, post, reservaValida, ipNovo, telNovo, exec, sql, BASE, hojeSP, somaDias, limparDadosDeTeste, iniciarServidorDeCertificados, criarJwtAccess, ACCESS_AUD_TESTE } from "./lib-testes.mjs";
await iniciarServidorDeCertificados(); // certificados de teste do Access (S23)

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
  checar("E4  link do WhatsApp usa o número fixo do servidor", /^https:\/\/wa\.me\/5524992073621\?text=/.test(j.whatsapp), j.whatsapp.slice(0, 50));
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

// ---------- ETAPA 5 — idempotência e prazo da reserva pendente ----------
const comChave = (chave, corpo, extra = {}) => post("/api/reservas", { corpo, cabecalhos: { "idempotency-key": chave }, ...extra });
const uuid = () => crypto.randomUUID();
const slot = (hora = 11) => ({ dia: somaDias(hoje, 30 + Math.floor(Math.random() * 40)), hora });
const limparSlot = (dia, hora) => exec(`DELETE FROM reservas WHERE data = '${dia}' AND hora = ${hora}`);
const restamEm = async (dia, hora) => (await (await fetch(`${BASE}/api/disponibilidade?data=${dia}`)).json()).grade[String(hora)].restam;

{
  // mesma chave duas vezes → 1 linha e o mesmo código
  const { dia } = slot(); const antes = contar(); const chave = uuid(); const corpo = reservaValida({ data: dia });
  const a = await comChave(chave, corpo); const ja = await jsonDe(a);
  const b = await comChave(chave, corpo); const jb = await jsonDe(b);
  checar("E5  mesma Idempotency-Key duas vezes → 200 nas duas e o mesmo código", a.status === 200 && b.status === 200 && ja.codigo === jb.codigo, `${a.status}/${b.status} ${ja?.codigo}/${jb?.codigo}`);
  checar("E5  …e só 1 linha nova no D1", contar() === antes + 1, `${antes} → ${contar()}`);
  checar("E5  a resposta repetida traz o mesmo link do WhatsApp e marca repetido", jb.whatsapp === ja.whatsapp && jb.repetido === true, jb.repetido);
  const c = await comChave(chave, { ...corpo, pax: 3 });
  checar("E5  mesma chave com outro pedido → 409 (chave_em_uso), sem linha nova", c.status === 409 && (await jsonDe(c)).motivo === "chave_em_uso" && contar() === antes + 1, c.status);
  const bad = await comChave("curta", corpo);
  checar("E5  chave inválida → 422", bad.status === 422 && (await jsonDe(bad)).erros?.idempotencyKey, bad.status);
  const viaJson = await post("/api/reservas", { corpo: { ...reservaValida({ data: dia, telefone: telNovo() }), idempotencyKey: uuid() } });
  checar("E5  chave também aceita no corpo JSON", viaJson.status === 200, viaJson.status);
}
{
  // duas requisições simultâneas com a mesma chave (clique duplo) → 1 reserva
  const { dia } = slot(); const antes = contar(); const chave = uuid(); const corpo = reservaValida({ data: dia });
  const [a, b] = await Promise.all([comChave(chave, corpo), comChave(chave, corpo)]);
  const [ja, jb] = [await jsonDe(a), await jsonDe(b)];
  checar("E5  duas requisições simultâneas com a mesma chave → ambas 200 com o mesmo código", a.status === 200 && b.status === 200 && ja.codigo === jb.codigo, `${a.status}/${b.status} ${ja?.codigo}/${jb?.codigo}`);
  checar("E5  …e só 1 linha nova", contar() === antes + 1, `${antes} → ${contar()}`);
}
{
  // pedido igual (telefone+data+hora+plano) com outra chave em menos de 30 min → 409 duplicado
  const { dia } = slot(); const tel = telNovo(); const corpo = reservaValida({ data: dia, telefone: tel });
  const a = await comChave(uuid(), corpo); const antes = contar();
  const b = await comChave(uuid(), corpo); const jb = await jsonDe(b);
  checar("E5  mesmo telefone+data+hora+plano com outra chave → 409 duplicado, sem linha nova", a.status === 200 && b.status === 409 && jb.motivo === "duplicado" && contar() === antes, `${a.status}/${b.status} ${JSON.stringify(jb)}`);
  const outraHora = await comChave(uuid(), { ...corpo, hora: 10 });
  checar("E5  mesmo telefone em outro horário é aceito", outraHora.status === 200, outraHora.status);
  exec(`UPDATE reservas SET criado_em = '${new Date(Date.now() - 31 * 60000).toISOString()}' WHERE telefone = '${tel}' AND hora = 9`);
  const depois = await comChave(uuid(), corpo);
  checar("E5  passados 30 min o mesmo pedido volta a ser aceito", depois.status === 200, depois.status);
}
{
  // prazo da pendente: vencida deixa de contar; confirmada e linha antiga continuam contando
  const { dia, hora } = slot(11); limparSlot(dia, hora);
  const base = await restamEm(dia, hora);
  const r = await post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora, pax: 5 }) });
  const j = await jsonDe(r);
  checar("E5  pendente nova segura a vaga (restam cai 5)", r.status === 200 && (await restamEm(dia, hora)) === base - 5, `${base} → ${await restamEm(dia, hora)}`);
  const linha = sql("SELECT expira_em, criado_em, status FROM reservas WHERE codigo = ?", j.codigo)[0];
  const horasAte = (Date.parse(linha.expira_em) - Date.parse(linha.criado_em)) / 3600e3;
  checar("E5  expira_em gravado, no máximo 6 h depois da criação", linha.status === "pendente" && horasAte > 0 && horasAte <= 6.001, `${horasAte.toFixed(2)} h`);
  exec(`UPDATE reservas SET expira_em = '2000-01-01T00:00:00.000Z' WHERE codigo = '${j.codigo}'`);
  checar("E5  pendente vencida deixa de contar (restam volta)", (await restamEm(dia, hora)) === base, `${await restamEm(dia, hora)} vs ${base}`);
  exec(`UPDATE reservas SET status = 'confirmada' WHERE codigo = '${j.codigo}'`);
  checar("E5  confirmada continua contando mesmo com o prazo vencido", (await restamEm(dia, hora)) === base - 5, await restamEm(dia, hora));
  exec(`UPDATE reservas SET status = 'pendente' WHERE codigo = '${j.codigo}'`);
  exec(`INSERT INTO reservas (id, codigo, criado_em, plano, data, hora, pax, nome, telefone, total, voucher, status, canal) VALUES ('legado-${Date.now()}', 'TA-9999', '2026-01-01T00:00:00.000Z', 'adventure', '${dia}', ${hora}, 3, 'Reserva antiga', '24999990000', 450, 180, 'pendente', 'site')`);
  checar("E5  linha antiga (sem expira_em) continua contando (restam cai 3)", (await restamEm(dia, hora)) === base - 3, `${await restamEm(dia, hora)} vs ${base - 3}`);
  limparSlot(dia, hora);
}
{
  // painel: lista mostra "expirada"; confirmar uma vencida com o horário já ocupado é recusado (409)
  const { dia, hora } = slot(12); limparSlot(dia, hora);
  const adm = { "Cf-Access-Jwt-Assertion": criarJwtAccess(), origin: BASE, "content-type": "application/json" };
  const a = await jsonDe(await post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora, pax: 5 }) }));
  exec(`UPDATE reservas SET expira_em = '2000-01-01T00:00:00.000Z' WHERE codigo = '${a.codigo}'`);
  const lista = await (await fetch(`${BASE}/api/admin/reservas?de=${dia}&ate=${dia}`, { headers: adm })).json();
  checar("E5  painel mostra a pendente vencida como \"expirada\"", lista.reservas.find(x => x.codigo === a.codigo)?.status === "expirada", JSON.stringify(lista.reservas.map(x => x.status)));
  const cheio = await post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora, pax: 15 }) });
  const cheio2 = await post("/api/reservas", { corpo: reservaValida({ plano: "adventure", data: dia, hora, pax: 5 }) });
  checar("E5  a vaga liberada pela vencida pode ser ocupada por outro cliente", cheio.status === 200 && cheio2.status === 200, `${cheio.status}/${cheio2.status}`);
  const id = sql("SELECT id FROM reservas WHERE codigo = ?", a.codigo)[0].id;
  const conf = await fetch(`${BASE}/api/admin/reservas/${id}`, { method: "PATCH", headers: adm, body: JSON.stringify({ status: "confirmada" }) });
  checar("E5  confirmar a vencida com o horário lotado → 409 (sem overbooking)", conf.status === 409, `${conf.status} ${(await jsonDe(conf))?.erro}`);
  exec(`UPDATE reservas SET status = 'cancelada' WHERE codigo = '${(await jsonDe(cheio2)).codigo}'`);
  const conf2 = await fetch(`${BASE}/api/admin/reservas/${id}`, { method: "PATCH", headers: adm, body: JSON.stringify({ status: "confirmada" }) });
  checar("E5  com espaço no horário, confirmar a vencida funciona", conf2.status === 200, `${conf2.status} ${(await jsonDe(conf2))?.erro}`);
  limparSlot(dia, hora);
}
{
  // regra do prazo (função pura do worker)
  const src = (await import("node:fs")).readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const t = s => Date.parse(s);
  const casos = [
    ["criada com folga: 6 h", w.expiraEm("2026-10-22", 9, t("2026-10-20T15:00:00Z")), "2026-10-20T21:00:00.000Z"],
    ["12 h antes do passeio vem antes das 6 h", w.expiraEm("2026-10-22", 9, t("2026-10-21T20:00:00Z")), "2026-10-22T00:00:00.000Z"],
    ["feita com menos de 12 h: 6 h (ou a saída, se vier antes) — 6 h", w.expiraEm("2026-10-22", 9, t("2026-10-22T03:00:00Z")), "2026-10-22T09:00:00.000Z"],
    ["feita perto da saída: vale até a hora do passeio", w.expiraEm("2026-10-22", 9, t("2026-10-22T10:00:00Z")), "2026-10-22T12:00:00.000Z"],
    ["horário 8:30 (Boat)", w.expiraEm("2026-10-22", 8.5, t("2026-10-21T20:00:00Z")), "2026-10-21T23:30:00.000Z"]
  ];
  for (const [n, got, esperado] of casos) checar(`E5  prazo: ${n}`, got === esperado, `${got} ≠ ${esperado}`);
}

// ---------- ETAPA 6 — Turnstile no formulário de reserva ----------
{
  const antes = contar();
  const semToken = await post("/api/reservas", { corpo: reservaValida(), semToken: true });
  checar("E6  reserva sem token do Turnstile → 403", semToken.status === 403, semToken.status);
  const numero = await post("/api/reservas", { corpo: { ...reservaValida(), "cf-turnstile-response": 12345 } });
  checar("E6  token que não é texto → 403", numero.status === 403, numero.status);
  const curto = await post("/api/reservas", { corpo: { ...reservaValida(), "cf-turnstile-response": "abc" } });
  checar("E6  token curto demais → 403", curto.status === 403, curto.status);
  const vazio = await post("/api/reservas", { corpo: { ...reservaValida(), "cf-turnstile-response": "" } });
  checar("E6  token vazio → 403", vazio.status === 403, vazio.status);
  checar("E6  nenhuma dessas grava reserva", contar() === antes, `${antes} → ${contar()}`);
  const e = await post("/api/eventos", { corpo: { tipo: "visita", sessao: "teste-sessao-01" } });
  checar("E6  eventos não exigem Turnstile", e.status === 200, e.status);
  const ok1 = await post("/api/reservas", { corpo: reservaValida({ data: somaDias(hojeSP(), 5) }) });
  checar("E6  com o token de teste (chave de teste da Cloudflare) a reserva é aceita e grava", ok1.status === 200 && contar() === antes + 1, `${ok1.status}`);
}
{
  // o script do Turnstile só carrega na rota de reserva; o segredo não está no client
  const home = await (await fetch(BASE + "/")).text();
  const reservar = await (await fetch(BASE + "/reservar")).text();
  checar("E6  HTML de / não cita challenges.cloudflare.com", !home.includes("challenges.cloudflare.com"));
  checar("E6  HTML de /reservar também não (o script entra pelo app.js, só nessa rota)", !reservar.includes("challenges.cloudflare.com"));
  checar("E6  index.html traz a sitekey pública de teste no meta", /<meta name="turnstile-sitekey" content="1x00000000000000000000AA">/.test(reservar));
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  let achados = "";
  try { achados = execFileSync("git", ["-C", fileURLToPath(new URL("..", import.meta.url)), "grep", "-nE", "TURNSTILE_SECRET|0x4AAAA", "--", "site/app.js", "site/index.html", "site/estilo.css", "site/motion.js", "site/pescaria-galeria.js"], { encoding: "utf8" }); } catch (e) { achados = e.stdout || ""; }
  checar("E6  segredo do Turnstile e chaves reais não aparecem no JS/HTML do site", achados.trim() === "", achados.trim());
}
{
  // verificação com respostas simuladas da Cloudflare (caminhos de chave real)
  const src = (await import("node:fs")).readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const env = { TURNSTILE_SECRET: "segredo-real" };
  const falso = corpo => async () => ({ ok: true, json: async () => corpo });
  const tok = "token-de-teste-1234567890";
  const v = (e, corpo) => w.verificarTurnstile(tok, "1.2.3.4", e, falso(corpo));
  const casos = [
    ["sucesso, host e ação certos", await v(env, { success: true, hostname: "trindadeadventury.com.br", action: "reserva" }), true, undefined],
    ["host do pages.dev de produção", await v(env, { success: true, hostname: "trindade-adventure.pages.dev", action: "reserva" }), true, undefined],
    ["preview (subdomínio do pages.dev)", await v(env, { success: true, hostname: "abc123.trindade-adventure.pages.dev", action: "reserva" }), true, undefined],
    ["host de outro site", await v(env, { success: true, hostname: "evil.example", action: "reserva" }), false, "host"],
    ["pages.dev de outro projeto", await v(env, { success: true, hostname: "outro.pages.dev", action: "reserva" }), false, "host"],
    ["ação errada", await v(env, { success: true, hostname: "trindadeadventury.com.br", action: "login" }), false, "acao"],
    ["sem ação", await v(env, { success: true, hostname: "trindadeadventury.com.br" }), false, "acao"],
    ["success false", await v(env, { success: false, "error-codes": ["invalid-input-response"] }), false, "recusado"],
    ["TURNSTILE_HOSTNAMES manda: host de fora da lista", await v({ ...env, TURNSTILE_HOSTNAMES: "meu.site" }, { success: true, hostname: "trindadeadventury.com.br", action: "reserva" }), false, "host"],
    ["chave de teste (metadata) dispensa host e ação", await v(env, { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }), true, undefined],
    ["sem segredo configurado", await w.verificarTurnstile(tok, "1.2.3.4", {}, falso({ success: true })), false, "sem-segredo"],
    ["sem token", await w.verificarTurnstile(undefined, "1.2.3.4", env, falso({ success: true })), false, "sem-token"]
  ];
  for (const [n, r, okEsp, motivo] of casos) checar(`E6  verificação: ${n}`, r.ok === okEsp && (motivo === undefined || r.motivo === motivo), JSON.stringify(r));
  const cai = await w.verificarTurnstile(tok, "1.2.3.4", env, async () => { throw new Error("rede caiu"); });
  checar("E6  verificação: Cloudflare fora do ar → indisponível (vira 503, não grava)", cai.ok === false && cai.motivo === "indisponivel", JSON.stringify(cai));
  const http500 = await w.verificarTurnstile(tok, "1.2.3.4", env, async () => ({ ok: false, json: async () => ({}) }));
  checar("E6  verificação: resposta 5xx da Cloudflare → indisponível", http500.motivo === "indisponivel", JSON.stringify(http500));
}

// ---------- ETAPA 23 — /admin: JWT do Cloudflare Access conferido no worker ----------
{
  const get = (caminho, headers = {}) => fetch(BASE + caminho, { headers, redirect: "manual" });
  const jwt = criarJwtAccess();
  const rotaApi = "/api/admin/resumo";
  const recusa = async (nome, headers) => { const r = await get(rotaApi, headers); await r.arrayBuffer(); checar(`E23 ${nome} → 403`, r.status === 403, r.status); };
  await recusa("sem credencial", {});
  await recusa("só o header de e-mail do Access (antes bastava, agora não)", { "Cf-Access-Authenticated-User-Email": "teste@example.com" });
  await recusa("Cf-Access-Jwt-Assertion: x", { "Cf-Access-Jwt-Assertion": "x" });
  await recusa("JWT com 3 partes de lixo", { "Cf-Access-Jwt-Assertion": "a.b.c" });
  await recusa("JWT expirado", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ exp: Math.floor(Date.now() / 1000) - 3600 }) });
  await recusa("JWT com audiência de outro aplicativo", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ aud: "outro-aud" }) });
  await recusa("JWT de outro emissor", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ iss: "https://evil.cloudflareaccess.com" }) });
  await recusa("JWT assinado com outra chave", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ comOutraChave: true }) });
  await recusa("JWT com kid desconhecido", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ kid: "kid-que-nao-existe" }) });
  await recusa("JWT com alg diferente de RS256 (HS256)", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ alg: "HS256" }) });
  await recusa("JWT com alg none", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ alg: "none" }) });
  await recusa("JWT que só vale no futuro (nbf)", { "Cf-Access-Jwt-Assertion": criarJwtAccess({ nbf: Math.floor(Date.now() / 1000) + 3600 }) });
  await recusa("JWT gigante (> 8 KB)", { "Cf-Access-Jwt-Assertion": "a".repeat(9000) });
  const ok1 = await get(rotaApi, { "Cf-Access-Jwt-Assertion": jwt });
  const corpo = await ok1.json();
  checar("E23 JWT de teste válido → 200 com o resumo", ok1.status === 200 && typeof corpo === "object", ok1.status);
  checar("E23 admin API: X-Robots-Tag noindex, nofollow e Cache-Control private, no-store", ok1.headers.get("x-robots-tag") === "noindex, nofollow" && ok1.headers.get("cache-control") === "private, no-store", JSON.stringify([...ok1.headers]));
  const sem = await get(rotaApi); await sem.arrayBuffer();
  checar("E23 resposta 403 do admin também sai com noindex e private, no-store", sem.headers.get("x-robots-tag") === "noindex, nofollow" && sem.headers.get("cache-control") === "private, no-store");
  for (const c of ["/admin", "/admin/reservas", "/admin.html"]) {
    const s = await get(c); await s.arrayBuffer();
    checar(`E23 ${c} sem JWT → 403 (sem corpo do painel)`, s.status === 403, s.status);
  }
  const pag = await get("/admin", { "Cf-Access-Jwt-Assertion": jwt }); const html = await pag.text();
  checar("E23 /admin com JWT válido → entrega o painel, com noindex e private, no-store", pag.status === 200 && /<title>/i.test(html) && pag.headers.get("x-robots-tag") === "noindex, nofollow" && pag.headers.get("cache-control") === "private, no-store", `${pag.status} ${pag.headers.get("cache-control")}`);
  const home = await get("/"); await home.arrayBuffer();
  checar("E23 o site público não foi afetado (200, sem noindex de admin)", home.status === 200 && !home.headers.has("x-robots-tag"));

  // Mutações do painel: Origin do próprio site e JSON
  const mut = async (nome, init, esperado) => { const r = await fetch(BASE + "/api/admin/bloqueios", { method: "POST", redirect: "manual", ...init, headers: { "Cf-Access-Jwt-Assertion": jwt, ...init.headers } }); await r.arrayBuffer(); checar(`E23 mutação: ${nome} → ${esperado}`, r.status === esperado, r.status); };
  await mut("Origin de fora", { headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }, 403);
  await mut("sem Origin nem Sec-Fetch-Site", { headers: { "content-type": "application/json" }, body: "{}" }, 403);
  await mut("Content-Type text/plain", { headers: { origin: BASE, "content-type": "text/plain" }, body: "{}" }, 415);
  const del = await fetch(BASE + "/api/admin/bloqueios/inexistente", { method: "DELETE", headers: { "Cf-Access-Jwt-Assertion": jwt, origin: "https://evil.example" } }); await del.arrayBuffer();
  checar("E23 mutação: DELETE com Origin de fora → 403", del.status === 403, del.status);
  const patch = await fetch(BASE + "/api/admin/reservas/qualquer", { method: "PATCH", headers: { "Cf-Access-Jwt-Assertion": jwt, "content-type": "text/plain", origin: BASE }, body: "x" }); await patch.arrayBuffer();
  checar("E23 mutação: PATCH com text/plain → 415", patch.status === 415, patch.status);

  // Certificados em cache: várias chamadas válidas não buscam /certs de novo
  checar("E23 5 chamadas válidas seguidas continuam 200 (certificados em cache)", (await Promise.all([1, 2, 3, 4, 5].map(() => get(rotaApi, { "Cf-Access-Jwt-Assertion": jwt })))).every(r => r.status === 200));

  // Sem ACCESS_AUD configurado: tudo no painel é 403, mesmo com um JWT bem assinado
  const src = (await import("node:fs")).readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const envSemAud = { DB: {}, ASSETS: { fetch: async () => new Response("painel") }, ACCESS_CERTS_URL: "http://127.0.0.1:8791/certs" };
  for (const caminho of ["/api/admin/resumo", "/admin"]) {
    const r = await w.default.fetch(new Request("http://127.0.0.1:8788" + caminho, { headers: { "Cf-Access-Jwt-Assertion": jwt } }), envSemAud);
    checar(`E23 sem env.ACCESS_AUD, ${caminho} responde 403 mesmo com JWT válido`, r.status === 403, r.status);
  }
  const envComAud = { ...envSemAud, ACCESS_AUD: ACCESS_AUD_TESTE };
  const rOk = await w.default.fetch(new Request("http://127.0.0.1:8788/admin", { headers: { "Cf-Access-Jwt-Assertion": jwt } }), envComAud);
  checar("E23 com env.ACCESS_AUD e JWT válido, /admin passa para o painel", rOk.status === 200 && (await rOk.text()) === "painel", rOk.status);
  checar("E23 ADMIN_KEY (só desenvolvimento) continua exigindo o header X-Admin-Key, nunca a query", (await w.default.fetch(new Request("http://127.0.0.1:8788/api/admin/resumo?key=k", {}), { ...envComAud, ADMIN_KEY: "k" })).status === 403);
}

// ---------- ETAPA 22 — redirecionamento para o domínio oficial (função pura) ----------
{
  const src = (await import("node:fs")).readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const ON = { REDIRECIONAR_PARA_DOMINIO: "1" };
  const P = "trindade-adventure" + ".pages.dev";
  const casos = [
    ["GET pages.dev/passeios/boat?utm_source=x", `https://${P}/passeios/boat?utm_source=x`, "GET", ON, "https://trindadeadventury.com.br/passeios/boat?utm_source=x"],
    ["GET www/ → apex", "https://www.trindadeadventury.com.br/", "GET", ON, "https://trindadeadventury.com.br/"],
    ["HEAD igual ao GET", `https://${P}/pescaria`, "HEAD", ON, "https://trindadeadventury.com.br/pescaria"],
    ["POST /api/reservas no pages.dev", `https://${P}/api/reservas`, "POST", ON, null],
    ["PUT não redireciona", `https://${P}/x`, "PUT", ON, null],
    ["preview por hash", `https://abc123.${P}/`, "GET", ON, null],
    ["preview por branch", `https://fix-pre-lancamento.${P}/passeios`, "GET", ON, null],
    ["apex (sem loop)", "https://trindadeadventury.com.br/", "GET", ON, null],
    ["localhost", "http://localhost:8788/", "GET", ON, null],
    ["127.0.0.1", "http://127.0.0.1:8788/", "GET", ON, null],
    ["host parecido (evilpages)", `https://evil-${P}/`, "GET", ON, null],
    ["host com o nome no caminho", `https://exemplo.com/${P}`, "GET", ON, null],
    ["sem a variável", `https://${P}/passeios`, "GET", {}, null],
    ["variável '0'", `https://${P}/passeios`, "GET", { REDIRECIONAR_PARA_DOMINIO: "0" }, null],
    ["variável 'true' (só \"1\" vale)", `https://${P}/passeios`, "GET", { REDIRECIONAR_PARA_DOMINIO: "true" }, null],
    ["env ausente", `https://${P}/passeios`, "GET", undefined, null],
    ["raiz sem caminho", `https://${P}`, "GET", ON, "https://trindadeadventury.com.br/"],
    ["query preservada com vários parâmetros", `https://${P}/reservar?plano=boat&fonte=ig`, "GET", ON, "https://trindadeadventury.com.br/reservar?plano=boat&fonte=ig"]
  ];
  console.log("\n  caso                                  resultado");
  for (const [nome, url, metodo, env, esperado] of casos) {
    const r = w.destinoRedirect(url, metodo, env);
    console.log("  " + nome.padEnd(38) + (r === null ? "null" : r));
    checar(`E22 redirect: ${nome}`, r === esperado, String(r));
  }
  checar("E22 redirect: também aceita um objeto URL", w.destinoRedirect(new URL(`https://${P}/a?b=1`), "GET", ON) === "https://trindadeadventury.com.br/a?b=1");
  checar("E22 redirect: entrada inválida não lança erro", w.destinoRedirect("não é url", "GET", ON) === null);
  console.log("");
  const r301 = await fetch(BASE + "/passeios?x=1", { redirect: "manual" });
  checar("E22 localhost (o ambiente local) responde 200 e não 301", r301.status === 200, r301.status);
}

// ---------- ETAPA 18 — /api/csp-report ----------
{
  const relatorio = { "csp-report": { "document-uri": "http://127.0.0.1:8788/passeios/boat?plano=boat&nome=Maria", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?token=segredo#frag", "violated-directive": "script-src-elem", "original-policy": "default-src 'self'", "source-file": "http://127.0.0.1:8788/app.js", "line-number": 10 } };
  const sem = (c, extra = {}) => post("/api/csp-report", { corpo: relatorio, tipo: "application/csp-report", origem: "", ...extra, ...c });
  const ok1 = await sem({});
  checar("E18 csp-report (application/csp-report, sem Origin) → 204 sem corpo", ok1.status === 204 && (await ok1.text()) === "", ok1.status);
  const lista = [{ type: "csp-violation", url: "http://127.0.0.1:8788/reservar?x=1", body: { effectiveDirective: "style-src-attr", blockedURL: "inline", documentURL: "http://127.0.0.1:8788/reservar?x=1" } }];
  const ok2 = await post("/api/csp-report", { corpo: lista, tipo: "application/reports+json", origem: "" });
  checar("E18 csp-report (application/reports+json, lista) → 204", ok2.status === 204, ok2.status);
  const ok3 = await post("/api/csp-report", { corpo: relatorio, tipo: "application/csp-report" });
  checar("E18 csp-report com Origin do próprio site → 204", ok3.status === 204, ok3.status);
  const ruim = await post("/api/csp-report", { corpo: relatorio, tipo: "application/csp-report", origem: "https://evil.example" });
  checar("E18 csp-report com Origin de fora → 403", ruim.status === 403, ruim.status);
  const txt = await sem({ tipo: "text/plain" });
  checar("E18 csp-report com text/plain → 415", txt.status === 415, txt.status);
  const json = await sem({ tipo: "application/json" });
  checar("E18 csp-report com application/json → 415 (só os dois tipos de relatório)", json.status === 415, json.status);
  const grande = await post("/api/csp-report", { bruto: JSON.stringify({ "csp-report": { x: "a".repeat(20 * 1024) } }), tipo: "application/csp-report", origem: "" });
  checar("E18 csp-report com corpo de 20 KB → 413", grande.status === 413, grande.status);
  const get = await fetch(BASE + "/api/csp-report", { redirect: "manual" });
  checar("E18 GET /api/csp-report → 405 com Allow: POST", get.status === 405 && get.headers.get("allow") === "POST", get.status);
  const lixo = await post("/api/csp-report", { bruto: "não é json", tipo: "application/csp-report", origem: "" });
  checar("E18 corpo que não é JSON → 400", lixo.status === 400, lixo.status);
  const antesRes = contar(), antesEv = contar("eventos");
  await sem({}); await post("/api/csp-report", { corpo: lista, tipo: "application/reports+json", origem: "" });
  checar("E18 relatório não grava nada no banco (nem reserva nem evento)", contar() === antesRes && contar("eventos") === antesEv, `${antesRes}/${antesEv} → ${contar()}/${contar("eventos")}`);
  const ip = ipNovo(); const cods = [];
  for (let i = 0; i < 31; i++) cods.push((await sem({ ip })).status);
  checar("E18 rajada: 30 passam (204) e o 31º é 429 com Retry-After", cods.slice(0, 30).every(c => c === 204) && cods[30] === 429, cods.join(","));
  const outroIp = await sem({ ip: ipNovo() });
  checar("E18 outro IP não é afetado pela rajada", outroIp.status === 204, outroIp.status);

  // Resumo: só diretiva, recurso sem query, caminho da página e hora — nada de query string, host da página, UA ou IP
  const src = (await import("node:fs")).readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  const w = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const [a] = w.resumirRelatorioCsp(relatorio);
  checar("E18 resumo do csp-report: diretiva, bloqueado sem query/fragmento, página só com o caminho", a.diretiva === "script-src-elem" && a.bloqueado === "https://evil.example/x.js" && a.pagina === "/passeios/boat" && Object.keys(a).join() === "diretiva,bloqueado,pagina", JSON.stringify(a));
  const [b] = w.resumirRelatorioCsp(lista);
  checar("E18 resumo do reports+json: mesmos campos", b.diretiva === "style-src-attr" && b.bloqueado === "inline" && b.pagina === "/reservar", JSON.stringify(b));
  const [c] = w.resumirRelatorioCsp({ "csp-report": { "blocked-uri": "data:image/png;base64,AAAA", "document-uri": "javascript:alert(1)", "effective-directive": "img-src\n<script>" } });
  checar("E18 resumo neutraliza data:, página inválida e caracteres de controle", c.bloqueado === "data" && c.pagina === "" && c.diretiva === "img-srcscript", JSON.stringify(c));
  checar("E18 resumo aceita lixo sem lançar erro e limita a 5 itens", w.resumirRelatorioCsp([1, null, "x", [], {}, {}, {}, {}, {}]).length <= 5 && Array.isArray(w.resumirRelatorioCsp(42)) && w.resumirRelatorioCsp({}).length === 1);
}

resumo();

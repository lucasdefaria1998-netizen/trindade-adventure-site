// Testes de comportamento HTTP do site (rotas, 404, cache, SEO, horários).
//
// Uso:  node testes/testar-http.mjs [endereço]
//   endereço padrão: http://localhost:8788  (wrangler pages dev, ver LEIA-ME)
//
// Os testes de POST /api/reservas só rodam contra localhost — gravam reservas
// de teste no banco D1 LOCAL. Contra produção, eles são pulados.
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:8788").replace(/\/$/, "");
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);
const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const SITE = JSON.parse(html.match(/<script type="application\/json" id="site-config">([\s\S]*?)<\/script>/)[1]);

// Telefone novo a cada execução: o worker limita 5 pedidos por telefone em 24 h, e o banco local acumula.
const TEL_TESTE = "2499" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
let falhas = 0, total = 0;
function checar(nome, ok, detalhe) {
  total++;
  if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${nome}${!ok && detalhe ? "  →  " + detalhe : ""}`);
}
const pegar = (caminho, opts) => fetch(BASE + caminho, { redirect: "manual", ...opts });
const attr = (doc, re) => (doc.match(re) || [])[1];
const metaDe = doc => ({
  titulo: attr(doc, /<title>([^<]*)<\/title>/),
  descricao: attr(doc, /<meta name="description" content="([^"]*)"/),
  canonical: attr(doc, /<link rel="canonical" href="([^"]*)"/),
  robots: attr(doc, /<meta name="robots" content="([^"]*)"/),
  ogTitulo: attr(doc, /<meta property="og:title" content="([^"]*)"/),
  ogDescricao: attr(doc, /<meta property="og:description" content="([^"]*)"/),
  ogUrl: attr(doc, /<meta property="og:url" content="([^"]*)"/),
  ogImagem: attr(doc, /<meta property="og:image" content="([^"]*)"/),
  ogTipo: attr(doc, /<meta property="og:type" content="([^"]*)"/),
  twCard: attr(doc, /<meta name="twitter:card" content="([^"]*)"/),
  twTitulo: attr(doc, /<meta name="twitter:title" content="([^"]*)"/),
  twDescricao: attr(doc, /<meta name="twitter:description" content="([^"]*)"/),
  twImagem: attr(doc, /<meta name="twitter:image" content="([^"]*)"/)
});
const desescapar = s => s && s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

console.log(`\nTestando ${BASE}\n`);

// ---------- TESTE 1 — página inicial ----------
{
  const r = await pegar("/");
  const doc = await r.text();
  const m = metaDe(doc);
  checar("T1  / responde 200", r.status === 200, r.status);
  checar("T5  / title da home", m.titulo === SITE.paginas["/"].titulo, m.titulo);
  checar("T5  / description da home", desescapar(m.descricao) === SITE.paginas["/"].descricao, m.descricao);
  checar("T5  / canonical = raiz", m.canonical === SITE.origem + "/", m.canonical);
}

// ---------- TESTE 2 — páginas inexistentes: 404 de verdade ----------
for (const c of ["/pagina-inexistente-123", "/pagina-que-nao-existe", "/teste123", "/qualquer-coisa", "/passeios/nao-existe", "/LEIA-ME"]) {
  const r = await pegar(c);
  const doc = await r.text();
  const m = metaDe(doc);
  checar(`T2  ${c} → 404`, r.status === 404, r.status);
  checar(`T2  ${c} → página "não encontrada" visível`,
    /<section class="secao secao-404" id="nao-encontrada" data-secao="nao-encontrada">/.test(doc) && doc.includes("Voltar para o início"));
  checar(`T2  ${c} → noindex, sem canonical`, m.robots === "noindex,follow" && !m.canonical, JSON.stringify([m.robots, m.canonical]));
  checar(`T2  ${c} → sem cache longo`, !/immutable|max-age=[1-9]/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
}

// ---------- TESTE 3 — arquivos inexistentes: 404, nunca o HTML da home ----------
const arquivosFalsos = [
  "/assets/arquivo-que-nao-existe.js", "/assets/arquivo-inexistente.js", "/assets/x.css", "/assets/x.png",
  "/assets/x.jpg", "/assets/x.jpeg", "/assets/imagem-inexistente.webp", "/assets/x.svg", "/assets/x.ico",
  "/assets/x.json", "/assets/fonte.woff2", "/assets/fonte.ttf", "/assets/sem-extensao", "/vendor/x.min.js",
  "/nao-existe.js", "/nao-existe.css", "/_worker.js", "/LEIA-ME.md"
];
for (const c of arquivosFalsos) {
  const r = await pegar(c);
  const corpo = await r.text();
  const cc = r.headers.get("cache-control") || "";
  checar(`T3  ${c} → 404`, r.status === 404, r.status);
  checar(`T3  ${c} → não é o HTML da home`, !corpo.includes("<!doctype html") && !(r.headers.get("content-type") || "").includes("text/html"),
    r.headers.get("content-type"));
  checar(`T3  ${c} → sem "immutable"/cache longo`, !/immutable|max-age=[1-9]/.test(cc), cc);
}

// ---------- TESTE 4 — arquivos válidos ----------
for (const [c, tipo, cache] of [
  ["/assets/og-v2.jpg", "image/jpeg", "immutable"],
  ["/assets/piscina-v2-800.webp", "image/webp", "immutable"],
  ["/vendor/lenis-1.3.11.min.js", "javascript", "immutable"],
  ["/app.js?v=20261005-rotas", "javascript", "max-age=31536000, immutable"],
  ["/estilo.css?v=20261005-rotas", "text/css", "max-age=31536000, immutable"],
  ["/motion.js?v=20261005-rotas", "javascript", "max-age=31536000, immutable"],
  ["/app.js", "javascript", "max-age=86400"],
  ["/estilo.css", "text/css", "max-age=86400"],
  ["/favicon.svg", "image/svg", "max-age=604800"],
  ["/favicon.ico", "icon", "max-age=604800"],
  ["/apple-touch-icon.png", "image/png", "max-age=604800"],
  ["/manifest.json", "json", "max-age=86400"],
  ["/robots.txt", "text/plain", ""],
  ["/sitemap.xml", "xml", ""]
]) {
  const r = await pegar(c);
  await r.arrayBuffer();
  checar(`T4  ${c} → 200 ${tipo}`, r.status === 200 && (r.headers.get("content-type") || "").includes(tipo),
    `${r.status} ${r.headers.get("content-type")}`);
  if (cache) checar(`T4  ${c} → cache "${cache}"`, (r.headers.get("cache-control") || "").includes(cache), r.headers.get("cache-control"));
}

// ---------- ETAPA 1 — ícones e manifest em todas as rotas ----------
{
  const m = await (await pegar("/manifest.json")).json().catch(() => null);
  checar("E1  manifest.json é JSON válido com nome e ícones", !!m && m.name === "Trindade Adventure" && m.icons.length >= 2, JSON.stringify(m));
  for (const c of ["/", "/passeios/boat", "/historia"]) {
    const doc = await (await pegar(c)).text();
    checar(`E1  ${c} → link do manifest e apple-touch-icon novo`,
      doc.includes('<link rel="manifest" href="/manifest.json">') && doc.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'));
  }
  const lenis = readFileSync(new URL("../site/vendor/lenis-1.3.11.min.js", import.meta.url), "utf8");
  checar("E1  lenis sem sourceMappingURL", !lenis.includes("sourceMappingURL"));
}

// ---------- TESTES 5/6/7 — metadados de cada página ----------
const titulos = new Set();
for (const [caminho, p] of Object.entries(SITE.paginas)) {
  const r = await pegar(caminho);
  const doc = await r.text();
  const m = metaDe(doc);
  const img = SITE.origem + (p.imagem || SITE.imagemPadrao);
  const indexar = p.indexar !== false;
  const erros = [];
  if (r.status !== 200) erros.push("status " + r.status);
  if (m.titulo !== p.titulo) erros.push("title " + m.titulo);
  if (desescapar(m.descricao) !== p.descricao) erros.push("description");
  if (m.canonical !== SITE.origem + caminho) erros.push("canonical " + m.canonical);
  if (m.ogUrl !== SITE.origem + caminho) erros.push("og:url " + m.ogUrl);
  if (m.ogTitulo !== p.titulo || m.twTitulo !== p.titulo) erros.push("og/twitter title");
  if (desescapar(m.ogDescricao) !== p.descricao || desescapar(m.twDescricao) !== p.descricao) erros.push("og/twitter description");
  if (m.ogImagem !== img || m.twImagem !== img) erros.push("imagem " + m.ogImagem);
  if (m.ogTipo !== "website" || m.twCard !== "summary_large_image") erros.push("og:type/twitter:card");
  if (m.robots !== (indexar ? "index,follow" : "noindex,follow")) erros.push("robots " + m.robots);
  if ((r.headers.get("cache-control") || "").includes("immutable")) erros.push("HTML com immutable");
  checar(`T6  ${caminho} → 200 com title/description/canonical/OG/Twitter próprios`, !erros.length, erros.join("; "));
  titulos.add(m.titulo);
}
checar("T6  todas as páginas têm title diferente", titulos.size === Object.keys(SITE.paginas).length, titulos.size);
{
  const m = metaDe(await (await pegar("/passeios/adventure")).text());
  checar("T7  /passeios/adventure → title do Adventure", m.titulo === "Passeio Adventure em Trindade | Trindade Adventure", m.titulo);
  checar("T7  /passeios/adventure → canonical próprio", m.canonical === SITE.origem + "/passeios/adventure", m.canonical);
  checar("T7  /passeios/adventure → og:image da piscina", m.ogImagem === SITE.origem + "/assets/piscina-v2.jpg", m.ogImagem);
  const q = metaDe(await (await pegar("/reservar?plano=adventure&fonte=teste")).text());
  checar("T7  /reservar?plano=… → canonical sem parâmetros", q.canonical === SITE.origem + "/reservar", q.canonical);
}
{
  const r = await pegar("/passeios/");
  checar("T7  /passeios/ → 301 para /passeios", r.status === 301 && (r.headers.get("location") || "").endsWith("/passeios"),
    `${r.status} ${r.headers.get("location")}`);
}

// ---------- TESTE 12 (parte servidor) — sitemap só com URLs reais ----------
{
  const xml = await (await pegar("/sitemap.xml")).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  for (const u of urls) {
    const caminho = new URL(u).pathname;
    const r = await pegar(caminho);
    await r.arrayBuffer();
    const p = SITE.paginas[caminho];
    checar(`SM  sitemap ${caminho} → 200 e indexável`, r.status === 200 && p && p.indexar !== false, r.status);
  }
  const indexaveis = Object.entries(SITE.paginas).filter(([, p]) => p.indexar !== false).map(([c]) => c);
  const faltando = indexaveis.filter(c => !urls.includes(SITE.origem + c));
  checar("SM  sitemap tem todas as páginas indexáveis", !faltando.length, faltando.join(", "));
  const robots = await (await pegar("/robots.txt")).text();
  checar("SM  robots.txt aponta o sitemap", robots.includes("Sitemap: " + SITE.origem + "/sitemap.xml"));
}

// ---------- TESTE 8 (servidor) — horários compatíveis com a duração ----------
{
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const r = await pegar("/api/disponibilidade?data=" + amanha);
  const d = await r.json().catch(() => null);
  if (r.status === 503) {
    console.log("PULADO  T8 servidor: API sem banco (503)");
  } else {
    const hp = d && d.horariosPorPlano;
    checar("T8  disponibilidade devolve horariosPorPlano", !!hp, JSON.stringify(d).slice(0, 120));
    if (hp) {
      checar("T8  Adventure (≈6h) não oferece 13h, 14h nem 15h", !hp.adventure.some(h => h > 12) && Math.max(...hp.adventure) === 12, JSON.stringify(hp.adventure));
      checar("T8  Essencial (≈3h) mantém 08h–15h", JSON.stringify(hp.essencial) === JSON.stringify([8, 9, 10, 11, 12, 13, 14, 15]), JSON.stringify(hp.essencial));
      checar("T8  Boat tem as saídas 08:30 e 11:00", JSON.stringify(hp.boat) === "[8.5,11]", JSON.stringify(hp.boat));
    }

    if (LOCAL) {
      const pedir = corpo => pegar("/api/reservas", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "10." + Math.floor(Math.random() * 250) + "." + Math.floor(Math.random() * 250) + ".7" },
        body: JSON.stringify({ pax: 1, nome: "Teste Automatizado", telefone: TEL_TESTE, origem: "direto", sessao: "teste", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX", ...corpo }) });
      const a15 = await pedir({ plano: "adventure", data: amanha, hora: 15 });
      const j15 = await a15.json();
      checar("T8  POST Adventure às 15:00 é recusado (422)", a15.status === 422 && j15.erros && j15.erros.hora, `${a15.status} ${JSON.stringify(j15)}`);
      const a13 = await pedir({ plano: "adventure", data: amanha, hora: 13 });
      checar("T8  POST Adventure às 13:00 é recusado (422)", a13.status === 422, a13.status);
      const a12 = await pedir({ plano: "adventure", data: amanha, hora: 12 });
      const j12 = await a12.json();
      checar("T8  POST Adventure às 12:00 é aceito", a12.status === 200 && j12.ok, `${a12.status} ${JSON.stringify(j12).slice(0, 120)}`);
      checar("T8  mensagem do WhatsApp com preço do site (R$ 150)", (j12.mensagem || "").includes("Total: R$ 150"), (j12.mensagem || "").split("\n").find(l => l.startsWith("Total")));
      const e15 = await pedir({ plano: "essencial", data: amanha, hora: 15 });
      const je = await e15.json();
      checar("T8  POST Essencial às 15:00 continua aceito, R$ 70", e15.status === 200 && (je.mensagem || "").includes("Total: R$ 70"), `${e15.status}`);
      const passado = await pedir({ plano: "essencial", data: "2020-01-01", hora: 9 });
      checar("T8  POST com data passada é recusado", passado.status === 422, passado.status);
      const agoraH = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      if (agoraH > 8 && agoraH <= 23) {
        const hp2 = await pedir({ plano: "essencial", data: hoje, hora: Math.min(agoraH, 15) });
        checar("T8  POST hoje com horário que já passou é recusado", hp2.status === 422, hp2.status);
      }
    } else {
      console.log("PULADO  T8 POST /api/reservas (só roda contra localhost)");
    }
  }
}


// ---------- ETAPA 7 — wrapper de headers de segurança ----------
{
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const cabecalhosOk = (r, nome) => {
    const h = r.headers; const falta = [];
    if (h.get("strict-transport-security") !== "max-age=31536000; includeSubDomains") falta.push("HSTS=" + h.get("strict-transport-security"));
    if (h.get("x-frame-options") !== "SAMEORIGIN") falta.push("XFO=" + h.get("x-frame-options"));
    if (h.get("x-content-type-options") !== "nosniff") falta.push("nosniff");
    if (h.get("referrer-policy") !== "strict-origin-when-cross-origin") falta.push("referrer");
    if (h.get("permissions-policy") !== "geolocation=(), microphone=(), camera=(), payment=()") falta.push("permissions");
    const cors = [...h.keys()].filter(k => k.startsWith("access-control-"));
    if (cors.length) falta.push("CORS: " + cors.join(","));
    if (/preload/i.test(h.get("strict-transport-security") || "")) falta.push("HSTS com preload");
    return falta.length ? falta.join("; ") : "";
  };
  for (const [caminho, status, cache] of [["/", 200, "public, max-age=0, must-revalidate"], ["/passeios/boat", 200, "public, max-age=0, must-revalidate"],
    ["/nao-existe", 404, "no-cache"], ["/app.js?v=20261020-s06", 200, "public, max-age=31536000, immutable"], ["/assets/og-v2-800.webp", 200, "public, max-age=31536000, immutable"],
    ["/arquivo-que-nao-existe.js", 404, "no-cache"], ["/favicon.svg", 200, "public, max-age=604800"]]) {
    const r = await pegar(caminho); await r.arrayBuffer();
    checar(`E7  ${caminho} → ${status}, HSTS/XFO/nosniff/Referrer/Permissions e nenhum ACAO`, r.status === status && !cabecalhosOk(r), `${r.status} ${cabecalhosOk(r)}`);
    checar(`E7  ${caminho} → cache-control inalterado (${cache})`, (r.headers.get("cache-control") || "") === cache, r.headers.get("cache-control"));
  }
  const api = await pegar("/api/disponibilidade?data=" + amanha); await api.arrayBuffer();
  checar("E7  API (GET): nosniff, no-store, CSP default-src 'none' e nenhum ACAO", api.headers.get("x-content-type-options") === "nosniff" && api.headers.get("cache-control") === "no-store" &&
    api.headers.get("content-security-policy") === "default-src 'none'; frame-ancestors 'none'" && !cabecalhosOk(api) && /^application\/json; charset=utf-8$/.test(api.headers.get("content-type")), JSON.stringify([...api.headers]));
  for (const [nome, resp] of [["POST recusado (415)", await fetch(BASE + "/api/reservas", { method: "POST", headers: { origin: BASE, "content-type": "text/plain" }, body: "x" })],
    ["rota inexistente (404)", await pegar("/api/nao-existe")], ["erro de método (405)", await pegar("/api/reservas")]]) {
    await resp.arrayBuffer();
    checar(`E7  API ${nome}: mesmos headers`, resp.headers.get("content-security-policy") === "default-src 'none'; frame-ancestors 'none'" && resp.headers.get("cache-control") === "no-store" && !cabecalhosOk(resp), `${resp.status} ${cabecalhosOk(resp)}`);
  }
  const barra = await pegar("/passeios/");
  checar("E7  /passeios/ → 301 para /passeios (Location preservado)", barra.status === 301 && (barra.headers.get("location") || "").endsWith("/passeios") && !cabecalhosOk(barra), `${barra.status} ${barra.headers.get("location")} ${cabecalhosOk(barra)}`);
  const idx = await pegar("/index.html");
  checar("E7  /index.html → 308 para / (Location preservado)", idx.status === 308 && /\/$/.test(idx.headers.get("location") || ""), `${idx.status} ${idx.headers.get("location")}`);
  const head = await fetch(BASE + "/", { method: "HEAD", redirect: "manual" });
  checar("E7  HEAD / → 200 com os mesmos headers", head.status === 200 && !cabecalhosOk(head), `${head.status} ${cabecalhosOk(head)}`);
  const cond = await fetch(BASE + "/estilo.css?v=20261020-s06", { redirect: "manual" });
  const etag = cond.headers.get("etag"); await cond.arrayBuffer();
  if (etag) { const r304 = await fetch(BASE + "/estilo.css?v=20261020-s06", { headers: { "if-none-match": etag }, redirect: "manual" }); await r304.arrayBuffer();
    checar("E7  requisição condicional (304) mantém os headers", r304.status === 304 && !cabecalhosOk(r304), `${r304.status} ${cabecalhosOk(r304)}`); }
}


// ---------- ETAPA 9 — horário do Trindade Boat (encontro 08:30, saída 08:50) ----------
{
  const rotas = ["/", "/passeios", "/passeios/boat", "/contato", "/termos-do-passeio", "/reservar"];
  for (const c of rotas) {
    const doc = await (await pegar(c)).text();
    checar(`E9  ${c} não diz mais "saída única às 8h30/08:30"`, !/saída única às 0?8[h:]30/i.test(doc) && !/Saída única · 8h30/.test(doc), (doc.match(/.{30}saída única.{20}/i) || [""])[0]);
  }
  const boat = await (await pegar("/passeios/boat")).text();
  checar("E9  /passeios/boat: card e meta dizem encontro 8h30 ou 11h", boat.includes("encontro às 8h30 ou às 11h (saída 20 min depois)") && boat.includes("encontro às 8h30 ou 11h (saída 20 min depois), R$ 400"), "");
  checar("E9  /contato: Trindade Boat com encontro e saída", (await (await pegar("/contato")).text()).includes("encontro às 8h30 ou às 11h (saída 20 min depois)"));
  checar("E9  Termos §4: encontro às 8h30 ou às 11h", (await (await pegar("/termos-do-passeio")).text()).includes("O Trindade Boat tem encontro às 8h30 ou às 11h (saída 20 min depois)."));
  const app = await (await pegar("/app.js?v=20261020-s09")).text();
  checar("E9  app.js: rótulos do Boat com encontro e saída", app.includes('"Encontro às "') && app.includes("tem encontro às"), "");
  const worker = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  checar("E9  _worker.js: mesmo texto do client (Horário: … — saída …) e o cálculo (saidaApos) não mudou", worker.includes('"Horário: " + horaLabel(d.hora) + " — saída " + saidaLabel(d.hora, cfg)') && worker.includes("const t = Math.round(h * 60) + cfg.saidaApos;"), "");
}


// ---------- ETAPA 11 — Pescaria: uma URL só ----------
{
  for (const [caminho, esperado] of [["/passeios/fishing", "/pescaria"], ["/passeios/fishing/", "/pescaria"], ["/passeios/fishing?x=1", "/pescaria?x=1"], ["/passeios/fishing/?a=1&b=2", "/pescaria?a=1&b=2"]]) {
    const r = await pegar(caminho); await r.arrayBuffer();
    const loc = r.headers.get("location") || "";
    checar(`E11 ${caminho} → 301 para ${esperado} (um salto só, sem loop)`, r.status === 301 && new URL(loc, BASE).pathname + new URL(loc, BASE).search === esperado && !loc.includes("fishing"), `${r.status} ${loc}`);
  }
  const head = await fetch(BASE + "/passeios/fishing", { method: "HEAD", redirect: "manual" });
  checar("E11 HEAD /passeios/fishing → 301", head.status === 301, head.status);
  const p = await pegar("/pescaria"); const doc = await p.text();
  checar("E11 /pescaria → 200 com title/canonical próprios", p.status === 200 && /<link rel="canonical" href="[^"]*\/pescaria">/.test(doc) && /<title>[^<]*[Pp]escaria[^<]*<\/title>/.test(doc), `${p.status}`);
  const xml = await (await pegar("/sitemap.xml")).text();
  checar("E11 sitemap tem 17 URLs e nenhuma de fishing", (xml.match(/<loc>/g) || []).length === 17 && !xml.includes("fishing"), (xml.match(/<loc>/g) || []).length);
  checar("E11 site-config sem /passeios/fishing", !Object.keys(SITE.paginas).includes("/passeios/fishing"));
  const n404 = await pegar("/passeios/nao-existe"); await n404.arrayBuffer();
  checar("E11 outras rotas inalteradas: /passeios/nao-existe → 404", n404.status === 404, n404.status);
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  let achados = "";
  try { achados = execFileSync("git", ["-C", fileURLToPath(new URL("..", import.meta.url)), "grep", "-n", "passeios/fishing", "--", "site/index.html", "site/app.js", "site/_worker.js", "site/sitemap.xml", "site/404.html"], { encoding: "utf8" }); } catch (e) { achados = e.stdout || ""; }
  const linhas = achados.trim().split("\n").filter(Boolean);
  checar("E11 'passeios/fishing' só aparece na tabela de redirecionamentos (worker e app.js)", linhas.length === 2 && linhas.every(l => /^site\/(_worker|app)\.js:/.test(l)), achados.trim());
}


// ---------- ETAPA 12 — um <h1> por rota ----------
{
  const tabela = [];
  const rotas = [...new Set([...Object.keys(SITE.paginas), "/cameras"])];
  for (const c of rotas) {
    const doc = await (await pegar(c)).text();
    const h1s = [...doc.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    tabela.push([c, h1s.length, h1s[0]]);
    checar(`E12 ${c} tem exatamente 1 <h1>`, (doc.match(/<h1/g) || []).length === 1 && h1s.length === 1, JSON.stringify(h1s));
  }
  console.log("      URL → texto do <h1>:"); for (const [c, n, t] of tabela) console.log(`        ${c.padEnd(28)} ${t}`);
  const h = Object.fromEntries(tabela.map(([c, , t]) => [c, t]));
  checar("E12 /passeios/boat tem o h1 do Boat (não \"Roteiros e preços\")", h["/passeios/boat"] === "Trindade Boat", h["/passeios/boat"]);
  checar("E12 /passeios/essencial e /adventure idem", h["/passeios/essencial"] === "Trindade Essencial" && h["/passeios/adventure"] === "Trindade Adventure");
  checar("E12 /passeios/mamangua, /saco-bravo e /juatinga com o nome do passeio", h["/passeios/mamangua"] === "Mamanguá Adventure" && h["/passeios/saco-bravo"] === "Saco Bravo Adventure" && h["/passeios/juatinga"] === "Costa da Juatinga", JSON.stringify([h["/passeios/mamangua"], h["/passeios/saco-bravo"], h["/passeios/juatinga"]]));
  checar("E12 /passeios continua \"Roteiros e preços\" e / traz o h1 do hero", h["/passeios"] === "Roteiros e preços" && /^Passeios/.test(h["/"]) && !/parapente/i.test(h["/"]) && /Trindade/.test(h["/"]), `${h["/passeios"]} | ${h["/"]}`);
  const nf = await pegar("/nao-existe"); const dnf = await nf.text();
  checar("E12 /nao-existe → 404 com único h1 \"Página não encontrada\"", nf.status === 404 && (dnf.match(/<h1/g) || []).length === 1 && />Página não encontrada<\/h1>/.test(dnf), nf.status);
  const boat = await (await pegar("/passeios/boat")).text();
  checar("E12 /passeios/boat: título da seção virou h2 e conserva classes e ids", /<h2 data-titulo>Roteiros e preços<\/h2>/.test(boat) && /<h2 data-titulo id="titulo-pescaria">Pescaria em Alto Mar<\/h2>/.test(boat) && /<h1 data-titulo-foco>Trindade Boat<\/h1>/.test(boat), "");
}


// ---------- ETAPA 13 — seção ativa já no HTML do servidor ----------
{
  const rotas = [...new Set([...Object.keys(SITE.paginas), "/cameras", "/nao-existe"])];
  const tabela = [];
  for (const c of rotas) {
    const r = await pegar(c); const doc = await r.text();
    const secoes = [...doc.matchAll(/<section\b[^>]*\bdata-secao="([^"]+)"[^>]*>/g)].map(m => ({ nome: m[1], oculta: /\shidden(\s|=|>)/.test(m[0]) }));
    const visiveis = secoes.filter(s => !s.oculta).map(s => s.nome);
    const esperada = c === "/nao-existe" ? "nao-encontrada" : SITE.paginas[c].secao;
    tabela.push([c, visiveis.join(",")]);
    checar(`E13 ${c} → exatamente 1 seção visível, a da rota (${esperada})`, secoes.length === 13 && visiveis.length === 1 && visiveis[0] === esperada, JSON.stringify(visiveis));
  }
  for (const plano of ["essencial", "adventure", "boat"]) {
    const doc = await (await pegar("/passeios/" + plano)).text();
    const abas = Object.fromEntries([...doc.matchAll(/<button[^>]*\bdata-aba="([^"]+)"[^>]*>/g)].map(m => [m[1], { sel: /aria-selected="true"/.test(m[0]), tabindex: (m[0].match(/tabindex="(-?\d+)"/) || [])[1] }]));
    const paineis = Object.fromEntries([...doc.matchAll(/<div class="painel-roteiro" id="roteiro-([a-z]+)"[^>]*>/g)].map(m => [m[1], /\shidden(\s|=|>)/.test(m[0])]));
    const certo = Object.keys(abas).every(k => abas[k].sel === (k === plano) && (k === plano ? abas[k].tabindex === undefined : abas[k].tabindex === "-1")) && Object.keys(paineis).every(k => paineis[k] === (k !== plano));
    checar(`E13 /passeios/${plano} → aba e painel do ${plano} abertos no HTML, os outros fechados`, certo, JSON.stringify({ abas, paineis }));
  }
  const geral = await (await pegar("/passeios")).text();
  checar("E13 /passeios (sem plano) mantém a aba Essencial aberta", /id="roteiro-essencial"[^>]*>/.test(geral) && !/id="roteiro-essencial"[^>]*\shidden/.test(geral) && /id="roteiro-boat"[^>]*\shidden/.test(geral));
  const nf = await (await pegar("/nao-existe")).text();
  checar("E13 a seção \"não encontrada\" só aparece na resposta 404", /id="nao-encontrada"[^>]*data-secao="nao-encontrada">/.test(nf) && !/id="nao-encontrada"[^>]*hidden/.test(nf) && /id="nao-encontrada"[^>]*\shidden/.test(await (await pegar("/")).text()));
}


// ---------- ETAPA 14 — recompressão das imagens ----------
{
  const { readdirSync, statSync } = await import("node:fs");
  const dirAssets = new URL("../site/assets/", import.meta.url);
  const pesadas = readdirSync(dirAssets).filter(n => n.endsWith(".webp") && statSync(new URL(n, dirAssets)).size > 150 * 1024);
  // 3 exceções antigas: fotos de folhagem densa que só chegam abaixo de 150 KB com qualidade < 50 (blocos visíveis).
  // + as 3 fotos do Mamanguá (24/10/2026, Wikimedia Commons, 1600 px de largura): mantidas na resolução e
  // qualidade da fonte, sem recompressão agressiva, para não degradar fotos de terceiros creditadas.
  const excecoes = [
    "lugar-trilha-720.webp", "pousada-madeira-2-720.webp", "trilha-v2-1024.webp",
    "mamangua-vista-pico-1600.webp", "mamangua-barco-1600.webp", "mamangua-pao-de-acucar-1600.webp"
  ];
  checar("E14 nenhum WebP acima de 150 KiB além das exceções justificadas (folhagem densa, q50; fotos do Mamanguá, 1600px)", pesadas.every(n => excecoes.includes(n)), pesadas.join(", "));
  const dims = { "lugar-trilha-720.webp": [720, 960], "pousada-madeira-1-720.webp": [720, 704], "pousada-madeira-2-720.webp": [720, 880], "pousada-madeira-4-720.webp": [720, 918], "trilha-v2-1024.webp": [1024, 768], "trilha-v2-800.webp": [800, 600] };
  for (const [n, [w, h]] of Object.entries(dims)) {
    const b = readFileSync(new URL(n, dirAssets)); // WebP VP8: largura/altura nos bytes 26-29
    const lw = (b[26] | (b[27] << 8)) & 0x3fff, lh = (b[28] | (b[29] << 8)) & 0x3fff;
    checar(`E14 ${n} mantém ${w}×${h}`, lw === w && lh === h, `${lw}×${lh}`);
  }
  const fontes = ["index.html", "app.js", "estilo.css", "motion.js", "pescaria-galeria.js", "manifest.json"].map(f => readFileSync(new URL("../site/" + f, import.meta.url), "utf8")).join("\n");
  const caminhos = [...new Set([...fontes.matchAll(/\/(?:assets|vendor)\/[A-Za-z0-9_.\-]+\.[A-Za-z0-9]+/g)].map(m => m[0]))];
  const quebrados = [];
  for (const c of caminhos) { const r = await pegar(c); await r.arrayBuffer(); if (r.status !== 200) quebrados.push(`${c} → ${r.status}`); }
  checar(`E14 todos os ${caminhos.length} caminhos /assets e /vendor citados no HTML, JS e CSS respondem 200`, !quebrados.length, quebrados.join("; "));
}

// ---------- ETAPA 15 — preload do hero só onde o hero aparece; montagens por rota ----------
{
  const preloads = doc => (doc.match(/rel="preload" as="image"/g) || []).length;
  checar("E15 / mantém o preload da foto da abertura (≥ 1)", preloads(await (await pegar("/")).text()) >= 1);
  for (const c of ["/historia", "/termos-do-passeio", "/passeios", "/passeios/boat", "/reservar", "/contato", "/pousadas", "/pescaria", "/nao-existe"]) {
    const r = await pegar(c); const doc = await r.text();
    checar(`E15 ${c} não faz preload da foto da abertura`, preloads(doc) === 0, preloads(doc));
  }
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const iniciar = app.slice(app.indexOf("function iniciar()"));
  checar("E15 iniciar(): mapa, reserva e câmeras não rodam mais direto na carga (só via montar/montarOsDemais)",
    !/^\s*(prepararMapa|ligarReserva|desenharCameras|ligarRelogios)\(\);/m.test(iniciar) && /montarOsDemais\(\)/.test(iniciar) && /montar\(nome\)/.test(app));
  const html = await (await pegar("/")).text();
  checar("E15 index.html aponta app.js e motion.js para o ?v= da etapa", /\/app\.js\?v=[\w.-]+/.test(html) && html.includes("/motion.js?v=20261020-s15"));
}


// ---------- FOTOS enviadas pela equipe na seção "Cinco praias e três cachoeiras" ----------
{
  const home = await (await pegar("/")).text();
  const grade = home.slice(home.indexOf('class="lugares-fotos"'), home.indexOf('<ul class="lugares">'));
  const imgs = [...grade.matchAll(/<img [^>]*>/g)].map(m => m[0]);
  checar("FOTOS a grade tem as 4 fotos antigas + 8 novas + 2 do Lucas com o nome do lugar (14)", imgs.length === 14, imgs.length);
  const novas = imgs.filter(i => /lugar-(vista-baia|pedras-agua|banco-areia|riacho-mata|amanhecer-pedras|enseada-palmeira|banco-areia-veleiro|baia-ilhas)-480/.test(i));
  checar("FOTOS as 8 novas estão na grade", novas.length === 8, novas.length);
  const lugares = ["Praia do Meio", "Cachadaço", "Mamanguá", "Juatinga", "Saco Bravo", "Praia Brava", "Cepilho", "Ranchos", "Pedra que Engole", "Codós", "Paraty", "Trindade", "Hymbé", "Sono", "Antigos", "Pão de Açúcar"];
  for (const i of novas) {
    const alt = (i.match(/alt="([^"]*)"/) || [])[1] || "";
    const nome = (i.match(/lugar-[a-z-]+-480/) || [""])[0].replace("-480", "");
    const src480 = (i.match(/src="([^"]+)"/) || [])[1], w = Number((i.match(/ width="(\d+)"/) || [])[1]), h = Number((i.match(/ height="(\d+)"/) || [])[1]);
    const b = readFileSync(new URL("../site" + src480.replace("-480", "-720"), import.meta.url)); // WebP VP8: largura/altura nos bytes 26-29
    const lw = (b[26] | (b[27] << 8)) & 0x3fff, lh = (b[28] | (b[29] << 8)) & 0x3fff;
    checar(`FOTOS ${nome}: alt descritivo, sem citar nome de praia/lugar (sem atribuir a local específico)`, alt.length >= 25 && !lugares.some(l => alt.toLowerCase().includes(l.toLowerCase())), alt);
    checar(`FOTOS ${nome}: width/height do HTML = dimensões reais da imagem de 720 (${w}×${h})`, lw === w && lh === h, lw + "×" + lh);
    checar(`FOTOS ${nome}: carregamento lazy, decoding async e classe de foco`, i.includes('loading="lazy"') && i.includes('decoding="async"') && /class="foco-(60|65|70|75)"/.test(i));
  }
}


// ---------- FOTOS do Lucas (26/10/2026): cada foto traz o nome do lugar escrito e só entra onde o lugar já aparece ----------
{
  const doc = await (await pegar("/")).text();
  const fotos = [
    // [arquivo do src, maior arquivo do srcset, trecho que precisa conter o <img>, lugar que o alt cita]
    ["capa-mirante-baia-800", "capa-mirante-baia-1200", 'class="hero-foto"', "baía de Trindade"],
    // Galhetas: recortadas sem o texto gravado ("Galeta", grafia diferente da do site)
    ["foto-praia-galhetas-recorte-480", "foto-praia-galhetas-recorte-720", 'id="mais-procurados"', "Praia das Galhetas"],
    ["foto-piscina-galhetas-recorte-410", "foto-piscina-galhetas-recorte-410", 'id="roteiro-boat"', "Piscina natural das Galhetas"],
    ["foto-cachoeira-saco-bravo-720", "foto-cachoeira-saco-bravo-720", 'id="consulta-saco-bravo"', "Cachoeira do Saco Bravo"],
    ["lugar-praia-brava-rio-480", "lugar-praia-brava-rio-720", 'class="lugares-fotos"', "Praia Brava"],
    ["lugar-praia-meio-480", "lugar-praia-meio-960", 'class="lugares-fotos"', "Praia do Meio"]
  ];
  for (const [src, maior, bloco, lugar] of fotos) {
    const i = doc.indexOf(`src="/assets/${src}.webp"`), b = doc.lastIndexOf(bloco, i);
    const tag = i < 0 ? "" : doc.slice(doc.lastIndexOf("<img", i), doc.indexOf(">", i) + 1);
    checar(`FOTOS-LUCAS ${src}: no lugar certo (${bloco})`, i > 0 && b > 0 && i - b < 6000, `${i} ${b}`);
    const alt = (tag.match(/alt="([^"]*)"/) || [])[1] || "";
    checar(`FOTOS-LUCAS ${src}: alt cita ${lugar}`, alt.includes(lugar), alt);
    const w = Number((tag.match(/ width="(\d+)"/) || [])[1]), h = Number((tag.match(/ height="(\d+)"/) || [])[1]);
    const arq = readFileSync(new URL(`../site/assets/${maior}.webp`, import.meta.url)); // WebP VP8: largura/altura nos bytes 26-29
    const lw = (arq[26] | (arq[27] << 8)) & 0x3fff, lh = (arq[28] | (arq[29] << 8)) & 0x3fff;
    checar(`FOTOS-LUCAS ${src}: width/height do HTML = ${maior} (${w}×${h})`, lw === w && lh === h, lw + "×" + lh);
    if (src.startsWith("capa-")) checar(`FOTOS-LUCAS ${src}: capa sem lazy`, !tag.includes('loading="lazy"') && tag.includes('fetchpriority="high"'));
    else checar(`FOTOS-LUCAS ${src}: loading lazy e decoding async`, tag.includes('loading="lazy"') && tag.includes('decoding="async"'));
  }
  // fotos com o nome escrito em grafia diferente da do site ficam fora (Galeta, Caixadaço)
  for (const fora of ["foto-praia-galhetas-480", "foto-praia-galhetas-640", "foto-piscina-galhetas-720", "lugar-piscina-cachadaco"])
    checar(`FOTOS-LUCAS ${fora} não é usada (texto gravado com grafia diferente)`, !doc.includes(`/assets/${fora}`));
  checar("FOTOS-LUCAS og:image continua og-v2.jpg (capa nova só no hero)", doc.includes('<meta property="og:image" content="https://trindadeadventury.com.br/assets/og-v2.jpg">'));
}


// ---------- ETAPA 24 — higiene: sem comentários de arquitetura no HTML servido; código do fallback com sufixo aleatório ----------
{
  const rotas = ["/", "/passeios", "/passeios/boat", "/reservar", "/pousadas", "/pescaria", "/contato", "/historia", "/termos-do-passeio", "/politica-de-privacidade", "/cameras", "/nao-existe"];
  for (const c of rotas) {
    const doc = await (await pegar(c)).text();
    checar(`E24 ${c}: nenhum comentário HTML no que o visitante recebe, e nada de D1, /api/eventos, _worker.js ou LEIA-ME`, !doc.includes("<!--") && !["D1", "api/eventos", "_worker.js", "LEIA-ME"].some(x => doc.includes(x)), (doc.match(/<!--/g) || []).length + " comentários");
  }
  const fonte = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  checar("E24 o código-fonte do index.html mantém as notas (a remoção é só na saída do worker)", (fonte.match(/<!--/g) || []).length > 10);
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const trecho = app.slice(app.indexOf("function codigoReserva()"), app.indexOf("function mensagemWhatsApp"));
  checar("E24 codigoReserva (fallback): dia/hora/minuto + 4 caracteres de crypto.getRandomValues", trecho.includes("crypto.getRandomValues") && trecho.includes('"TA-" + base + "-"'));
  // Executa a função de verdade: 200 códigos no mesmo instante, todos no formato e todos diferentes
  const fn = new Function("doisDig", "window", "crypto", trecho + "; return codigoReserva;");
  const gerar = fn(n => String(n).padStart(2, "0"), { crypto: globalThis.crypto }, globalThis.crypto);
  const codigos = Array.from({ length: 200 }, () => gerar());
  checar("E24 200 códigos gerados juntos casam /^TA-[A-Z0-9-]{4,32}$/ e não se repetem", codigos.every(c => /^TA-[A-Z0-9-]{4,32}$/.test(c)) && new Set(codigos).size === 200, codigos.slice(0, 3).join(","));
}


// ---------- ETAPA 23 — nada do Access no cliente; painel fechado sem JWT ----------
{
  const arquivos = ["index.html", "app.js", "boot.js", "motion.js", "pescaria-galeria.js"].map(f => readFileSync(new URL("../site/" + f, import.meta.url), "utf8")).join("\n");
  checar("E23 index.html/app.js e demais JS públicos sem ACCESS_AUD nem cloudflareaccess", !/ACCESS_AUD|cloudflareaccess/i.test(arquivos));
  const servido = await (await pegar("/app.js")).text() + await (await pegar("/")).text();
  checar("E23 o servido ao visitante também não cita ACCESS_AUD/cloudflareaccess", !/ACCESS_AUD|cloudflareaccess/i.test(servido));
  const a = await pegar("/admin"); await a.arrayBuffer();
  const b = await pegar("/api/admin/reservas"); await b.arrayBuffer();
  checar("E23 /admin e /api/admin/reservas sem JWT → 403", a.status === 403 && b.status === 403, `${a.status}/${b.status}`);
  const adm = readFileSync(new URL("../site/admin.html", import.meta.url), "utf8");
  checar("E23 admin.html sem AUD, chave ou e-mails embutidos", !/ACCESS_AUD|cloudflareaccess|ADMIN_KEY|X-Admin-Key/i.test(adm));
}


// ---------- ETAPA 22 — domínio oficial, e-mails, SEO do <head>, JSON-LD por rota ----------
{
  const OFICIAL = "https://trindadeadventury.com.br";
  const ANTIGO = "trindade-adventure" + ".pages.dev"; // montado por concatenação para este arquivo não aparecer no rg do domínio antigo
  const locs = [...(await (await pegar("/sitemap.xml")).text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
  checar("E22 sitemap: 17 <loc>, todos começam com o domínio oficial", locs.length === 17 && locs.every(l => l.startsWith(OFICIAL + "/") || l === OFICIAL + "/"), locs.filter(l => !l.startsWith(OFICIAL)).join(","));
  const robots = await (await pegar("/robots.txt")).text();
  checar("E22 robots.txt: Sitemap oficial e Disallow /admin e /api/", robots.includes(`Sitemap: ${OFICIAL}/sitemap.xml`) && /Disallow: \/admin/.test(robots) && /Disallow: \/api\//.test(robots) && !robots.includes(ANTIGO));
  const dimJpg = rel => { const b = readFileSync(new URL("../site" + rel, import.meta.url)); let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } return null; };
  const tabela = [];
  for (const loc of locs) {
    const caminho = new URL(loc).pathname;
    const doc = await (await pegar(caminho)).text();
    const get = re => (doc.match(re) || [])[1];
    const titulo = get(/<title>([^<]*)<\/title>/), desc = get(/<meta name="description" content="([^"]*)"/);
    const canon = get(/<link rel="canonical" href="([^"]*)"/), ogUrl = get(/<meta property="og:url" content="([^"]*)"/), ogImg = get(/<meta property="og:image" content="([^"]*)"/);
    const w = Number(get(/<meta property="og:image:width" content="(\d+)"/)), h = Number(get(/<meta property="og:image:height" content="(\d+)"/));
    checar(`E22 ${caminho}: canonical = og:url = ${OFICIAL}${caminho}; og:image no domínio oficial`, canon === OFICIAL + caminho && ogUrl === canon && ogImg.startsWith(OFICIAL + "/assets/"), `${canon} ${ogUrl} ${ogImg}`);
    checar(`E22 ${caminho}: sem o domínio antigo no HTML servido`, !doc.includes(ANTIGO));
    checar(`E22 ${caminho}: title ≤ 60 (${titulo.length}) e description ≤ 160 (${desc.length})`, titulo.length <= 60 && desc.length <= 160, `${titulo.length}/${desc.length}`);
    const dim = ogImg.endsWith(".jpg") ? dimJpg(new URL(ogImg).pathname) : null;
    checar(`E22 ${caminho}: og:image:width/height = dimensões reais do arquivo (${w}×${h})`, !!dim && dim[0] === w && dim[1] === h, JSON.stringify(dim));
    const tipos = [];
    for (const bloco of doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let j; try { j = JSON.parse(bloco[1]); } catch (e) { checar(`E22 ${caminho}: JSON-LD é JSON válido`, false, e.message); continue; }
      tipos.push(j["@type"]);
      if (j["@type"] === "TravelAgency") checar(`E22 ${caminho}: TravelAgency com url, @id, e-mail, sameAs e image no domínio oficial`, j.url === OFICIAL + "/" && j["@id"] === OFICIAL + "/#empresa" && j.email === "contato@trindadeadventury.com.br" && j.image.startsWith(OFICIAL + "/") && JSON.stringify(j.sameAs) === JSON.stringify(["https://www.instagram.com/trindadeadventure/"]) && j.makesOffer.every(o => o.url.startsWith(OFICIAL + "/")), JSON.stringify(j).slice(0, 160));
      if (j["@type"] === "TouristTrip") {
        // Essencial/Adventure/Boat vêm de PLANOS (com agenda); o voo de parapente vem de
        // OFERTAS_SO_WHATSAPP (sem agenda) — por isso não diz "por pessoa" na página.
        const PRECOS = { "/passeios/essencial": ["70", " por pessoa"], "/passeios/adventure": ["150", " por pessoa"], "/passeios/boat": ["400", " por pessoa"], "/voo-de-parapente": ["350", ""] };
        const [preco, unidade] = PRECOS[caminho] || [undefined, ""];
        checar(`E22 ${caminho}: TouristTrip com Offer (preço ${preco} BRL, InStock) igual ao da página`, j.offers && j.offers.price === preco && j.offers.priceCurrency === "BRL" && j.offers.availability === "https://schema.org/InStock" && j.offers.url === OFICIAL + caminho && j.provider["@id"] === OFICIAL + "/#empresa" && doc.includes("R$ " + preco + unidade), JSON.stringify(j.offers));
      }
      if (j["@type"] === "BreadcrumbList") checar(`E22 ${caminho}: BreadcrumbList começa em Início e termina na própria rota`, j.itemListElement[0].item === OFICIAL + "/" && j.itemListElement.at(-1).item === OFICIAL + caminho && j.itemListElement.every((x, i) => x.position === i + 1), JSON.stringify(j.itemListElement));
    }
    if (caminho === "/pescaria" || caminho === "/passeios/mamangua") checar(`E22 ${caminho}: sem TouristTrip/Offer próprio (sem unidade de preço / sob consulta)`, !tipos.includes("TouristTrip"), tipos.join());
    checar(`E22 ${caminho}: ${caminho === "/" ? "só o TravelAgency" : "BreadcrumbList presente"}`, caminho === "/" ? tipos.join() === "TravelAgency" : tipos.includes("BreadcrumbList"), tipos.join());
    tabela.push(`${caminho.padEnd(26)} ${String(titulo.length).padStart(2)} ${String(desc.length).padStart(3)} ${w}x${h} ${tipos.join("+")}`);
  }
  console.log("\n  rota                        title desc  og:image  @types\n  " + tabela.join("\n  ") + "\n");
  const nf = await (await pegar("/nao-existe")).text();
  checar("E22 /nao-existe: sem BreadcrumbList nem TouristTrip, sem canonical", !/BreadcrumbList|TouristTrip/.test(nf) && !/rel="canonical"/.test(nf));
  const contato = await (await pegar("/contato")).text(), home = await (await pegar("/")).text(), priv = await (await pegar("/politica-de-privacidade")).text(), termos = await (await pegar("/termos-do-passeio")).text();
  checar("E22 mailto:contato@ no /contato e no rodapé", contato.includes('href="mailto:contato@trindadeadventury.com.br"') && home.includes('<li><a href="mailto:contato@trindadeadventury.com.br">contato@trindadeadventury.com.br</a></li>'));
  checar("E22 mailto:suporte@ na Privacidade e nos Termos §12", priv.includes('href="mailto:suporte@trindadeadventury.com.br"') && termos.includes('href="mailto:suporte@trindadeadventury.com.br"'));
  checar("E22 o placeholder do e-mail do cliente continua voce@email.com", home.includes('placeholder="voce@email.com"'));
  const app = await (await pegar("/app.js?v=20261020-s22")).text();
  checar("E22 app.js sem domínio antigo e com og:image:width/height na navegação", !app.includes(ANTIGO) && app.includes('og:image:width') && app.includes("imagensDim"));
  // Sem política de redirect ativa no ambiente local: localhost nunca redireciona
  const r = await pegar("/passeios?x=1"); await r.arrayBuffer();
  checar("E22 localhost nunca redireciona (200), mesmo com a variável ligada ou não", r.status === 200, r.status);
}


// ---------- ETAPA 21 — Instagram oficial, até 15 pessoas por reserva, sinal Pix de 30% ----------
{
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const VELHO = "trindadeadventure" + "rj"; // conta que não é do Lucas; montada por concatenação para este arquivo não a citar
  const temVelho = txt => txt.toLowerCase().includes(VELHO);
  const PARCEIROS = ["hymberestaurantepraia", "pousadahymbetrindade", "demadeiratrindade"];
  let achados = "";
  try { achados = execFileSync("git", ["-C", raiz, "grep", "-n", "-i", VELHO], { encoding: "utf8" }); } catch (e) { achados = e.stdout || ""; }
  checar("E21 nenhum arquivo versionado cita a conta antiga do Instagram (git grep vazio)", achados.trim() === "", achados.trim().slice(0, 200));
  const SOCIAL = "https://www.instagram.com/trindadeadventure/";
  const rotas21 = ["/", "/contato", "/reservar", "/passeios", "/pousadas", "/pescaria", "/historia", "/termos-do-passeio", "/politica-de-privacidade", "/cameras", "/nao-existe"];
  for (const c of rotas21) {
    const doc = await (await pegar(c)).text();
    const hrefs = [...doc.matchAll(/href="([^"]*instagram\.com[^"]*)"/g)].map(m => m[1]);
    const proprios = hrefs.filter(h => !PARCEIROS.some(p => h.endsWith("/" + p)));
    checar(`E21 ${c}: sem a conta antiga e todo link do Instagram da empresa é ${SOCIAL} (parceiros intactos)`, !temVelho(doc) && proprios.length > 0 && proprios.every(h => h === SOCIAL) && PARCEIROS.every(p => doc.includes("instagram.com/" + p)), hrefs.join(" | "));
    for (const bloco of doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const j = JSON.parse(bloco[1]);
      if (j.sameAs) checar(`E21 ${c}: JSON-LD sameAs = [${SOCIAL}]`, JSON.stringify(j.sameAs) === JSON.stringify([SOCIAL]), JSON.stringify(j.sameAs));
      if (j.description) checar(`E21 ${c}: JSON-LD fala de até 15 pessoas por reserva`, /até 15 pessoas por reserva/.test(j.description) && !/20 pessoas/.test(j.description), j.description);
    }
  }
  const app = await (await pegar("/app.js?v=20261020-s21")).text();
  checar("E21 app.js: CFG.instagram = trindadeadventure e sem a conta antiga", /instagram: "trindadeadventure"/.test(app) && !temVelho(app));
  const worker = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  checar("E21 _worker.js: padrão de instagram é trindadeadventure", worker.includes('c.instagram || "trindadeadventure"'));
  const fonteTexto = ["index.html", "app.js", "_worker.js"].map(f => readFileSync(new URL("../site/" + f, import.meta.url), "utf8")).join("\n");
  checar("E21 nenhum '20 pessoas'/'até 20'/'pessoas por horário' nos textos", !/20 pessoas|até 20|máximo · 20|maximo 20|pessoas por horário/i.test(fonteTexto));
  checar("E21 seletor de pessoas: Math.min(limitePaxPedido, capacidade) e limitePaxPedido = 15", /Math\.min\(CFG\.limitePaxPedido, CFG\.capacidade\)/.test(app) && /limitePaxPedido: 15/.test(app) && /const LIMITE_PAX_PEDIDO = 15/.test(worker));
  const home = await (await pegar("/")).text(), reservar = await (await pegar("/reservar")).text(), contato = await (await pegar("/contato")).text(), termos = await (await pegar("/termos-do-passeio")).text();
  // Home nova (24/10/2026): os 4 números do hero (Passeios/Pessoas/Saídas/A partir de) saíram do
  // hero — a informação de "até 15 pessoas" continua em /contato, Termos e no resumo de /reservar.
  checar("E21 /contato: 'Grupo máximo · 15 pessoas por reserva'", contato.includes("<dt>Grupo máximo</dt><dd>15 pessoas por reserva</dd>"));
  checar("E21 /reservar: texto do topo sem cadastro nem pagamento online", reservar.includes("sem cadastro e sem pagamento online"));
  checar("E21 /reservar: resumo mostra 'Até 15 pessoas por reserva' por padrão", reservar.includes("Até 15 pessoas por reserva."));
  checar("E21 app.js: resumo monta 'sinal de 30% via Pix' e a garantia de cancelamento", app.includes("sinal de 30% via Pix") && app.includes("Cancelamento gratuito até 12 h antes da saída"));
  checar("E21 FAQ 'Como pago?' com o sinal de 30%", reservar.includes("Para confirmar a reserva, a equipe pede pelo WhatsApp um sinal de 30% do valor via Pix. Não há pagamento pelo site."));
  checar("E21 Termos §2 e §3 com o sinal de 30% e até 15 pessoas", termos.includes("A vaga só fica garantida depois do pagamento do sinal de 30% via Pix e da confirmação da equipe pelo WhatsApp. Cada reserva tem até 15 pessoas.") &&
    termos.includes("Para confirmar a reserva, é pago um sinal de 30% do valor via Pix, combinado pelo WhatsApp. Não há pagamento pelo site."));
  checar("E21 nenhum texto antigo de pagamento no local/Pix combinado", !/no local, em dinheiro ou cartão, ou por pix|pagamento no local ou por pix/i.test(fonteTexto));
  checar("E21 nada sobre o restante (70%) nem devolução do sinal (sem decisão)", !/70%|restante do valor|os outros 70/i.test(termos + reservar) && !/(sinal)[^.]{0,60}(devol|crédito)/i.test(termos + reservar));
  checar("E21 Boat: ninguém voltou a dizer 'saída única às 8h30'", !/saída única às 0?8[h:]30/i.test(fonteTexto));
  checar("E21 rodapé: 'Passeios sob consulta' aponta para /passeios#sob-consulta", home.includes('<a href="/passeios#sob-consulta">Passeios sob consulta</a>') && !home.includes('<a href="/mamangua"') );
  const pass = await (await pegar("/passeios")).text();
  checar("E21 /passeios tem a seção id=sob-consulta", /<section class="bloco" id="sob-consulta"/.test(pass));
  checar("E21 app.js: navegação SPA mantém o #fragmento e rola até a âncora", app.includes("navegar(normalizarCaminho(url.pathname) + url.search + url.hash)") && app.includes("alvo = ancora"));
  for (const c of ["/", "/contato", "/termos-do-passeio", "/reservar"]) checar(`E21 ${c}: sem marcador TODO/PREENCHER`, !/\bTODO\b|PREENCHER/.test(await (await pegar(c)).text()));
}


// ---------- ETAPA 19 — dados da empresa no rodapé, sem JavaScript ----------
// Cadastur retirado em 24/10/2026 (negocio.cadastur = "" — era igual ao CNPJ, por engano; a busca
// pública mostra uma empresa homônima com outro CNPJ). Campo vazio não aparece: só razão social e CNPJ.
{
  const esperado = "64.565.826 IGOR SANTIAGO FRAGA · CNPJ 64.565.826/0001-80";
  for (const c of ["/", "/passeios/boat", "/pescaria", "/nao-existe", "/reservar", "/termos-do-passeio"]) {
    const doc = await (await pegar(c)).text();
    const m = doc.match(/<p class="rodape-legal" id="dadosEmpresa"([^>]*)>([^<]*)<\/p>/);
    checar(`E19 ${c}: #dadosEmpresa com razão social e CNPJ, sem Cadastur, sem hidden`, !!m && !/\bhidden\b/.test(m[1]) && m[2] === esperado, m ? m[1] + "|" + m[2] : "sem parágrafo");
    checar(`E19 ${c}: nenhum "Cadastur" na página`, !/Cadastur/.test(doc), c);
    // Marcadores de pendência (TODO em maiúsculas, PREENCHER): "todo/todos" em português é texto normal e não conta.
    checar(`E19 ${c}: nenhum marcador TODO/PREENCHER no HTML`, !/\bTODO\b|PREENCHER/.test(doc));
  }
  const appjs = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  checar("E19 app.js não duplica nem apaga o parágrafo quando o servidor já o preencheu", appjs.includes("if (!alvo || alvo.textContent.trim()) return;"));
  checar("E19 site-config: razaoSocial e cnpj preenchidos, cadastur vazio", SITE.negocio.razaoSocial === "64.565.826 IGOR SANTIAGO FRAGA" && SITE.negocio.cnpj === "64.565.826/0001-80" && SITE.negocio.cadastur === "");
  const todas = ["/", ...[...(await (await pegar("/sitemap.xml")).text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => new URL(m[1]).pathname)].filter((u, i, a) => a.indexOf(u) === i);
  let sujas = [];
  for (const u of todas) { const d = await (await pegar(u)).text(); if (/\bTODO\b|PREENCHER/.test(d)) sujas.push(u); }
  checar(`E19 as ${todas.length} URLs do sitemap sem marcador TODO/PREENCHER`, todas.length === 17 && !sujas.length, sujas.join(","));
}


// ---------- ETAPA 16 — nada inline incompatível com CSP: /boot.js, fonte sem onload, sem style= ----------
{
  const rotas = ["/", "/passeios", "/passeios/boat", "/reservar", "/contato", "/pousadas", "/pescaria", "/cameras", "/historia", "/termos-do-passeio", "/politica-de-privacidade", "/nao-existe"];
  for (const c of rotas) {
    const doc = await (await pegar(c)).text();
    const tags = [...doc.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
    const inline = tags.filter(t => !/\ssrc=/.test(t) && !/type="application\/(json|ld\+json)"/.test(t));
    checar(`E16 ${c}: nenhum <script> inline executável`, inline.length === 0, inline.join(" "));
    checar(`E16 ${c}: sem onload=/onclick=/onerror= e sem style="`, !/\son(load|click|error)=/i.test(doc) && !/\sstyle="/i.test(doc), (doc.match(/\s(onload|onclick|onerror|style)="[^"]{0,40}/i) || [""])[0]);
  }
  const home = await (await pegar("/")).text();
  checar("E16 / carrega /boot.js?v= sem defer/async, antes do CSS", /<script src="\/boot\.js\?v=[^"]+"><\/script>/.test(home) && home.indexOf("/boot.js?v=") < home.indexOf('/estilo.css?v='));
  checar("E16 / mantém o preload da fonte como <link rel=preload as=style> (ativado pelo boot.js)", /<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Archivo[^"]*">/.test(home));
  const boot = await pegar("/boot.js?v=20261020-s16"); const bootJs = await boot.text();
  checar("E16 /boot.js responde 200 como JavaScript com tema, movimento e ativação da fonte", boot.status === 200 && /javascript/.test(boot.headers.get("content-type") || "") &&
    bootJs.includes("trindade.tema") && bootJs.includes("trindade.motion") && bootJs.includes("data-motion") && bootJs.includes("l.rel = 'stylesheet'"), boot.status);
  const app = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  checar("E16 app.js: nenhum style= em template (valores dinâmicos pelo CSSOM)", !/style="/.test(app) && app.includes('style.setProperty("--capacity-ratio"') && app.includes("el.style.background = el.dataset.cor"));
  const css = readFileSync(new URL("../site/estilo.css", import.meta.url), "utf8");
  checar("E16 estilo.css tem as classes que substituíram os style= (sprite-oculto, foco-62, sem-mapa)", css.includes(".sprite-oculto{position:absolute}") && css.includes(".tour-media img.foco-62{object-position:50% 62%}") && css.includes(".mapa-nota.sem-mapa{margin:0 0 14px}"));
}

// ---------- ETAPA 18 — CSP em Report-Only (só HTML) ----------
{
  const esperada = ["default-src 'self'", "script-src 'self' https://challenges.cloudflare.com", "style-src 'self' https://fonts.googleapis.com", "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https://tile.openstreetmap.org", "connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com",
    "frame-src https://challenges.cloudflare.com", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "report-uri /api/csp-report", "report-to csp"].join("; ");
  for (const [c, status] of [["/", 200], ["/passeios/boat", 200], ["/nao-existe", 404], ["/reservar", 200], ["/pescaria", 200]]) {
    const r = await pegar(c); await r.arrayBuffer(); const h = r.headers;
    checar(`E18 ${c} → ${status} com Content-Security-Policy-Report-Only igual à política definida`, r.status === status && h.get("content-security-policy-report-only") === esperada, h.get("content-security-policy-report-only"));
    checar(`E18 ${c}: Reporting-Endpoints, X-Frame-Options, HSTS sem preload, nenhum ACAO, e nada em enforce`,
      h.get("reporting-endpoints") === 'csp="/api/csp-report"' && h.get("x-frame-options") === "SAMEORIGIN" && h.get("strict-transport-security") === "max-age=31536000; includeSubDomains" &&
      ![...h.keys()].some(k => k.startsWith("access-control-")) && !h.has("content-security-policy"), JSON.stringify([...h]));
  }
  const head = await fetch(BASE + "/passeios/boat", { method: "HEAD", redirect: "manual" });
  checar("E18 HEAD /passeios/boat também leva a CSP Report-Only", head.headers.get("content-security-policy-report-only") === esperada);
  checar("E18 a política tem tile.openstreetmap.org sem curinga e nenhum unsafe-* em lugar nenhum", esperada.includes("https://tile.openstreetmap.org") && !esperada.includes("*.tile") && !/unsafe-/.test(esperada));
  checar("E18 script-src só com 'self' e o Turnstile (sem inline/eval/hashes)", /script-src 'self' https:\/\/challenges\.cloudflare\.com(;|$)/.test(esperada));
  for (const c of ["/app.js?v=20261020-s16", "/estilo.css?v=20261020-s16", "/assets/og-v2-800.webp", "/manifest.json", "/sitemap.xml", "/api/disponibilidade?data=2030-01-01", "/admin", "/passeios/"]) {
    const r = await pegar(c); await r.arrayBuffer();
    checar(`E18 ${c} (não é página do site) não leva a CSP do site`, !r.headers.has("content-security-policy-report-only") || r.headers.get("content-security-policy-report-only") === "" , r.headers.get("content-security-policy-report-only"));
  }
  const pg = readFileSync(new URL("../site/_worker.js", import.meta.url), "utf8");
  checar("E18 _worker.js: CSP_SITE não contém unsafe-inline/unsafe-eval/unsafe-hashes", !/unsafe-(inline|eval|hashes)/.test(pg.slice(pg.indexOf("const CSP_SITE"), pg.indexOf("function comHeadersSeguranca"))));
  checar("E18 o X-Frame-Options não foi removido do wrapper nem do _headers", pg.includes('"x-frame-options": "SAMEORIGIN"') && readFileSync(new URL("../site/_headers", import.meta.url), "utf8").includes("X-Frame-Options: SAMEORIGIN"));
}


// ---------- ETAPA 17 — cache longo só para JS/CSS com ?v= ----------
{
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { cpSync, mkdtempSync, rmSync, appendFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const amanha = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const home = await (await pegar("/")).text();
  const versoes = Object.fromEntries(["boot.js", "app.js", "motion.js", "pescaria-galeria.js", "estilo.css"].map(n => [n, (home.match(new RegExp("/" + n.replace(".", "\\.") + "\\?v=([A-Za-z0-9._-]+)")) || [])[1]]));
  for (const [nome, v] of Object.entries(versoes)) {
    const r = await pegar(`/${nome}?v=${v}`); await r.arrayBuffer();
    checar(`E17 /${nome}?v=${v} → 200 com "public, max-age=31536000, immutable"`, r.status === 200 && r.headers.get("cache-control") === "public, max-age=31536000, immutable", `${r.status} ${r.headers.get("cache-control")}`);
    const s = await pegar(`/${nome}`); await s.arrayBuffer();
    checar(`E17 /${nome} (sem ?v=) → não é immutable`, s.status === 200 && !/immutable/.test(s.headers.get("cache-control") || ""), s.headers.get("cache-control"));
    const ruim = await pegar(`/${nome}?v=${encodeURIComponent("x y<z>")}`); await ruim.arrayBuffer();
    checar(`E17 /${nome}?v= inválido → não é immutable`, !/immutable/.test(ruim.headers.get("cache-control") || ""), ruim.headers.get("cache-control"));
  }
  const vazio = await pegar("/app.js?v="); await vazio.arrayBuffer();
  checar("E17 /app.js?v= (vazio) → não é immutable", !/immutable/.test(vazio.headers.get("cache-control") || ""), vazio.headers.get("cache-control"));
  const naoVersionado = await pegar("/manifest.json?v=1"); await naoVersionado.arrayBuffer();
  checar("E17 outros arquivos com ?v= (manifest.json) mantêm o cache do _headers", naoVersionado.headers.get("cache-control") === "public, max-age=86400", naoVersionado.headers.get("cache-control"));
  const falso = await pegar("/arquivo-que-nao-existe.js?v=1"); await falso.arrayBuffer();
  checar("E17 arquivo inexistente com ?v= → 404 no-cache (nunca immutable)", falso.status === 404 && falso.headers.get("cache-control") === "no-cache", `${falso.status} ${falso.headers.get("cache-control")}`);
  const raizHtml = await pegar("/"); await raizHtml.arrayBuffer();
  checar("E17 HTML inalterado: / → max-age=0, must-revalidate", raizHtml.headers.get("cache-control") === "public, max-age=0, must-revalidate", raizHtml.headers.get("cache-control"));
  const dispo = await pegar("/api/disponibilidade?data=" + amanha); await dispo.arrayBuffer();
  checar("E17 API inalterada: no-store", dispo.headers.get("cache-control") === "no-store", dispo.headers.get("cache-control"));
  for (const c of ["/sitemap.xml", "/robots.txt"]) { const r = await pegar(c); await r.arrayBuffer(); checar(`E17 ${c} inalterado (max-age=3600)`, r.headers.get("cache-control") === "public, max-age=3600", r.headers.get("cache-control")); }
  const admin = await pegar("/admin"); await admin.arrayBuffer();
  checar("E17 /admin não ganhou cache longo", !/immutable|max-age=[1-9]/.test(admin.headers.get("cache-control") || ""), admin.headers.get("cache-control"));

  // Toda referência aos arquivos versionados tem ?v= (index.html e app.js). O _worker.js só guarda a LISTA de nomes
  // (VERSIONADOS), que não é uma referência para carregar o arquivo.
  const fontes = ["index.html", "app.js"].map(f => [f, readFileSync(new URL("../site/" + f, import.meta.url), "utf8")]);
  for (const [f, txt] of fontes) {
    const semV = [...txt.matchAll(/["'`(=]\/(app|motion|pescaria-galeria|boot)\.js(?!\?v=)|["'`(=]\/estilo\.css(?!\?v=)/g)].map(m => m[0]);
    checar(`E17 ${f}: toda referência a app/motion/pescaria-galeria/boot.js e estilo.css tem ?v=`, semV.length === 0, semV.join(" "));
  }

  // O script de checagem: passa no estado atual e FALHA se um byte do app.js muda sem o ?v= mudar (numa cópia; nada é alterado no repositório)
  const raizRepo = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(new URL("./check-versao.mjs", import.meta.url));
  const ok = spawnSync(process.execPath, [script], { encoding: "utf8" });
  checar("E17 check-versao.mjs passa no estado atual", ok.status === 0, ok.stdout + ok.stderr);
  const tmp = mkdtempSync(join(tmpdir(), "versao-"));
  try {
    cpSync(raizRepo + "site", tmp + "/site", { recursive: true, filter: s => !/[\\/]assets[\\/]/.test(s) });
    cpSync(raizRepo + "versoes.json", tmp + "/versoes.json");
    appendFileSync(tmp + "/site/app.js", " ");
    const mudou = spawnSync(process.execPath, [script, "--raiz", tmp], { encoding: "utf8" });
    checar("E17 check-versao.mjs sai com erro quando o app.js muda 1 byte sem trocar o ?v=", mudou.status === 1 && /app\.js: o conteúdo mudou mas o \?v= continua/.test(mudou.stderr), mudou.stdout + mudou.stderr);
    const idx = readFileSync(tmp + "/site/index.html", "utf8");
    writeFileSync(tmp + "/site/index.html", idx.replace(/\/app\.js\?v=[A-Za-z0-9._-]+/, "/app.js?v=teste-novo"));
    const trocou = spawnSync(process.execPath, [script, "--raiz", tmp], { encoding: "utf8" });
    checar("E17 com o ?v= trocado mas sem registrar, ainda pede --atualizar", trocou.status === 1 && /falta registrar/.test(trocou.stderr), trocou.stderr);
    const registrou = spawnSync(process.execPath, [script, "--raiz", tmp, "--atualizar"], { encoding: "utf8" });
    const depois = spawnSync(process.execPath, [script, "--raiz", tmp], { encoding: "utf8" });
    checar("E17 depois de trocar o ?v= e rodar --atualizar, volta a passar", registrou.status === 0 && depois.status === 0, registrou.stderr + depois.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const intacto = spawnSync(process.execPath, [script], { encoding: "utf8" });
  checar("E17 o repositório continua intacto depois da demonstração (check-versao passa)", intacto.status === 0, intacto.stderr);
}

// ---------- ETAPA 26 — home nova (24/10/2026): hero, cartões, sob consulta,
//            como funciona, FAQ, quem guia, CTA final, links — no lugar das categorias e do
//            catálogo duplicado "Sete passeios" ----------
{
  const { existsSync } = await import("node:fs");
  const r = await pegar("/");
  const doc = await r.text();
  checar("E26 / responde 200", r.status === 200, r.status);
  checar("E26 / tem exatamente 1 <h1>", (doc.match(/<h1/g) || []).length === 1);

  // Ordem das seções, do topo para baixo. fimHome fecha a fatia em "/inicio": a seção seguinte
  // (passeios) continua inteira no HTML, só com "hidden" — sem isso os testes abaixo (fotos
  // repetidas, style inline, marcador de pendência) pegariam as OUTRAS seções da página também.
  const idx = marcador => doc.indexOf(marcador);
  const pontos = {
    hero: idx('class="hero"'),
    cartoes: idx('id="mais-procurados"'),
    consulta: idx('id="titulo-sob-consulta-home"'),
    como: idx('id="titulo-como-funciona"'),
    faq: idx('id="titulo-faq-home"'),
    guia: idx('id="titulo-quem-guia"'),
    cta: idx('id="titulo-cta-final"'),
    links: idx('class="bloco links-home"'),
    fimHome: idx('<section class="secao" id="passeios"')
  };
  const ordemChecada = ["hero", "cartoes", "consulta", "como", "faq", "guia", "cta", "links", "fimHome"];
  const emOrdem = ordemChecada.every((k, i) => i === 0 || (pontos[ordemChecada[i - 1]] > -1 && pontos[k] > pontos[ordemChecada[i - 1]]));
  checar("E26 a home segue a ordem: hero, 3 cartões, sob consulta, como funciona, FAQ, quem guia, CTA final, links", emOrdem, JSON.stringify(pontos));
  const docHome = doc.slice(pontos.hero, pontos.fimHome);

  // Nada das seções antigas na HOME (categorias, catálogo "Sete passeios", "Um dia", "Cinco praias",
  // "Onde dormir"). "Cinco praias" mudou de página — é validado mais abaixo que ela existe em /historia.
  checar("E26 sem a seção de categorias nem o catálogo antigo na home", !docHome.includes('id="categorias"') && !docHome.includes("Sete passeios saindo de Trindade") && !docHome.includes("Ver os 7 passeios") && !docHome.includes('id="pousadasInicio"') && !docHome.includes('id="catalogoPasseios"') && !docHome.includes("Um dia no Trindade Adventure") && !docHome.includes("Cinco praias e três cachoeiras") && !docHome.includes("Onde dormir"));

  // 26/10/2026: a pedido do cliente, o parapente aparece na home só no menu (como antes da home nova):
  // sem capa, cartão, galeria "Voos de verdade" nem menção no texto da home. A página /voo-de-parapente
  // e o cartão em /passeios continuam (checados abaixo).
  // 3 cartões (Essencial, Adventure, Boat), nessa ordem, com Reservar + WhatsApp (Data/Pessoas).
  const fimCartoes = doc.indexOf("</section>", pontos.cartoes);
  const blocoCartoes = doc.slice(pontos.cartoes, fimCartoes);
  const titulosCartoes = [...blocoCartoes.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  checar("E26 3 cartões, na ordem Essencial, Adventure, Boat", titulosCartoes.join(",") === "Trindade Essencial,Trindade Adventure,Trindade Boat", titulosCartoes.join(","));
  checar("E26 Adventure com o selo \"Mais completo\"", /Trindade Adventure[\s\S]*?Mais completo|Mais completo[\s\S]{0,400}Trindade Adventure/.test(blocoCartoes));
  for (const [plano, preco] of [["essencial", "70"], ["adventure", "150"], ["boat", "400"]]) {
    checar(`E26 cartão ${plano}: Reservar → /reservar?plano=${plano} e preço R$ ${preco}`, blocoCartoes.includes(`href="/reservar?plano=${plano}"`) && blocoCartoes.includes(`R$ ${preco}`));
  }
  checar("E26 WhatsApp dos 3 cartões pede Data e Pessoas", (blocoCartoes.match(/data-wa="[^"]*Data: ___ · Pessoas: ___/g) || []).length === 3);
  checar("E26 garantia de 12h nos 3 cartões", (blocoCartoes.match(/Cancelamento gratuito até 12 h antes da saída/g) || []).length === 3);
  checar("E26 parapente fora do corpo da home (só no menu)", !/parapente/i.test(docHome) && !docHome.includes('id="titulo-prova"'), (docHome.match(/.{0,60}parapente.{0,60}/i) || [""])[0]);
  checar("E26 menu mantém o item Parapente", /<a href="\/voo-de-parapente" data-rota="parapente">Parapente<\/a>/.test(doc));

  // Sob consulta: 4 links para as páginas próprias.
  const fimConsulta = doc.indexOf("</section>", pontos.consulta);
  const blocoConsulta = doc.slice(pontos.consulta, fimConsulta);
  checar("E26 sob consulta: links para Mamanguá, Saco Bravo, Juatinga e Pescaria", ["/passeios/mamangua", "/passeios/saco-bravo", "/passeios/juatinga", "/pescaria"].every(h => blocoConsulta.includes(`href="${h}"`)));

  // Nenhuma foto repetida entre as seções da home (hero e cartões). Só o src= conta —
  // o srcset do mesmo <img> cita de novo o arquivo do próprio src= (outro tamanho), não é repetição.
  const todasFotos = [...docHome.matchAll(/\ssrc="(\/assets\/[A-Za-z0-9_.\-]+\.webp)"/g)].map(m => m[1]);
  const repetidas = todasFotos.filter((s, i) => todasFotos.indexOf(s) !== i);
  checar("E26 nenhuma foto repetida na home", repetidas.length === 0, [...new Set(repetidas)].join(", "));

  // Como funciona: 4 passos.
  const fimComo = doc.indexOf("</section>", pontos.como);
  const blocoComo = doc.slice(pontos.como, fimComo);
  checar("E26 como funciona: 4 passos (escolha, pedido, confirmação com sinal, encontro)", (blocoComo.match(/<li>/g) || []).length === 4 && blocoComo.includes("sinal de 30% via Pix") && blocoComo.includes("Praia do Meio"));

  // FAQ: textos iguais aos de /contato e dos Termos (chuva, crianças, cancelamento, o que levar).
  const contatoDoc = await (await pegar("/contato")).text();
  const termosDoc = await (await pegar("/termos-do-passeio")).text();
  const fimFaq = doc.indexOf("</section>", pontos.faq);
  const blocoFaq = doc.slice(pontos.faq, fimFaq);
  checar("E26 FAQ da home: chuva (texto igual ao de /contato)", blocoFaq.includes("Chuva fraca não cancela. Em chuva forte, mar grosso ou risco na trilha, a operação remarca sem custo.") && contatoDoc.includes("Chuva fraca não cancela. Em chuva forte, mar grosso ou risco na trilha, a operação remarca sem custo."));
  checar("E26 FAQ da home: crianças (texto igual ao de /contato)", blocoFaq.includes("Sim, a partir de 6 anos na trilha, sempre acompanhadas de um responsável.") && contatoDoc.includes("Sim, a partir de 6 anos na trilha, sempre acompanhadas de um responsável."));
  checar("E26 FAQ da home: cancelamento (texto igual ao dos Termos §8)", blocoFaq.includes("O cancelamento é gratuito até 12 horas antes da saída.") && termosDoc.includes("O cancelamento é gratuito até 12 horas antes da saída."));
  checar("E26 FAQ da home: o que levar (texto igual ao de \"Prepare a mochila\")", blocoFaq.includes("Calçado fechado com solado de borracha e protetor solar") && doc.includes("Calçado fechado com solado de borracha e protetor solar"));

  // Quem guia: só o que o site já diz (sem anos nem credencial inventada).
  const fimGuia = doc.indexOf("</section>", pontos.guia);
  const blocoGuia = doc.slice(pontos.guia, fimGuia);
  checar("E26 quem guia: guias locais — sem credencial nem anos inventados", blocoGuia.includes("quem realmente conhece e ama esse lugar") && !/\bABVL\b|\bCBVL\b|anos de experiência|certificad[oa]/i.test(blocoGuia));

  // CTA final: ponto de encontro, mapa, Reservar e WhatsApp.
  const fimCta = doc.indexOf("</section>", pontos.cta);
  const blocoCta = doc.slice(pontos.cta, fimCta);
  checar("E26 CTA final: Praia do Meio, link do mapa, Reservar e WhatsApp", blocoCta.includes("Praia do Meio") && /google\.com\/maps/.test(blocoCta) && blocoCta.includes('href="/reservar"') && /data-wa="[^"]*Data: ___/.test(blocoCta));

  // Links para as páginas próprias, no lugar das seções longas.
  const blocoLinks = doc.slice(pontos.links);
  checar("E26 links: Pousadas, Praias e lugares, História, Pescaria, Adventure", ["/pousadas", "/historia#titulo-lugares", "/historia", "/pescaria", "/passeios/adventure"].every(h => blocoLinks.includes(`href="${h}"`)));

  // "Cinco praias e três cachoeiras" foi para /historia, não apagado.
  const historiaDoc = await (await pegar("/historia")).text();
  checar("E26 \"Cinco praias e três cachoeiras\" mudou para /historia (não foi apagado)", historiaDoc.includes("Cinco praias e três cachoeiras") && historiaDoc.includes("Praia do Cepilho") && historiaDoc.includes('id="titulo-lugares"'));

  checar("E26 site-config: paginas agora com 18 entradas (creditos-das-fotos é novo)", Object.keys(SITE.paginas).length === 18, Object.keys(SITE.paginas).length);

  checar("E26 sem style= inline na home nova", !docHome.includes("style="));
  checar("E26 sem marcador de pendência na home nova", !/PREENCHER|TODO|\[[A-ZÇÃÕÉ ]{3,}\]/.test(docHome));

  // Hero: 2 CTAs (Reservar e WhatsApp), imagem sem loading=lazy e com fetchpriority=high.
  const blocoHero = doc.slice(pontos.hero, pontos.cartoes);
  checar("E26 hero: 2 CTAs (Reservar meu passeio e Tirar dúvida no WhatsApp)", blocoHero.includes(">Reservar meu passeio<") && blocoHero.includes("Tirar dúvida no WhatsApp"));
  // 26/10/2026: capa nova enviada pelo Lucas (baía de Trindade vista de um mirante). O og:image continua og-v2.jpg.
  checar("E26 hero: foto do mirante (capa-mirante-baia), sem loading=lazy, com fetchpriority=high", /<img[^>]*capa-mirante-baia-800\.webp[^>]*fetchpriority="high"/.test(blocoHero) && !/<img[^>]*capa-mirante-baia[^>]*loading="lazy"/.test(blocoHero) && !/parapente/i.test(blocoHero));
  checar("E26 preload da capa aponta para a mesma foto do hero (capa-mirante-baia)", /<link rel="preload" as="image" href="\/assets\/capa-mirante-baia-800\.webp" imagesrcset="[^"]*capa-mirante-baia-1200\.webp 1200w"/.test(doc));

  // Câmeras: fora do menu e do rodapé (a rota continua existindo).
  checar("E26 \"Câmeras\" saiu do menu e do rodapé (rota /cameras continua existindo)", !doc.includes('data-rota="cameras"') && !/<li><a href="\/cameras">/.test(doc) && SITE.paginas["/cameras"]);

  // Botão fixo de WhatsApp no celular.
  checar("E26 botão fixo de WhatsApp no HTML, com aria-label", /<a class="wa-flutuante"[^>]*aria-label="[^"]+"/.test(doc));
  const cssTxt = readFileSync(new URL("../site/estilo.css", import.meta.url), "utf8");
  checar("E26 CSS: botão de WhatsApp fixo só <= 760px e escondido em /reservar", /@media\(max-width:760px\)\{[\s\S]*?\.wa-flutuante\{/.test(cssTxt) && cssTxt.includes('html[data-rota-atual="reservar"] .wa-flutuante{display:none}'));

  // Barra de clima: altura máx. ~40px, uma linha, sem aviso/recomendação de chuva.
  checar("E26 CSS: #climaBar com min-height 40px (uma linha)", /#climaBar\{[^}]*min-height:40px/.test(cssTxt));
  const appjsTxt = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  checar("E26 app.js: barra de clima sem recomendação/aviso (só temperatura e mar)", !appjsTxt.includes("Mar grosso — barco provavelmente não sai") && !appjsTxt.includes("Chance alta de chuva"));

  // Mamanguá: fotos de terceiros com crédito, em /passeios (consulta-mamangua).
  const passeiosDoc = await (await pegar("/passeios")).text();
  checar("E26 Mamanguá em /passeios: 3 fotos do Wikimedia Commons com crédito", ["mamangua-vista-pico", "mamangua-barco", "mamangua-pao-de-acucar"].every(s => passeiosDoc.includes(s)) && passeiosDoc.includes("Wikimedia Commons") && passeiosDoc.includes("CC BY-SA 3.0"));

  // Parapente em /passeios: cartão com Reservar voo e Ver detalhes.
  checar("E26 parapente em /passeios: cartão com \"Reservar voo\" e \"Ver detalhes\"", passeiosDoc.includes(">Reservar voo<") && /href="\/voo-de-parapente">Ver detalhes</.test(passeiosDoc) && passeiosDoc.includes('href="/reservar?plano=parapente"'));

  checar("E26 /creditos-das-fotos → 200 com a tabela de créditos", (await pegar("/creditos-das-fotos")).status === 200);
}

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

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
      checar("T8  Boat mantém saída única 08:30", JSON.stringify(hp.boat) === "[8.5]", JSON.stringify(hp.boat));
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
  checar("E9  /passeios/boat: card e meta dizem encontro 8h30 e saída 8h50", boat.includes("encontro às 8h30, saída às 8h50") && boat.includes("encontro às 8h30 e saída às 8h50, R$ 400"), "");
  checar("E9  /contato: Trindade Boat com encontro e saída", (await (await pegar("/contato")).text()).includes("encontro às 08:30, saída às 08:50"));
  checar("E9  Termos §4: encontro às 8h30 e saída às 8h50", (await (await pegar("/termos-do-passeio")).text()).includes("O Trindade Boat tem encontro às 8h30 e saída às 8h50."));
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
  checar("E11 sitemap tem 15 URLs e nenhuma de fishing", (xml.match(/<loc>/g) || []).length === 15 && !xml.includes("fishing"), (xml.match(/<loc>/g) || []).length);
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
  checar("E12 /passeios continua \"Roteiros e preços\" e / traz o h1 do hero", h["/passeios"] === "Roteiros e preços" && /extraordinário/.test(h["/"]), `${h["/passeios"]} | ${h["/"]}`);
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
    checar(`E13 ${c} → exatamente 1 seção visível, a da rota (${esperada})`, secoes.length === 11 && visiveis.length === 1 && visiveis[0] === esperada, JSON.stringify(visiveis));
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
  // 3 exceções justificadas: fotos de folhagem densa que só chegam abaixo de 150 KB com qualidade < 50 (blocos visíveis)
  const excecoes = ["lugar-trilha-720.webp", "pousada-madeira-2-720.webp", "trilha-v2-1024.webp"];
  checar("E14 nenhum WebP acima de 150 KiB além das 3 exceções justificadas (folhagem densa, q50)", pesadas.every(n => excecoes.includes(n)), pesadas.join(", "));
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


// ---------- ETAPA 19 — dados da empresa no rodapé, sem JavaScript ----------
{
  const esperado = "64.565.826 IGOR SANTIAGO FRAGA · CNPJ 64.565.826/0001-80 · Cadastur 64.565.826/0001-80";
  for (const c of ["/", "/passeios/boat", "/pescaria", "/nao-existe", "/reservar", "/termos-do-passeio"]) {
    const doc = await (await pegar(c)).text();
    const m = doc.match(/<p class="rodape-legal" id="dadosEmpresa"([^>]*)>([^<]*)<\/p>/);
    checar(`E19 ${c}: #dadosEmpresa com razão social, CNPJ e Cadastur, sem hidden`, !!m && !/\bhidden\b/.test(m[1]) && m[2] === esperado, m ? m[1] + "|" + m[2] : "sem parágrafo");
    // Marcadores de pendência (TODO em maiúsculas, PREENCHER): "todo/todos" em português é texto normal e não conta.
    checar(`E19 ${c}: nenhum marcador TODO/PREENCHER no HTML`, !/\bTODO\b|PREENCHER/.test(doc));
  }
  const appjs = readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  checar("E19 app.js não duplica nem apaga o parágrafo quando o servidor já o preencheu", appjs.includes("if (!alvo || alvo.textContent.trim()) return;"));
  checar("E19 site-config: razaoSocial, cnpj e cadastur preenchidos", SITE.negocio.razaoSocial === "64.565.826 IGOR SANTIAGO FRAGA" && SITE.negocio.cnpj === "64.565.826/0001-80" && SITE.negocio.cadastur === "64.565.826/0001-80");
  const todas = ["/", ...[...(await (await pegar("/sitemap.xml")).text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => new URL(m[1]).pathname)].filter((u, i, a) => a.indexOf(u) === i);
  let sujas = [];
  for (const u of todas) { const d = await (await pegar(u)).text(); if (/\bTODO\b|PREENCHER/.test(d)) sujas.push(u); }
  checar(`E19 as ${todas.length} URLs do sitemap sem marcador TODO/PREENCHER`, todas.length === 15 && !sujas.length, sujas.join(","));
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

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

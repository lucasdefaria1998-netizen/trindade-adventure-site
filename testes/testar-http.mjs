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
  ["/app.js?v=20261005-rotas", "javascript", "max-age=86400"],
  ["/estilo.css?v=20261005-rotas", "text/css", "max-age=86400"],
  ["/motion.js?v=20261005-rotas", "javascript", "max-age=86400"],
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
      const pedir = corpo => pegar("/api/reservas", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ pax: 1, nome: "Teste Automatizado", telefone: "24999990000", origem: "direto", sessao: "teste", ...corpo }) });
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

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

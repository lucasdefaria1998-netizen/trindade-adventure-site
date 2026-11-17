// CSS crítico (auditoria 16/11, P1.2): as regras do estilo.css que pintam a primeira tela de cada rota vão
// inline no <head> (<style id="css-critico">); o estilo.css inteiro chega depois, sem bloquear o desenho.
//
// Como escolhe: abre cada rota num Chrome headless em várias larguras (celular → desktop, tema claro e escuro),
// junta os elementos da primeira tela (topo < altura da janela; um elemento escondido — [hidden], <dialog> fechado,
// display:none — conta, para a regra que o esconde entrar, mas nada dentro dele, de <template> ou <noscript>) e fica com toda regra do
// estilo.css cujo seletor casa com algum deles, na @media que vale naquela largura. Estados de interação
// (:hover, :focus, :active) ficam de fora; pseudo-elementos (::before, ::after) entram junto com o elemento.
// O texto das regras sai do próprio estilo.css (não do CSSOM do Chrome), então fallbacks e prefixos ficam.
// Entram também todas as @font-face e as @keyframes citadas pelas regras escolhidas. O resultado é um CSS por
// seção do site (inicio, passeios, reservar…), cada um só com o que as rotas daquela seção pintam primeiro.
//
// Rode com o site servido localmente (wrangler pages dev):
//   FERRAMENTAS=<pasta com puppeteer-core e esbuild> node scripts/css-critico.mjs http://127.0.0.1:8795
// Ele grava o CSS da "inicio" entre <style id="css-critico"> e </style> no site/index.html, o de todas as
// seções em CSS_CRITICO_ROTA no site/_worker.js e os hashes da CSP (scripts/hashes-csp.mjs). Mudou o
// estilo.css ou o HTML da primeira tela? Rode de novo — testar-http confere os hashes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { atualizarHashesCsp } from "./hashes-csp.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:8795";
const FERRAMENTAS = process.env.FERRAMENTAS;
if (!FERRAMENTAS) { console.error("defina FERRAMENTAS=<pasta com node_modules/puppeteer-core e esbuild>"); process.exit(2); }
const req = createRequire(FERRAMENTAS.replace(/\/$/, "") + "/package.json");
const puppeteer = req("puppeteer-core");
const esbuild = req("esbuild");

const raiz = new URL("..", import.meta.url);
const arqCss = fileURLToPath(new URL("site/estilo.css", raiz));
const arqHtml = fileURLToPath(new URL("site/index.html", raiz));
const arqWorker = fileURLToPath(new URL("site/_worker.js", raiz));

const ROTAS = ["/", "/passeios", "/passeios/essencial", "/passeios/adventure", "/passeios/boat", "/passeios/juatinga", "/reservar", "/contato",
  "/city-tour-paraty", "/pescaria", "/historia", "/cameras", "/termos-do-passeio", "/politica-de-privacidade", "/creditos-das-fotos", "/rota-que-nao-existe"];
const JANELAS = [[360, 740, true], [412, 823, true], [768, 1024, true], [1024, 768, false], [1350, 940, false], [1920, 1080, false]];

/* ---------- leitura do estilo.css: blocos com o texto original ---------- */
function semComentarios(t) { return t.replace(/\/\*[\s\S]*?\*\//g, ""); }
function blocos(t) {
  // devolve [{prelude, corpo}] do nível atual, respeitando chaves aninhadas e strings
  const out = []; let i = 0;
  while (i < t.length) {
    const ab = t.indexOf("{", i);
    if (ab < 0) break;
    const prelude = t.slice(i, ab).trim();
    let n = 1, j = ab + 1, aspas = null;
    for (; j < t.length && n; j++) {
      const c = t[j];
      if (aspas) { if (c === "\\") j++; else if (c === aspas) aspas = null; continue; }
      if (c === '"' || c === "'") aspas = c; else if (c === "{") n++; else if (c === "}") n--;
    }
    out.push({ prelude, corpo: t.slice(ab + 1, j - 1) });
    i = j;
  }
  return out;
}
function dividirSeletores(s) {
  const out = []; let n = 0, ini = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" || s[i] === "[") n++; else if (s[i] === ")" || s[i] === "]") n--;
    else if (s[i] === "," && !n) { out.push(s.slice(ini, i).trim()); ini = i + 1; }
  }
  out.push(s.slice(ini).trim());
  return out.filter(Boolean);
}
// árvore: {tipo:"regra", seletores, corpo, midias:[...]} | {tipo:"fonte"|"keyframes"|"outro", texto, nome}
function arvore(t, midias = []) {
  const itens = [];
  for (const b of blocos(t)) {
    const p = b.prelude.replace(/\s+/g, " ");
    if (/^@media\b/i.test(p)) itens.push(...arvore(b.corpo, [...midias, p.replace(/^@media\s*/i, "")]));
    else if (/^@supports\b/i.test(p)) itens.push(...arvore(b.corpo, [...midias, p]));
    else if (/^@font-face/i.test(p)) itens.push({ tipo: "fonte", texto: p + "{" + b.corpo + "}", midias });
    else if (/^@(-webkit-)?keyframes/i.test(p)) itens.push({ tipo: "keyframes", nome: p.split(/\s+/)[1], texto: p + "{" + b.corpo + "}", midias });
    else if (p.startsWith("@")) itens.push({ tipo: "outro", texto: p + "{" + b.corpo + "}", midias });
    else itens.push({ tipo: "regra", seletores: dividirSeletores(p), corpo: b.corpo.trim(), midias });
  }
  return itens;
}

const css = semComentarios(readFileSync(arqCss, "utf8"));
const itens = arvore(css);
const regras = itens.filter(x => x.tipo === "regra");
const ESTADO = /:(hover|focus|focus-visible|focus-within|active|visited)\b/;
const PSEUDO_EL = /::?(before|after|placeholder|marker|selection|backdrop|first-line|first-letter|-webkit-[a-z-]+|-moz-[a-z-]+)\b(\([^)]*\))?/g;
const candidatos = [...new Set(regras.flatMap(r => r.seletores))].filter(s => !ESTADO.test(s));
const testeDe = s => s.replace(PSEUDO_EL, "").trim() || "*";
const condicoes = [...new Set(regras.flatMap(r => r.midias))];

/* ---------- Chrome: quais seletores casam com a primeira tela, por largura ---------- */
const casouEm = new Map();     // seletor → lista das condições (@media/@supports) que valiam a cada vez que casou
// MEDICOES=<arquivo.json>: grava o que o Chrome mediu; com REUSAR=1, lê de lá sem abrir o Chrome (para ajustar o filtro).
const MEDICOES = process.env.MEDICOES;
const reusar = MEDICOES && process.env.REUSAR === "1" && existsSync(MEDICOES);
if (reusar) for (const [s, l] of JSON.parse(readFileSync(MEDICOES, "utf8"))) casouEm.set(s, l);
const navegador = reusar ? null : await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
if (navegador) try {
  for (const tema of ["claro", "escuro"]) {
    for (const [w, h, movel] of JANELAS) {
      if (tema === "escuro" && w !== 412 && w !== 1350) continue;
      const pg = await navegador.newPage();
      await pg.setViewport({ width: w, height: h, isMobile: movel, hasTouch: movel, deviceScaleFactor: 1 });
      if (tema === "escuro") await pg.evaluateOnNewDocument(() => { try { localStorage.setItem("trindade.tema", "dark"); } catch (e) {} });
      for (const rota of ROTAS) {
        await pg.goto(BASE + rota, { waitUntil: "load", timeout: 60000 });
        await new Promise(r => setTimeout(r, 900));
        const res = await pg.evaluate((cands, testes, conds) => {
          const vh = innerHeight;
          // O próprio elemento escondido ([hidden], <dialog> fechado, display:none) conta — a regra que o esconde
          // tem de estar no crítico —, mas o que está dentro dele, não: o conteúdo só aparece depois de uma ação.
          const pai = el => el.parentElement;
          const els = [...document.querySelectorAll("*")].filter(el => !el.closest("template, noscript")
            && !(pai(el) && (pai(el).closest("[hidden]") || !pai(el).checkVisibility()))
            && el.getBoundingClientRect().top < vh);
          const valeCond = {};
          for (const c of conds) valeCond[c] = c.startsWith("@supports") ? CSS.supports(c.replace(/^@supports\s*/i, "")) : matchMedia(c).matches;
          const sim = [];
          cands.forEach((s, i) => {
            let ok = false;
            try { ok = els.some(el => el.matches(testes[i])); } catch (e) { ok = false; }
            if (ok) sim.push(i);
          });
          return { sim, valeCond, secao: document.documentElement.dataset.rotaAtual || "" };
        }, candidatos, candidatos.map(testeDe), condicoes);
        for (const i of res.sim) {
          const s = candidatos[i];
          if (!casouEm.has(s)) casouEm.set(s, []);
          casouEm.get(s).push({ ...res.valeCond, "#rota": rota, "#secao": res.secao, "#janela": w, "#tema": tema });
        }
      }
      await pg.close();
      console.error(`ok: ${tema} ${w}×${h}`);
    }
  }
} finally { await navegador.close(); }
if (MEDICOES && !reusar) writeFileSync(MEDICOES, JSON.stringify([...casouEm]));

/* ---------- monta um CSS crítico por seção, na ordem original do estilo.css ----------
   Cada seção (inicio, passeios, reservar…) leva só as regras que pintam a primeira tela das rotas dela. O da
   "inicio" fica no index.html; o _worker.js troca o conteúdo do <style id="css-critico"> pelo da seção da
   rota (CSS_CRITICO_ROTA). Um bloco só por página, na ordem do estilo.css: a cascata fica igual à do arquivo. */
const secoes = [...new Set([...casouEm.values()].flat().map(v => v["#secao"]).filter(Boolean))].sort();
if (!secoes.includes("inicio")) throw new Error("nenhuma medição da seção inicio");
const partes = Object.fromEntries(secoes.map(s => [s, []]));
const anim = Object.fromEntries(secoes.map(s => [s, new Set()]));
const nomesAnim = corpo => [...corpo.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)].flatMap(m => m[1].split(/[\s,]+/));
for (const it of itens) {
  if (it.tipo === "fonte") { secoes.forEach(s => partes[s].push({ midias: it.midias, texto: it.texto })); continue; }
  if (it.tipo !== "regra") continue;
  for (const s of secoes) {
    const fica = it.seletores.filter(sel => (casouEm.get(sel) || []).some(vale => vale["#secao"] === s && it.midias.every(m => vale[m])));
    if (!fica.length) continue;
    partes[s].push({ midias: it.midias, texto: fica.join(",") + "{" + it.corpo + "}" });
    nomesAnim(it.corpo).forEach(n => anim[s].add(n));
  }
}
for (const it of itens) if (it.tipo === "keyframes") for (const s of secoes) if (anim[s].has(it.nome)) partes[s].push({ midias: it.midias, texto: it.texto });
async function minificar(lista) {
  const bruto = lista.map(p => p.midias.reduceRight((acc, m) => (m.startsWith("@supports") ? m : "@media " + m) + "{" + acc + "}", p.texto)).join("\n");
  const { code } = await esbuild.transform(bruto, { loader: "css", minify: true, target: ["chrome90", "safari14", "firefox90"] });
  const t = code.trim();
  if (t.includes("</style") || t.includes("<!--")) throw new Error("CSS crítico com sequência proibida dentro de <style>");
  return t;
}
const porSecao = {};
for (const s of secoes) porSecao[s] = await minificar(partes[s]);

let html = readFileSync(arqHtml, "utf8");
const re = /(<style id="css-critico">)[\s\S]*?(<\/style>)/;
if (!re.test(html)) throw new Error('index.html sem <style id="css-critico"></style>');
html = html.replace(re, (_, a, b) => a + porSecao.inicio + b);
writeFileSync(arqHtml, html);
let w = readFileSync(arqWorker, "utf8");
const reW = /^const CSS_CRITICO_ROTA = .*;$/m;
if (!reW.test(w)) throw new Error("_worker.js sem a linha const CSS_CRITICO_ROTA = …;");
w = w.replace(reW, () => "const CSS_CRITICO_ROTA = " + JSON.stringify(porSecao) + ";");
writeFileSync(arqWorker, w);
const h = atualizarHashesCsp();
const kb = t => (Buffer.byteLength(t) / 1024).toFixed(1) + " KB";
console.log(`CSS crítico por seção: ${Object.entries(porSecao).map(([s, t]) => s + " " + kb(t)).join(", ")} (estilo.css: ${kb(readFileSync(arqCss, "utf8"))}). ${h}`);

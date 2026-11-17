// Fotos do site em tamanho de exibição (auditoria 16/11, P1.4).
// Para cada família de foto do index.html (nome-<largura>.webp), parte do maior arquivo original de
// site/assets e grava ao lado, em site/assets/otim/, as variações 480/640/960/1280 (até a largura do original,
// que também entra) em WebP qualidade 72. Os originais não são tocados. Depois reescreve no index.html:
//   - srcset / imagesrcset de <img>, <source> e <link rel=preload> com as variações novas;
//   - src / href com a variação mais próxima (igual ou maior) da largura que estava;
//   - sizes de cada <img> a partir das larguras medidas por scripts/medir-imagens.mjs (sem medida: mantém).
// Uso: FERRAMENTAS=<pasta com node_modules do sharp> node scripts/imagens-variantes.mjs medidas.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire((process.env.FERRAMENTAS || process.cwd()) + "/node_modules/");
const sharp = require("sharp");
const raiz = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = raiz + "site/assets/", OTIM = ASSETS + "otim/", ARQ_HTML = raiz + "site/index.html";
const PADRAO = [480, 640, 960, 1280], QUALIDADE = 72;
const { larguras: TELAS, medidas } = JSON.parse(readFileSync(process.argv[2], "utf8"));
let html = readFileSync(ARQ_HTML, "utf8");
mkdirSync(OTIM, { recursive: true });

// ---------- famílias usadas nos srcset ----------
const RE_CAND = /\/assets\/(?:otim\/)?([a-z0-9-]+?)-(\d{3,4})\.webp/g;
const familias = new Set();
for (const m of html.matchAll(/\b(?:srcset|imagesrcset)="([^"]*)"/g)) for (const c of m[1].matchAll(RE_CAND)) familias.add(c[1]);

const originais = readdirSync(ASSETS);
const kb = b => Math.round(b / 1024);
const relatorio = [];
const variantes = {}; // família → [largura…]
for (const fam of [...familias].sort()) {
  const doFam = originais.map(n => n.match(new RegExp(`^${fam}-(\\d{3,4})\\.webp$`))).filter(Boolean).map(m => +m[1]).sort((a, b) => a - b);
  if (!doFam.length) throw new Error("sem original para " + fam);
  const maior = doFam[doFam.length - 1], origem = `${ASSETS}${fam}-${maior}.webp`;
  const meta = await sharp(origem).metadata();
  const alvo = [...PADRAO.filter(w => w * 1.1 < meta.width), meta.width];
  variantes[fam] = alvo;
  for (const w of alvo) {
    const destino = `${OTIM}${fam}-${w}.webp`;
    if (!existsSync(destino)) {
      const novo = await sharp(origem).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALIDADE, effort: 6, smartSubsample: true }).toBuffer();
      const mesmo = `${ASSETS}${fam}-${w}.webp`; // original da mesma largura menor que o novo? fica o original
      if (existsSync(mesmo) && statSync(mesmo).size <= novo.length) copyFileSync(mesmo, destino); else writeFileSync(destino, novo);
    }
  }
  relatorio.push({ fam, originais: doFam.map(w => `${w}:${kb(statSync(`${ASSETS}${fam}-${w}.webp`).size)}K`).join(" "), novas: alvo.map(w => `${w}:${kb(statSync(`${OTIM}${fam}-${w}.webp`).size)}K`).join(" ") });
}

// ---------- sizes a partir das medidas ----------
const desesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function sizesDe(m) {
  const d = TELAS.map(t => m[t] || 0);
  if (d.every(x => !x)) return null;
  // tela sem a foto (0): usa a vizinha, para o pedaço não sair com 0
  for (let i = 0; i < d.length; i++) if (!d[i]) d[i] = d.slice(i + 1).find(Boolean) || d.slice(0, i).reverse().find(Boolean);
  const partes = [];
  for (let i = 0; i < TELAS.length; i++) {
    const a = i ? i - 1 : 0, b = i;
    const fixo = Math.abs(d[a] - d[b]) <= 2;
    const valor = fixo ? `${Math.max(d[a], d[b])}px` : `${Math.ceil(Math.max(d[a] / TELAS[a], d[b] / TELAS[b]) * 100)}vw`;
    partes.push([TELAS[i], valor]);
  }
  const ultimo = d[d.length - 1];
  const fim = Math.abs(d[d.length - 1] - d[d.length - 2]) <= 2 ? `${ultimo}px` : `${Math.ceil(ultimo / TELAS[TELAS.length - 1] * 100)}vw`;
  const juntas = [];
  for (const [t, v] of partes) { if (juntas.length && juntas[juntas.length - 1][1] === v) juntas[juntas.length - 1][0] = t; else juntas.push([t, v]); }
  if (juntas.length && juntas[juntas.length - 1][1] === fim) juntas.pop();
  return [...juntas.map(([t, v]) => `(max-width: ${t}px) ${v}`), fim].join(", ");
}

// ---------- reescreve o index.html ----------
const novoSrcset = lista => {
  const fams = [...new Set([...lista.matchAll(RE_CAND)].map(c => c[1]))];
  if (fams.length !== 1) return lista;
  return variantes[fams[0]].map(w => `/assets/otim/${fams[0]}-${w}.webp ${w}w`).join(", ");
};
const novoArquivo = (fam, w) => { const v = variantes[fam]; return `/assets/otim/${fam}-${v.find(x => x >= +w) || v[v.length - 1]}.webp`; };
const vistos = {};
let comMedida = 0, semMedida = [];
html = html.replace(/<(img|source|link)\b[^>]*>/g, tag => {
  const srcset = (tag.match(/\b(?:srcset|imagesrcset)="([^"]*)"/) || [])[1];
  if (!srcset || !RE_CAND.test(srcset)) return tag;
  RE_CAND.lastIndex = 0;
  let t = tag;
  if (tag.startsWith("<img")) {
    const base = desesc(srcset) + "|" + desesc((tag.match(/\balt="([^"]*)"/) || [, ""])[1]);
    const n = vistos[base] = (vistos[base] || 0) + 1;
    const m = medidas[base + "|" + n];
    const s = m && sizesDe(m);
    if (s) { t = t.replace(/\bsizes="[^"]*"/, `sizes="${s}"`); comMedida++; } else semMedida.push(srcset.slice(0, 60));
  }
  t = t.replace(/\b(srcset|imagesrcset)="([^"]*)"/, (_, a, v) => `${a}="${novoSrcset(v)}"`);
  t = t.replace(/\b(src|href)="\/assets\/(?:otim\/)?([a-z0-9-]+?)-(\d{3,4})\.webp"/, (x, a, fam, w) => (variantes[fam] ? `${a}="${novoArquivo(fam, w)}"` : x));
  return t;
});
writeFileSync(ARQ_HTML, html);
console.log(JSON.stringify({ familias: relatorio.length, imgsComSizesMedido: comMedida, semMedida }, null, 1));
for (const r of relatorio) console.log(`${r.fam}\n  antes: ${r.originais}\n  novas: ${r.novas}`);

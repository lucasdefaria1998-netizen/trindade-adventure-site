// Hashes da CSP para os blocos inline das páginas (auditoria 16/11, P1.2):
//   <style id="css-critico">  → style-src  'sha256-…' (um por seção: o _worker.js troca o conteúdo pelo
//                               CSS_CRITICO_ROTA da seção da rota; o do index.html é o da "inicio")
//   <script id="boot-inline"> → script-src 'sha256-…'
// Sem 'unsafe-inline': só esses textos exatos rodam/aplicam. Mudou um deles? Rode
//   node scripts/hashes-csp.mjs
// e o _worker.js (CSP_HASH_ESTILO / CSP_HASH_SCRIPT) é atualizado. testar-http confere que batem.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const raiz = new URL("..", import.meta.url);
const arqHtml = fileURLToPath(new URL("site/index.html", raiz));
const arqWorker = fileURLToPath(new URL("site/_worker.js", raiz));

export const hashCsp = texto => "'sha256-" + createHash("sha256").update(texto, "utf8").digest("base64") + "'";

export function blocosInline(html) {
  const estilo = (html.match(/<style id="css-critico">([\s\S]*?)<\/style>/) || [])[1];
  const script = (html.match(/<script id="boot-inline">([\s\S]*?)<\/script>/) || [])[1];
  if (estilo === undefined || script === undefined) throw new Error("index.html sem <style id=\"css-critico\"> ou <script id=\"boot-inline\">");
  return { estilo, script };
}

export function cssPorSecao(worker) {
  const m = worker.match(/^const CSS_CRITICO_ROTA = (.*);$/m);
  if (!m) throw new Error("_worker.js sem a linha const CSS_CRITICO_ROTA = …;");
  return JSON.parse(m[1]);
}

export function atualizarHashesCsp() {
  const { estilo, script } = blocosInline(readFileSync(arqHtml, "utf8"));
  let w = readFileSync(arqWorker, "utf8");
  const porSecao = cssPorSecao(w);
  if (Object.keys(porSecao).length && porSecao.inicio !== estilo) throw new Error("o css-critico do index.html difere do CSS_CRITICO_ROTA.inicio — rode scripts/css-critico.mjs");
  const he = [...new Set([estilo, ...Object.values(porSecao)].map(hashCsp))].join(" "), hs = hashCsp(script);
  const antes = w;
  w = w.replace(/^const CSP_HASH_ESTILO = "[^"]*";$/m, `const CSP_HASH_ESTILO = "${he}";`)
       .replace(/^const CSP_HASH_SCRIPT = "[^"]*";$/m, `const CSP_HASH_SCRIPT = "${hs}";`);
  if (!w.includes(he) || !w.includes(hs)) throw new Error("_worker.js sem as linhas const CSP_HASH_ESTILO / CSP_HASH_SCRIPT");
  if (w !== antes) writeFileSync(arqWorker, w);
  return `hashes: ${he.split(" ").length} de estilo, script ${hs}${w !== antes ? " (worker atualizado)" : " (worker já estava certo)"}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(atualizarHashesCsp());

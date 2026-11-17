// Resume os JSON do lh.sh: mediana de cada métrica nas rodadas por rota e lado, mais os critérios do prompt.
// Saída: uma linha JSON por rota/lado e, no fim, a tabela em Markdown. Com --copiar <dir>, copia a rodada de nota
// mediana de cada rota para <dir>/antes|depois/<rota>.json (é o que vai para audit/ no repositório).
import { readFileSync, readdirSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
const DIR = args[0];
const ci = args.indexOf("--copiar"); const COPIAR = ci >= 0 ? args[ci + 1] : null;
const rotas = [["home", "/"], ["passeios-essencial", "/passeios/essencial"], ["reservar", "/reservar"], ["contato", "/contato"]];
const med = v => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const res = {};
for (const lado of ["antes", "depois"]) for (const [r] of rotas) {
  const runs = readdirSync(`${DIR}/${lado}`).filter(f => f.startsWith(r + "-") && /-\d\.json$/.test(f))
    .map(f => ({ f, j: JSON.parse(readFileSync(`${DIR}/${lado}/${f}`, "utf8")) }));
  const m = k => med(runs.map(x => x.j.audits[k].numericValue));
  const porNota = [...runs].sort((a, b) => a.j.categories.performance.score - b.j.categories.performance.score);
  const rep = porNota[porNota.length >> 1];
  const a = rep.j.audits;
  const doc = (a["network-requests"].details.items || []).find(i => i.resourceType === "Document") || {};
  const rbTodas = [...new Set(runs.flatMap(x => (x.j.audits["render-blocking-resources"]?.details?.items || []).map(i => i.url.replace(/^https?:\/\/[^/]+/, ""))))];
  const imgMax = k => Math.max(...runs.map(x => Math.round((x.j.audits[k]?.details?.overallSavingsBytes || 0) / 1024)));
  const lazy = runs.some(x => x.j.audits["lcp-lazy-loaded"] && x.j.audits["lcp-lazy-loaded"].score === 0);
  const a11yF = `${DIR}/${lado}/a11y-${r}.json`;
  res[`${lado}|${r}`] = {
    runs: runs.length,
    notas: runs.map(x => Math.round(x.j.categories.performance.score * 100)).join("/"),
    perf: Math.round(med(runs.map(x => x.j.categories.performance.score * 100))),
    lcp: m("largest-contentful-paint") / 1000, fcp: m("first-contentful-paint") / 1000,
    tbt: Math.round(m("total-blocking-time")), cls: m("cumulative-layout-shift"),
    lcpTodas: runs.map(x => (x.j.audits["largest-contentful-paint"].numericValue / 1000).toFixed(2)).join("/"),
    htmlKiB: (doc.resourceSize || 0) / 1024, htmlTransfKiB: (doc.transferSize || 0) / 1024, dom: a["dom-size"]?.numericValue,
    lcpEl: (a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.selector || "?"),
    lcpLazyEmAlgumaRodada: lazy,
    renderBlocking: rbTodas.join(", ") || "nenhum",
    imagensKiBmax: { tamanho: imgMax("uses-responsive-images"), formato: imgMax("modern-image-formats"), compressao: imgMax("uses-optimized-images") },
    a11y: existsSync(a11yF) ? Math.round(JSON.parse(readFileSync(a11yF, "utf8")).categories.accessibility.score * 100) : "?",
    arquivo: rep.f,
  };
  if (COPIAR) { mkdirSync(`${COPIAR}/${lado}`, { recursive: true }); copyFileSync(`${DIR}/${lado}/${rep.f}`, `${COPIAR}/${lado}/${r}.json`);
    if (existsSync(a11yF)) copyFileSync(a11yF, `${COPIAR}/${lado}/acessibilidade-${r}.json`); }
}
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
const f = (x, d = 1) => x.toFixed(d).replace(".", ",");
console.log("\n| Rota | Perf | LCP | TBT | CLS | HTML |\n|---|---|---|---|---|---|");
for (const [r, url] of rotas) {
  const A = res[`antes|${r}`], D = res[`depois|${r}`];
  console.log(`| ${url} | ${A.perf} → ${D.perf} | ${f(A.lcp, 2)} → ${f(D.lcp, 2)} s | ${A.tbt} → ${D.tbt} ms | ${f(A.cls, 3)} → ${f(D.cls, 3)} | ${f(A.htmlKiB)} → ${f(D.htmlKiB)} KiB |`);
}

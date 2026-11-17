// Mede a largura real (px CSS) com que cada <img srcset> do site aparece, em várias larguras de tela e em
// todas as páginas do site-config (auditoria 16/11, P1.4). O resultado alimenta scripts/imagens-variantes.mjs,
// que escreve o sizes de cada foto a partir dele. Precisa do site local rodando (wrangler pages dev).
//   FERRAMENTAS=<pasta com node_modules do puppeteer-core> node scripts/medir-imagens.mjs http://127.0.0.1:8795 > medidas.json
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const require = createRequire((process.env.FERRAMENTAS || process.cwd()) + "/node_modules/");
const puppeteer = require("puppeteer-core");
const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const SITE = JSON.parse(html.match(/<script type="application\/json" id="site-config">([\s\S]*?)<\/script>/)[1]);
export const LARGURAS = [360, 412, 540, 640, 760, 900, 1024, 1200, 1350, 1600, 1920];

const rotas = Object.keys(SITE.paginas);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const medidas = {}; // chave (srcset|alt|n) → { largura da tela: maior largura exibida }
const pg = await browser.newPage();
// as fotos carregam de verdade: imagem abortada vira "quebrada" e muda o layout (o slide da galeria
// deixa de ser quadrado e a largura sai inflada)
for (const rota of rotas) {
  for (const w of LARGURAS) {
    await pg.setViewport({ width: w, height: 900, isMobile: w < 760, hasTouch: w < 760, deviceScaleFactor: 1 });
    // espera o estilo.css (carrega sem bloquear): antes dele só vale o CSS crítico e o layout ainda não é o final
    await pg.goto(BASE + rota, { waitUntil: "load" });
    await pg.waitForFunction(() => [...document.styleSheets].some(s => (s.href || "").includes("/estilo.css")), { timeout: 15000 });
    await pg.evaluate(() => new Promise(r => setTimeout(r, 300)));
    const lista = await pg.evaluate(() => {
      const vistos = {};
      return [...document.querySelectorAll("img[srcset]")].map(img => {
        const base = img.getAttribute("srcset") + "|" + (img.getAttribute("alt") || "");
        const n = vistos[base] = (vistos[base] || 0) + 1;
        return [base + "|" + n, Math.round(img.getBoundingClientRect().width)];
      });
    });
    for (const [chave, largura] of lista) {
      const m = medidas[chave] = medidas[chave] || {};
      m[w] = Math.max(m[w] || 0, largura);
    }
  }
  console.error("medido:", rota);
}
await browser.close();
console.log(JSON.stringify({ larguras: LARGURAS, rotas, medidas }, null, 1));

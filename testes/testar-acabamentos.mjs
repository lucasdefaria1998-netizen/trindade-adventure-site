// Auditoria 16/11 (P1.3): no navegador, o motion.js fica fora da carga (a galeria da pescaria saiu com a página em 17/11, #24).
//
//   FERRAMENTAS=<pasta com node_modules/puppeteer-core> node testes/testar-acabamentos.mjs http://127.0.0.1:8795
//
// Confere num Chrome headless (celular, 412×823):
//   - com prefers-reduced-motion, o motion.js nunca é pedido, nem com rolagem ou clique; o botão diz que o
//     sistema reduziu o movimento e o topo ainda muda ao rolar (is-scrolled, que ficou no app.js);
//   - sem a preferência, o motion.js não é pedido antes do evento load e chega na primeira interação;
//   - o botão "Pausar animações" funciona antes do motion.js chegar e a escolha vale depois que ele chega.
import { createRequire } from "node:module";

const BASE = process.argv[2] || "http://127.0.0.1:8795";
const FERRAMENTAS = process.env.FERRAMENTAS;
if (!FERRAMENTAS) { console.error("defina FERRAMENTAS=<pasta com node_modules/puppeteer-core>"); process.exit(2); }
const puppeteer = createRequire(FERRAMENTAS.replace(/\/$/, "") + "/package.json")("puppeteer-core");

let total = 0, falhas = 0;
function checar(nome, ok, detalhe = "") {
  total++;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${!ok && detalhe !== "" ? ` — ${detalhe}` : ""}`);
}
const espera = ms => new Promise(r => setTimeout(r, ms));

const navegador = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
async function abrir(rota, { reduzido = false } = {}) {
  const pg = await navegador.newPage();
  await pg.setViewport({ width: 412, height: 823, isMobile: true, hasTouch: true });
  if (reduzido) await pg.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const pedidos = [];
  pg.on("request", r => pedidos.push({ url: r.url(), quando: Date.now() }));
  let carregou = 0;
  pg.on("load", () => { carregou = Date.now(); });
  await pg.goto(BASE + rota, { waitUntil: "load" });
  const pediu = nome => pedidos.filter(p => new URL(p.url).pathname === "/" + nome);
  return { pg, pediu, carregou: () => carregou };
}

try {
  {
    const { pg, pediu } = await abrir("/", { reduzido: true });
    await espera(5000);
    await pg.evaluate(() => scrollTo(0, 600));
    await pg.mouse.click(5, 400);
    await pg.keyboard.press("Shift");
    await espera(1500);
    checar("P1.3 reduzido: motion.js nunca é pedido (nem depois de ocioso, rolagem, clique e tecla)", pediu("motion.js").length === 0, pediu("motion.js").length);
    const estado = await pg.evaluate(() => {
      const b = document.getElementById("btnMovimento");
      return { texto: b.textContent, desab: b.disabled, motion: document.documentElement.dataset.motion, topo: document.querySelector(".topbar").classList.contains("is-scrolled") };
    });
    checar("P1.3 reduzido: botão avisa e fica desabilitado; data-motion=paused", estado.texto === "Movimento reduzido pelo sistema" && estado.desab && estado.motion === "paused", JSON.stringify(estado));
    checar("P1.3 reduzido: o topo muda ao rolar (is-scrolled) sem o motion.js", estado.topo, JSON.stringify(estado));
    await pg.close();
  }
  {
    const { pg, pediu, carregou } = await abrir("/");
    const antes = pediu("motion.js");
    checar("P1.3 motion.js não é pedido antes do load", antes.every(p => p.quando >= carregou()), antes.length);
    await pg.evaluate(() => document.getElementById("btnMovimento").click());
    const antesDeChegar = await pg.evaluate(() => ({ texto: document.getElementById("btnMovimento").textContent, motion: document.documentElement.dataset.motion, pronto: !!window.trindadeRolar }));
    await pg.mouse.click(5, 400);
    await pg.waitForFunction(() => !!window.trindadeRolar, { timeout: 8000 }).catch(() => {});
    await espera(1500);
    const depois = await pg.evaluate(() => ({ texto: document.getElementById("btnMovimento").textContent, motion: document.documentElement.dataset.motion, pronto: !!window.trindadeRolar }));
    checar("P1.3 motion.js chega depois da interação (ou do ocioso)", pediu("motion.js").length === 1 && depois.pronto, pediu("motion.js").length);
    checar("P1.3 pausar antes do motion.js chegar vale na hora e continua valendo depois",
      (antesDeChegar.pronto || (antesDeChegar.texto === "Ativar animações" && antesDeChegar.motion === "paused")) && depois.texto === "Ativar animações" && depois.motion === "paused", JSON.stringify({ antesDeChegar, depois }));
    await pg.evaluate(() => { document.getElementById("btnMovimento").click(); localStorage.removeItem("trindade.motion"); });
    await pg.close();
  }
  // P1.2: só com o CSS crítico (estilo.css ainda não chegou), nenhuma rota fica mais larga que a tela do celular.
  // Se ficar, a página "encolhe" e tudo pula quando o estilo.css chega (foi o rodapé da /contato: CLS 0,067).
  for (const w of [360, 412]) {
    const largas = [];
    for (const rota of ["/", "/passeios", "/passeios/essencial", "/passeios/adventure", "/passeios/boat", "/passeios/juatinga", "/reservar", "/contato",
      "/city-tour-paraty", "/pousadas", "/historia", "/cameras", "/termos-do-passeio", "/politica-de-privacidade", "/creditos-das-fotos", "/rota-que-nao-existe"]) {
      const pg = await navegador.newPage();
      await pg.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
      await pg.setRequestInterception(true);
      pg.on("request", q => (/\/estilo(\.min)?\.css|fonts\.g|open-meteo/.test(q.url()) ? q.abort() : q.continue()));
      await pg.goto(BASE + rota, { waitUntil: "load" });
      await espera(300);
      const larg = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (larg > w) largas.push(`${rota} ${larg}px`);
      await pg.close();
    }
    checar(`P1.2 só com o CSS crítico, nenhuma rota passa de ${w}px de largura no celular`, !largas.length, largas.join(", "));
  }
} finally { await navegador.close(); }

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

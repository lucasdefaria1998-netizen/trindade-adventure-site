// Versões minificadas do app.js e do estilo.css (auditoria 16/11, P2.6).
//
// O código continua sendo escrito e revisado em site/app.js e site/estilo.css (comentados, legíveis). O index.html
// carrega as cópias minificadas, site/app.min.js e site/estilo.min.css, que este script gera com o esbuild. Não há
// passo de build no deploy (o Pages publica a pasta site/ como está), então as cópias geradas vão no commit.
// A primeira linha de cada cópia guarda o sha256 da fonte de onde saiu; o testes/check-versao.mjs confere que bate
// — mudou a fonte e esqueceu de rodar isto, o teste falha.
//
//   FERRAMENTAS=<pasta com node_modules/esbuild> node scripts/minificar.mjs
//
// Depois: troque o ?v= do arquivo gerado no index.html e rode node testes/check-versao.mjs --atualizar.
// O estilo.css também é a fonte do CSS crítico (scripts/css-critico.mjs): mudou o CSS, rode os dois.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const FERRAMENTAS = process.env.FERRAMENTAS;
if (!FERRAMENTAS) { console.error("defina FERRAMENTAS=<pasta com node_modules/esbuild>"); process.exit(2); }
const esbuild = createRequire(FERRAMENTAS.replace(/\/$/, "") + "/package.json")("esbuild");

const PARES = [["app.js", "app.min.js", "js"], ["estilo.css", "estilo.min.css", "css"]];
// Mesmo hash do check-versao (quebras de linha normalizadas para LF).
const shaFonte = texto => createHash("sha256").update(texto.replace(/\r\n/g, "\n")).digest("hex");
const cabecalho = (fonte, sha) => `/* gerado de ${fonte} por scripts/minificar.mjs, não edite (fonte sha256:${sha}) */\n`;

const site = new URL("../site/", import.meta.url);
for (const [fonte, saida, loader] of PARES) {
  const texto = readFileSync(fileURLToPath(new URL(fonte, site)), "utf8");
  // Sem bundle e sem "format": nomes de nível de topo do app.js ficam (são globais que o HTML e os testes usam).
  const { code } = await esbuild.transform(texto, { loader, minify: true, legalComments: "none", charset: "utf8" });
  const final = cabecalho(fonte, shaFonte(texto)) + code;
  writeFileSync(fileURLToPath(new URL(saida, site)), final);
  const kb = n => (n / 1024).toFixed(1) + " KiB";
  console.log(`${fonte} ${kb(Buffer.byteLength(texto))} → ${saida} ${kb(Buffer.byteLength(final))}`);
}

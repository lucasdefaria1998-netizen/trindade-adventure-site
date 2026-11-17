// Confere a regra "mudou o arquivo, mudou o ?v=".
//
// JS e CSS próprios do site são servidos com "cache-control: public, max-age=31536000, immutable" quando o
// pedido traz ?v= (ver VERSIONADOS no _worker.js). Se um deles mudar sem o ?v= do index.html mudar, quem já
// visitou fica com o arquivo antigo por um ano — inclusive um bug de reserva. Este script impede isso.
//
//   node testes/check-versao.mjs              confere (sai com 1 se algum arquivo mudou sem trocar o ?v=)
//   node testes/check-versao.mjs --atualizar  grava no versoes.json o ?v= e o hash atuais (rode DEPOIS de trocar o ?v=)
//   node testes/check-versao.mjs --raiz DIR   usa outra raiz (a pasta com site/ e versoes.json), para testes
//
// O versoes.json fica na raiz do repositório (fora de site/, portanto não é publicado). O hash é do conteúdo com
// quebras de linha normalizadas (LF), para não depender de como o Git do Windows converte o arquivo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ARQUIVOS = ["boot.js", "app.min.js", "motion.js", "pescaria-galeria.js", "estilo.min.css"];
// O index.html carrega as cópias minificadas (P2.6); o código se escreve na fonte ao lado. A primeira linha da cópia
// traz o sha256 da fonte de onde saiu: se a fonte mudou e ninguém rodou scripts/minificar.mjs, falha aqui.
const GERADOS = { "app.min.js": "app.js", "estilo.min.css": "estilo.css" };

const args = process.argv.slice(2);
const i = args.indexOf("--raiz");
const raiz = i >= 0 ? resolve(args[i + 1]) : resolve(fileURLToPath(new URL("..", import.meta.url)));
const atualizar = args.includes("--atualizar");

const hash = nome => createHash("sha256").update(readFileSync(resolve(raiz, "site", nome), "utf8").replace(/\r\n/g, "\n")).digest("hex");
const html = readFileSync(resolve(raiz, "site/index.html"), "utf8");
const arquivoDeVersoes = resolve(raiz, "versoes.json");
const gravado = existsSync(arquivoDeVersoes) ? JSON.parse(readFileSync(arquivoDeVersoes, "utf8")) : {};

const atual = {};
const problemas = [];
for (const nome of ARQUIVOS) {
  const refs = [...html.matchAll(new RegExp(`/${nome.replaceAll(".", "\\.")}(\\?v=([A-Za-z0-9._-]+))?(?=["'\\s>])`, "g"))];
  // Mais de uma referência só vale com o mesmo ?v= em todas (o estilo.css aparece também no <noscript>, P1.2).
  if (!refs.length) { problemas.push(`${nome}: nenhuma referência no index.html`); continue; }
  if (refs.some(r => !r[2])) { problemas.push(`${nome}: referência no index.html sem ?v=`); continue; }
  if (new Set(refs.map(r => r[2])).size !== 1) { problemas.push(`${nome}: referências com ?v= diferentes no index.html (${refs.map(r => r[2]).join(", ")})`); continue; }
  atual[nome] = { v: refs[0][2], sha256: hash(nome) };
}

for (const [gerado, fonte] of Object.entries(GERADOS)) {
  const caminho = resolve(raiz, "site", gerado);
  if (!existsSync(caminho)) { problemas.push(`${gerado}: não existe — rode scripts/minificar.mjs`); continue; }
  const m = /^\/\* gerado de ([\w.-]+) por scripts\/minificar\.mjs[^*]*\(fonte sha256:([0-9a-f]{64})\) \*\//.exec(readFileSync(caminho, "utf8"));
  if (!m || m[1] !== fonte) problemas.push(`${gerado}: sem o cabeçalho do scripts/minificar.mjs — gere de novo a partir do ${fonte}`);
  else if (m[2] !== hash(fonte)) problemas.push(`${gerado} está desatualizado: o ${fonte} mudou depois da última minificação — rode scripts/minificar.mjs, troque o ?v= e rode --atualizar`);
}

if (!problemas.length && !atualizar) {
  for (const nome of ARQUIVOS) {
    const g = gravado[nome];
    if (!g) { problemas.push(`${nome}: sem registro em versoes.json (rode com --atualizar)`); continue; }
    if (g.sha256 !== atual[nome].sha256 && g.v === atual[nome].v)
      problemas.push(`${nome}: o conteúdo mudou mas o ?v= continua ${g.v} — troque o ?v= no index.html e rode --atualizar`);
    else if (g.sha256 === atual[nome].sha256 && g.v !== atual[nome].v)
      problemas.push(`${nome}: o ?v= mudou (${g.v} → ${atual[nome].v}) sem o conteúdo mudar — rode --atualizar para registrar`);
    else if (g.sha256 !== atual[nome].sha256)
      problemas.push(`${nome}: ?v= trocado (${g.v} → ${atual[nome].v}), falta registrar — rode --atualizar`);
  }
}

if (problemas.length) {
  console.error("FALHA check-versao:\n  " + problemas.join("\n  "));
  process.exit(1);
}
if (atualizar) {
  writeFileSync(arquivoDeVersoes, JSON.stringify(atual, null, 2) + "\n");
  console.log("versoes.json atualizado:", ARQUIVOS.map(n => `${n}@${atual[n].v}`).join(", "));
} else {
  console.log("check-versao OK:", ARQUIVOS.map(n => `${n}@${atual[n].v}`).join(", "));
}

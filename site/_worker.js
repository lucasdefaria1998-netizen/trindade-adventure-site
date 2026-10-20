/* ===========================================================================
   Trindade Adventure — backend (Cloudflare Pages, modo _worker.js)

   Um arquivo só. O deploy por arraste-e-solta não compila a pasta /functions
   do Cloudflare, mas aceita este _worker.js. Ele:

   1. responde /api/*   — reservas, disponibilidade, eventos de funil e painel
   2. entrega as páginas — cada endereço do site (/passeios, /reservar,
      /passeios/adventure…) recebe o index.html com título, descrição,
      canonical e Open Graph próprios, lidos da tabela de páginas que fica
      no próprio index.html (<script id="site-config">). Endereço que não
      está na tabela recebe a página "não encontrada" com status 404.
   3. entrega os arquivos — fotos, CSS e JS saem de env.ASSETS. Arquivo que
      não existe responde 404 de verdade, sem cache longo, e nunca o HTML
      da página inicial.

   Ligações (Settings > Bindings no painel do projeto Pages):
     DB       — banco D1 "trindade-adventure"
     (Cloudflare Access protege /admin e /api/admin/* por login de e-mail)

   Regra de ouro: se qualquer coisa falhar aqui, o site estático ainda tem que
   sair. Erro ao montar uma página cai em env.ASSETS.fetch(request), e erros
   na API viram JSON de erro, nunca página quebrada.
   =========================================================================== */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const ok = (dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: JSON_HEADERS });
const erro = (mensagem, status = 400, extra) =>
  new Response(JSON.stringify({ ok: false, erro: mensagem }), { status, headers: extra ? { ...JSON_HEADERS, ...extra } : JSON_HEADERS });

const ERRO_GENERICO = "Erro interno. Tente de novo ou fale no WhatsApp.";

/* ------------------------------ headers de segurança ------------------------------

   O _headers só vale para o que sai direto do Pages (env.ASSETS); resposta
   montada aqui (JSON da API, 404 em texto, página reescrita) não passa por ele.
   Por isso TODA resposta sai por esta função, que garante os mesmos headers
   em tudo: HTML, 404, arquivos, redirects e API.

   - mantém o que já vem (cache-control, location, link…) e completa os quatro
     headers-base se faltarem. O X-Frame-Options fica: frame-ancestors não vale
     em CSP Report-Only;
   - Strict-Transport-Security sem "preload" (não submeter ao hstspreload.org);
   - tira todo Access-Control-*: o Pages põe "allow-origin: *" nos arquivos e o
     site não tem consumidor de outra origem (a API recusa Origin de fora);
   - API: JSON em UTF-8, nosniff, no-store e CSP "default-src 'none'". */
const HEADERS_BASE = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()"
};
const HSTS = "max-age=31536000; includeSubDomains";

/* Política de segurança de conteúdo das páginas do site, por enquanto só em modo Report-Only (nada é
   bloqueado; as violações vão para /api/csp-report). Valem os mesmos hosts que o site já usa:
   Leaflet e CSS/JS próprios saem do próprio domínio; mapa (tile.openstreetmap.org — o host sem subdomínio,
   "*.tile…" não cobre), clima (open-meteo), fonte (Google Fonts) e o desafio anti-robô da reserva (Turnstile).
   Nunca 'unsafe-inline', 'unsafe-eval' ou 'unsafe-hashes' em script-src. style-src-attr 'none': o site não usa
   atributo style= (valores dinâmicos vão pelo CSSOM). O /admin fica de fora: a página dele tem script e estilo
   inline e já está atrás do Cloudflare Access. */
const CSP_SITE = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'none'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
  "report-to csp"
].join("; ");

function comHeadersSeguranca(resp, { api = false, caminho = "" } = {}) {
  const r = new Response(resp.body, resp); // cópia com headers mutáveis (redirects e respostas do ASSETS são imutáveis)
  for (const [nome, valor] of Object.entries(HEADERS_BASE)) if (!r.headers.has(nome)) r.headers.set(nome, valor);
  r.headers.set("strict-transport-security", HSTS);
  for (const nome of [...r.headers.keys()]) if (nome.startsWith("access-control-")) r.headers.delete(nome);
  if (api) {
    r.headers.set("content-type", "application/json; charset=utf-8");
    r.headers.set("x-content-type-options", "nosniff");
    r.headers.set("cache-control", "no-store");
    r.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  } else if (/^text\/html\b/i.test(r.headers.get("content-type") || "") && !/^\/admin(\/|$|\.html$)/.test(caminho)) {
    r.headers.set("content-security-policy-report-only", CSP_SITE);
    r.headers.set("reporting-endpoints", 'csp="/api/csp-report"');
  }
  return r;
}

export default {
  async fetch(request, env) {
    const resposta = await tratar(request, env);
    const caminho = new URL(request.url).pathname;
    return comHeadersSeguranca(resposta, { api: caminho.startsWith("/api/"), caminho });
  }
};

async function tratar(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) {
    try {
      return await servirSite(request, env, url);
    } catch (e) {
      return env.ASSETS.fetch(request);
    }
  }

  if (!env.DB) {
    // Binding ainda não configurado: a API responde "indisponível" e o
    // front-end volta sozinho para o fluxo de WhatsApp.
    return erro("Banco de dados não configurado.", 503);
  }

  try {
    return await rotearAPI(request, env, url);
  } catch (e) {
    // Nada de stack, mensagem de D1 ou SQL na resposta: o detalhe vai só
    // para os logs do Worker, sem telefone nem e-mail inteiros.
    console.error("[erro-api]", request.method, url.pathname, mascarar(e && e.message ? e.message : String(e)));
    return erro(ERRO_GENERICO, 500);
  }
}

/* Tira e-mail e sequências de dígitos (telefone) de um texto antes de ele ir
   para o log. */
function mascarar(texto) {
  return String(texto)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\d[\d\s().-]{6,}\d/g, "[número]")
    .slice(0, 300);
}

/* ------------------------------ portão dos POST públicos ------------------------------

   Todo POST público (reserva, evento de funil) passa por aqui, nesta ordem,
   antes de qualquer leitura do banco:

     1. método    só POST (senão 405 com "Allow: POST");
     2. Origin    tem que estar na lista de origens do site (403);
     3. conteúdo  Content-Type application/json (415);
     4. tamanho   Content-Length e corpo lido com limite de verdade (413);
     5. taxa      limite por IP em janela fixa, contado no D1 (429).

   Sem isso, qualquer página de fora conseguia mandar reservas com um
   formulário "text/plain" (que o navegador envia sem pedir permissão) e
   esgotar as vagas.

   Origens: env.ORIGENS_PERMITIDAS, separadas por vírgula. Aceita
   "https://*.exemplo.com" para os endereços de preview do Pages. Sem a
   variável, vale a lista de produção abaixo — assim um deploy sem a variável
   configurada não derruba a reserva. */
const ORIGENS_PADRAO = ["https://trindadeadventury.com.br", "https://trindade-adventure.pages.dev"];

const ROTAS_PUBLICAS = {
  "/api/reservas": { tipos: ["application/json"], maxBytes: 8 * 1024, limite: { max: 5, janelaS: 600 }, turnstile: true },
  "/api/eventos": { tipos: ["application/json"], maxBytes: 2 * 1024, limite: { max: 60, janelaS: 60 } },
  // Relatórios de violação da CSP. O navegador manda sem cookie e, conforme a versão, sem Origin; o corpo do
  // formato "reports+json" é uma lista. Por isso aceitaLista/origemOpcional — o resto do portão vale igual.
  "/api/csp-report": { tipos: ["application/csp-report", "application/reports+json"], maxBytes: 8 * 1024, limite: { max: 30, janelaS: 60 }, aceitaLista: true, origemOpcional: true }
};

function origensPermitidas(env) {
  const lista = String(env.ORIGENS_PERMITIDAS || "").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return lista.length ? lista : ORIGENS_PADRAO;
}

function origemPermitida(origem, lista) {
  let o;
  try { o = new URL(origem); } catch { return false; }
  if (o.origin !== origem.replace(/\/+$/, "")) return false; // com caminho, usuário ou "null"
  for (const permitida of lista) {
    if (permitida === o.origin) return true;
    const curinga = /^(https?):\/\/\*\.(.+)$/.exec(permitida);
    if (curinga && o.protocol === curinga[1] + ":" && o.hostname.endsWith("." + curinga[2]) && o.hostname.length > curinga[2].length + 1) return true;
  }
  return false;
}

async function lerCorpoLimitado(request, maxBytes) {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) return { status: 413 };
  if (!request.body) return { texto: "" };
  const leitor = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await leitor.cancel(); } catch {} return { status: 413 }; }
    partes.push(value);
  }
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { buf.set(p, pos); pos += p.byteLength; }
  return { texto: new TextDecoder().decode(buf) };
}

/* Contador por IP em janela fixa, no D1 (um contador em memória do isolate não
   serve: cada isolate teria o seu). A tabela se cria sozinha na primeira vez;
   o mesmo SQL está em migracoes/0001_rate_limit.sql. Se o banco falhar aqui, a
   reserva segue (melhor atender do que travar) e o erro vai para o log. */
let tabelaRateLimitPronta = false;
async function excedeuLimite(env, rota, ip, { max, janelaS }) {
  try {
    if (!tabelaRateLimitPronta) {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS rate_limit (chave TEXT NOT NULL, janela INTEGER NOT NULL, n INTEGER NOT NULL, " +
        "expira INTEGER NOT NULL, PRIMARY KEY (chave, janela))"
      ).run();
      tabelaRateLimitPronta = true;
    }
    const agora = Math.floor(Date.now() / 1000);
    const janela = Math.floor(agora / janelaS);
    const expira = (janela + 1) * janelaS;
    const r = await env.DB
      .prepare(
        "INSERT INTO rate_limit (chave, janela, n, expira) VALUES (?1, ?2, 1, ?3) " +
        "ON CONFLICT (chave, janela) DO UPDATE SET n = n + 1 RETURNING n"
      )
      .bind(rota + "|" + ip, janela, expira)
      .first();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate_limit WHERE expira < ?1").bind(agora).run();
    return r && Number(r.n) > max ? Math.max(1, expira - agora) : 0;
  } catch (e) {
    console.error("[rate-limit]", mascarar(e && e.message ? e.message : String(e)));
    return 0;
  }
}

async function receberPostPublico(request, env, rota) {
  const cfg = ROTAS_PUBLICAS[rota];

  if (request.method !== "POST") return { resposta: erro("Método não permitido.", 405, { Allow: "POST" }) };

  const origem = request.headers.get("origin");
  const permitida = origem
    ? origemPermitida(origem, origensPermitidas(env))
    : cfg.origemOpcional || request.headers.get("sec-fetch-site") === "same-origin";
  if (!permitida) return { resposta: erro("Origem não permitida.", 403) };

  const tipo = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!cfg.tipos.includes(tipo)) return { resposta: erro("Tipo de conteúdo não aceito.", 415) };

  const lido = await lerCorpoLimitado(request, cfg.maxBytes);
  if (lido.status) return { resposta: erro("Pedido grande demais.", lido.status) };

  const ip = request.headers.get("cf-connecting-ip") || "sem-ip";
  const espera = await excedeuLimite(env, rota, ip, cfg.limite);
  if (espera) return { resposta: erro("Muitos pedidos. Tente de novo em instantes.", 429, { "Retry-After": String(espera) }) };

  let corpo;
  try { corpo = JSON.parse(lido.texto); } catch { return { resposta: erro("Corpo inválido.", 400) }; }
  if (!corpo || typeof corpo !== "object" || (Array.isArray(corpo) && !cfg.aceitaLista)) return { resposta: erro("Corpo inválido.", 400) };

  // Desafio anti-robô (Turnstile). Depois do limite por IP: robô que insiste cai no 429 antes de gastar a consulta à Cloudflare.
  if (cfg.turnstile) {
    if (!env.TURNSTILE_SECRET) {
      // Sem o segredo configurado a reserva online fica fechada (o site cai no fluxo de WhatsApp); aberta, ela ficaria sem proteção nenhuma.
      console.error("[turnstile] TURNSTILE_SECRET não configurado");
      return { resposta: erro("Reservas online indisponíveis no momento. Fale pelo WhatsApp.", 503) };
    }
    const v = await verificarTurnstile(corpo["cf-turnstile-response"], ip, env);
    if (v.motivo === "indisponivel") return { resposta: erro("Verificação indisponível no momento. Fale pelo WhatsApp.", 503) };
    if (!v.ok) return { resposta: erro("Não foi possível confirmar que você não é um robô. Tente de novo ou fale no WhatsApp.", 403) };
  }
  delete corpo["cf-turnstile-response"];
  return { corpo };
}

/* ------------------------------ Turnstile ------------------------------

   O site manda o token do widget no campo "cf-turnstile-response". Aqui ele é
   conferido na Cloudflare com o segredo (env.TURNSTILE_SECRET, nunca no JS do
   site): precisa ter dado certo (success), ter sido gerado numa página do nosso
   domínio (hostname) e para a ação da reserva (action).

   Hosts aceitos: env.TURNSTILE_HOSTNAMES (vírgula) ou a lista de produção
   abaixo — mais qualquer subdomínio de trindade-adventure.pages.dev (previews).
   As chaves de teste da Cloudflare respondem com hostname "example.com" e sem
   action, marcando metadata.result_with_testing_key; só nesse caso (impossível
   com um segredo real) hostname e action não são exigidos. */
const TURNSTILE_ACAO = "reserva";
const TURNSTILE_HOSTS_PADRAO = ["trindadeadventury.com.br", "www.trindadeadventury.com.br", "trindade-adventure.pages.dev"];

function hostTurnstileOk(host, env) {
  const lista = String(env.TURNSTILE_HOSTNAMES || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (lista.length) return lista.includes(h);
  return TURNSTILE_HOSTS_PADRAO.includes(h) || h.endsWith(".trindade-adventure.pages.dev");
}

async function verificarTurnstile(token, ip, env, buscar = fetch) {
  if (!env.TURNSTILE_SECRET) return { ok: false, motivo: "sem-segredo" };
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return { ok: false, motivo: "sem-token" };
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip && ip !== "sem-ip") form.set("remoteip", ip);
  let r;
  try {
    const resp = await buscar("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form, signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return { ok: false, motivo: "indisponivel" };
    r = await resp.json();
  } catch (e) {
    console.error("[turnstile] verificação fora do ar:", mascarar(e && e.message ? e.message : String(e)));
    return { ok: false, motivo: "indisponivel" };
  }
  if (!r || r.success !== true) return { ok: false, motivo: "recusado" };
  if (r.metadata && r.metadata.result_with_testing_key === true) return { ok: true, teste: true };
  if (!hostTurnstileOk(r.hostname, env)) return { ok: false, motivo: "host" };
  if (r.action !== TURNSTILE_ACAO) return { ok: false, motivo: "acao" };
  return { ok: true };
}

/* ------------------------------ páginas e arquivos ------------------------------

   O Cloudflare Pages, sem um 404.html na raiz, trata o projeto como SPA e
   devolve o index.html com status 200 para QUALQUER caminho — inclusive
   /assets/foto-que-nao-existe.webp, que ainda herdava do _headers o cache de
   um ano (immutable). O navegador guardava o HTML da página inicial no lugar
   da foto. Daqui para baixo, três regras:

   - Caminho com extensão, ou dentro de /assets e /vendor, é ARQUIVO: sai do
     env.ASSETS como está; se não existir, 404 em texto, com "no-cache".
   - Caminho que está na tabela de páginas é PÁGINA: index.html com os
     metadados daquela página, status 200.
   - Qualquer outro caminho é página inexistente: index.html mostrando a seção
     "não encontrada", status 404, "noindex" e "no-cache".
   ----------------------------------------------------------------------------- */

// A pescaria tinha duas URLs; fica só /pescaria e o endereço antigo responde 301. O app.js tem a mesma
// tabela (REDIRECIONAMENTOS) para a navegação sem recarregar e para os links antigos com "#/".
const REDIRECIONAMENTOS = Object.assign(Object.create(null), { "/passeios/fishing": "/pescaria" });

const EXTENSAO = /\.[a-z0-9]{1,8}$/i;
const SEM_CACHE = "no-cache";

async function servirSite(request, env, url) {
  const p = url.pathname;
  const metodo = request.method;
  if (metodo !== "GET" && metodo !== "HEAD") return env.ASSETS.fetch(request);

  // O painel tem página e login próprios (Cloudflare Access); passa direto.
  if (p === "/admin" || p.startsWith("/admin/") || p === "/admin.html") return env.ASSETS.fetch(request);

  // Endereços que mudaram de lugar: 301 permanente, mantendo a query string. Vale com ou sem
  // barra no fim (um salto só, sem passar pelo endereço sem barra).
  const destino = REDIRECIONAMENTOS[p.length > 1 ? p.replace(/\/+$/, "") : p];
  if (destino) return Response.redirect(url.origin + destino + url.search, 301);

  if (EXTENSAO.test(p) || p.startsWith("/assets/") || p.startsWith("/vendor/")) {
    return servirArquivo(request, env, p, url);
  }

  // /passeios/ e /passeios são o mesmo endereço: fica um só, sem barra no fim.
  if (p.length > 1 && p.endsWith("/")) {
    return Response.redirect(url.origin + p.replace(/\/+$/, "") + url.search, 301);
  }

  return servirPagina(request, env, url);
}

/* JS e CSS próprios do site, referenciados no index.html com ?v=. O _headers não enxerga query string,
   então a regra "com ?v= guarda por um ano" mora aqui. Sem ?v= (ou com ?v= fora do formato), o
   cache-control do _headers (1 dia) continua valendo. Quem muda um desses arquivos tem de mudar o ?v=
   no index.html — testes/check-versao.mjs confere isso. */
const VERSIONADOS = new Set(["/boot.js", "/app.js", "/motion.js", "/pescaria-galeria.js", "/estilo.css"]);
const VERSAO_VALIDA = /^[A-Za-z0-9._-]{1,40}$/;
const CACHE_VERSIONADO = "public, max-age=31536000, immutable";

async function servirArquivo(request, env, p, url) {
  const r = await env.ASSETS.fetch(request);
  const tipo = r.headers.get("content-type") || "";
  const pediuHTML = /\.html?$/i.test(p);
  // Segunda trava: mesmo que um deploy saia sem o 404.html e o Pages volte a
  // responder o index.html no lugar de um arquivo, isso não chega ao visitante.
  const ehFallbackDaSPA = r.status === 200 && !pediuHTML && tipo.includes("text/html");
  if (r.status === 404 || ehFallbackDaSPA) return arquivoNaoEncontrado(r);
  if ((r.status === 200 || r.status === 304) && VERSIONADOS.has(p) && VERSAO_VALIDA.test((url && url.searchParams.get("v")) || "")) {
    const versionado = new Response(r.body, r);
    versionado.headers.set("cache-control", CACHE_VERSIONADO);
    return versionado;
  }
  return r;
}

function arquivoNaoEncontrado(base) {
  const h = new Headers();
  for (const nome of ["x-content-type-options", "referrer-policy", "permissions-policy"]) {
    const v = base.headers.get(nome);
    if (v) h.set(nome, v);
  }
  h.set("content-type", "text/plain; charset=utf-8");
  h.set("cache-control", SEM_CACHE);
  return new Response("404 — arquivo não encontrado.\n", { status: 404, headers: h });
}

/* A tabela de páginas mora no index.html, num bloco JSON. O app.js lê o mesmo
   bloco para trocar título e metadados quando o visitante navega sem recarregar
   — assim o texto de cada página existe em um lugar só. */
function lerConfigDoSite(html) {
  const m = html.match(/<script type="application\/json" id="site-config">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

async function servirPagina(request, env, url) {
  // Pede o index.html sem os cabeçalhos condicionais do navegador: um 304
  // viria sem corpo, e o corpo é o que precisa ser reescrito.
  const base = await env.ASSETS.fetch(new Request(url.origin + "/", { method: "GET" }));
  if (base.status !== 200) return env.ASSETS.fetch(request);

  const html = await base.text();
  const site = lerConfigDoSite(html);
  if (!site) return env.ASSETS.fetch(request);

  const pagina = site.paginas[url.pathname];
  const meta = metadadosDaPagina(site, url.pathname, pagina);

  const h = new Headers(base.headers);
  h.delete("etag"); h.delete("content-length"); h.delete("last-modified");
  h.set("content-type", "text/html; charset=utf-8");
  if (!pagina) h.set("cache-control", SEM_CACHE);

  const resposta = new Response(html, { status: pagina ? 200 : 404, headers: h });
  return aplicarMetadados(resposta, meta, !pagina, env, { secao: (pagina || site.naoEncontrada).secao, foco: (pagina && pagina.foco) || null, empresa: textoDaEmpresa(site.negocio) });
}

/* Dados legais do rodapé (razão social, CNPJ, Cadastur), a partir de "negocio" no site-config. Campo vazio
   não entra: sem rótulo solto. Mesma regra e mesmo texto do app.js (mostrarDadosDaEmpresa). */
function textoDaEmpresa(n) {
  n = n || {};
  return [
    n.razaoSocial && n.razaoSocial !== n.nome ? n.razaoSocial : "",
    n.cnpj ? "CNPJ " + n.cnpj : "",
    n.cadastur ? "Cadastur " + n.cadastur : ""
  ].filter(Boolean).join(" · ");
}

/* Mesma regra do app.js (função metadadosDaPagina lá): imagem e canonical
   absolutos, "noindex" para páginas marcadas com indexar:false e para o 404. */
function metadadosDaPagina(site, caminho, pagina) {
  const p = pagina || site.naoEncontrada;
  const indexar = !!pagina && p.indexar !== false;
  const imagem = site.origem + (p.imagem || site.imagemPadrao);
  return {
    titulo: p.titulo,
    descricao: p.descricao,
    canonical: pagina ? site.origem + caminho : null,
    robots: indexar ? "index,follow" : "noindex,follow",
    imagem,
    imagemAlt: p.imagemAlt || site.imagemAltPadrao,
    tipo: p.tipoOg || "website"
  };
}

function aplicarMetadados(resposta, m, naoEncontrada, env, rota) {
  const attr = (nome, valor) => ({ element(el) { el.setAttribute(nome, valor); } });
  let rw = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(m.titulo); } })
    .on('meta[name="description"]', attr("content", m.descricao))
    .on('meta[name="robots"]', attr("content", m.robots))
    .on('meta[property="og:type"]', attr("content", m.tipo))
    .on('meta[property="og:title"]', attr("content", m.titulo))
    .on('meta[property="og:description"]', attr("content", m.descricao))
    .on('meta[property="og:image"]', attr("content", m.imagem))
    .on('meta[property="og:image:alt"]', attr("content", m.imagemAlt))
    .on('meta[name="twitter:title"]', attr("content", m.titulo))
    .on('meta[name="twitter:description"]', attr("content", m.descricao))
    .on('meta[name="twitter:image"]', attr("content", m.imagem));

  // Sitekey pública do Turnstile: a do projeto (env.TURNSTILE_SITEKEY) vence a de teste que vem no index.html.
  if (env && /^[0-9A-Za-z_-]{10,64}$/.test(String(env.TURNSTILE_SITEKEY || ""))) {
    rw = rw.on('meta[name="turnstile-sitekey"]', attr("content", env.TURNSTILE_SITEKEY));
  }

  if (m.canonical) {
    rw = rw
      .on('link[rel="canonical"]', attr("href", m.canonical))
      .on('meta[property="og:url"]', attr("content", m.canonical));
  } else {
    // Página inexistente não tem endereço canônico.
    rw = rw
      .on('link[rel="canonical"]', { element(el) { el.remove(); } })
      .on('meta[property="og:url"]', { element(el) { el.remove(); } });
  }

  // A foto da abertura só existe na seção "inicio": nas outras rotas o preload gastaria banda (e
  // disputaria o LCP) com uma imagem que fica escondida.
  if (rota.secao !== "inicio") {
    rw = rw.on('link[rel="preload"][as="image"]', { element(el) { el.remove(); } });
  }

  // Dados da empresa no rodapé já no HTML (sem depender de JavaScript); sem dados, o parágrafo fica escondido.
  if (rota.empresa) {
    rw = rw.on("#dadosEmpresa", { element(el) { el.setInnerContent(rota.empresa); el.removeAttribute("hidden"); } });
  }

  rw = reescreverTitulos(rw, rota);

  rw = reescreverSecoes(rw, rota);
  return rw.transform(resposta);
}

/* A página já sai do servidor com o estado final: só a seção da rota visível (as outras com hidden) e,
   em /passeios/<plano>, a aba e o painel do plano abertos. Antes, o HTML vinha com todas as seções
   visíveis e o app.js escondia depois — a tela encolhia de repente (CLS 0,7 a 0,9 em /passeios).
   Sem JavaScript a página também fica certa: /contato mostra só o contato; a seção "não encontrada"
   só aparece na resposta 404. O app.js, na primeira carga, encontra tudo no lugar e não mexe em nada. */
function reescreverSecoes(rw, rota) {
  const plano = rota && rota.foco && rota.foco.plano;
  rw = rw.on("[data-secao]", { element(el) {
    if (el.getAttribute("data-secao") === rota.secao) el.removeAttribute("hidden"); else el.setAttribute("hidden", "");
  } });
  if (plano) {
    rw = rw
      .on("[data-aba]", { element(el) {
        const aberta = el.getAttribute("data-aba") === plano;
        el.setAttribute("aria-selected", aberta ? "true" : "false");
        if (aberta) el.removeAttribute("tabindex"); else el.setAttribute("tabindex", "-1");
      } })
      .on(".painel-roteiro", { element(el) {
        if (el.getAttribute("id") === "roteiro-" + plano) el.removeAttribute("hidden"); else el.setAttribute("hidden", "");
      } });
  }
  return rw;
}

/* Um <h1> por página. O HTML traz o título de cada seção como <h1 data-titulo> (todas as seções vêm
   no mesmo arquivo; o app.js esconde as outras) e, nos passeios com endereço próprio, o nome do
   passeio como <h2|h3 data-titulo-foco>. Aqui, por rota: o título da seção ativa sai como h1 e os
   demais viram h2; em /passeios/<passeio> o h1 é o nome do passeio (do mesmo site-config: foco.plano
   ou foco.passeio) e o título da seção vira h2. Mesmas classes, ids e atributos — só a tag muda.
   O app.js faz o mesmo ao navegar sem recarregar (ajustarH1). */
function reescreverTitulos(rw, rota) {
  const foco = rota && rota.foco;
  const idFoco = foco && foco.plano ? "roteiro-" + foco.plano : foco && foco.passeio ? "consulta-" + foco.passeio : null;
  let secao = null, recipiente = null;
  return rw
    .on("[data-secao]", { element(el) { secao = el.getAttribute("data-secao"); recipiente = null; } })
    .on(".painel-roteiro, .consulta", { element(el) { recipiente = el.getAttribute("id"); } })
    .on("[data-titulo]", { element(el) { el.tagName = secao === rota.secao && !idFoco ? "h1" : "h2"; } })
    .on("[data-titulo-foco]", { element(el) { if (idFoco && recipiente === idFoco) el.tagName = "h1"; } });
}

/* ------------------------------ roteador ------------------------------ */

async function rotearAPI(request, env, url) {
  const p = url.pathname;
  const metodo = request.method;

  if (p === "/api/disponibilidade" && metodo === "GET") return disponibilidade(env, url);

  if (ROTAS_PUBLICAS[p]) {
    const entrada = await receberPostPublico(request, env, p);
    if (entrada.resposta) return entrada.resposta;
    if (p === "/api/csp-report") return registrarRelatorioCsp(entrada.corpo);
    return p === "/api/reservas" ? criarReserva(entrada.corpo, env, request) : registrarEvento(entrada.corpo, env);
  }

  if (p.startsWith("/api/admin/")) {
    const auth = checarAdmin(request, env);
    if (!auth.ok) return erro("Acesso restrito.", 401);

    if (p === "/api/admin/resumo" && metodo === "GET") return adminResumo(env);
    if (p === "/api/admin/reservas" && metodo === "GET") return adminListarReservas(env, url);
    if (p === "/api/admin/reservas" && metodo === "POST") return adminCriarReserva(request, env);
    if (p.match(/^\/api\/admin\/reservas\/[\w-]+$/) && metodo === "PATCH")
      return adminAtualizarReserva(request, env, p.split("/").pop());
    if (p === "/api/admin/bloqueios" && metodo === "GET") return adminListarBloqueios(env);
    if (p === "/api/admin/bloqueios" && metodo === "POST") return adminCriarBloqueio(request, env);
    if (p.match(/^\/api\/admin\/bloqueios\/[\w-]+$/) && metodo === "DELETE")
      return adminRemoverBloqueio(env, p.split("/").pop());
    if (p === "/api/admin/origem" && metodo === "GET") return adminOrigem(env, url);
    if (p === "/api/admin/config" && metodo === "GET") return adminLerConfig(env);
    if (p === "/api/admin/config" && metodo === "POST") return adminGravarConfig(request, env);

    return erro("Rota de painel não encontrada.", 404);
  }

  return erro("Rota não encontrada.", 404);
}

/* ------------------------------ autenticação ------------------------------

   Cloudflare Access fica na frente das rotas /admin e /api/admin/*. Quando o
   pedido chega aqui, o Access já validou o login e injetou o e-mail no header.
   Sem esse header, o pedido não passou pelo Access — recusa.

   env.ADMIN_KEY existe só para o desenvolvedor testar antes do Access estar no
   ar. Em produção a variável fica sem valor e esse caminho morre sozinho.
   ------------------------------------------------------------------------ */

function checarAdmin(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return { ok: true, email };

  if (env.ADMIN_KEY) {
    const chave = request.headers.get("X-Admin-Key") || new URL(request.url).searchParams.get("key");
    if (chave && chave === env.ADMIN_KEY) return { ok: true, email: "chave-dev" };
  }
  return { ok: false };
}

/* ------------------------------ config ------------------------------ */

async function lerConfig(env) {
  const { results } = await env.DB.prepare("SELECT chave, valor FROM config").all();
  const c = {};
  for (const r of results) c[r.chave] = r.valor;
  return {
    capacidade: Number(c.capacidade || 10),
    slotInicio: Number(c.slot_inicio || 8),
    slotFim: Number(c.slot_fim || 15),
    saidaApos: Number(c.saida_apos || 20),
    cancelamentoH: Number(c.cancelamento_h || 12),
    retornoLimiteMin: minutosDe(c.retorno_limite || RETORNO_LIMITE_PADRAO),
    whatsapp: c.whatsapp || "5524993337247",
    instagram: c.instagram || "trindadeadventure",
    cupom: c.cupom || "TRINDADE10",
    beneficioInstagram: c.beneficio_instagram || "Siga e receba as fotos do seu dia de passeio."
  };
}

/* Preço, duração e horário de cada roteiro. Fonte única do backend — o front
   tem a sua cópia (PLANOS em app.js) para desenhar os cartões, mas o valor que
   vale é este. Os preços acompanham o que o site anuncia (cartões e JSON-LD).

   Campos de horário de cada plano:
     duracaoMin   duração aproximada do passeio, em minutos, contada da saída;
     horarios     lista fixa de concentrações (8.5 = 08:30). null = usa a grade
                  geral, de hora em hora, de slot_inicio a slot_fim;
     ultimaSaida  opcional: corta a grade num horário menor que slot_fim.

   E a regra que vale para todos: o passeio precisa terminar até o horário-
   limite de retorno (config "retorno_limite", padrão abaixo). Ou seja, a
   última concentração possível é

       retorno_limite − duração − saida_apos

   Não é o pôr do sol do dia — que muda o ano todo —, é um horário fixo de
   encerramento da operação, ajustável sem publicar o site:
     INSERT OR REPLACE INTO config (chave, valor) VALUES ('retorno_limite', '18:00');

   O padrão 18:20 não é inventado: é o retorno da saída mais tarde que o site
   já oferecia (Essencial, ≈ 3h, concentração 15:00, saída 15:20). Com ele, a
   grade do Essencial fica como sempre foi e a do Adventure (≈ 6h) passa a ir
   até 12:00 — antes ia até 15:00, com retorno perto das 21h20. */
const RETORNO_LIMITE_PADRAO = "18:20";

const PLANOS = {
  essencial: { nome: "Trindade Essencial", preco: 70, voucher: 0, duracaoMin: 180, horarios: null },
  adventure: { nome: "Trindade Adventure", preco: 150, voucher: 60, duracaoMin: 360, horarios: null },
  boat: { nome: "Trindade Boat", preco: 400, voucher: 60, duracaoMin: 480, horarios: [8.5] }
};

const doisDig = n => String(n).padStart(2, "0");
const horaLabel = h => doisDig(Math.floor(h)) + ":" + doisDig(Math.round((h % 1) * 60));
const ehISO = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function minutosDe(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : minutosDe(RETORNO_LIMITE_PADRAO);
}

function horariosDoPlano(planoId, cfg) {
  const pl = PLANOS[planoId];
  let base;
  if (pl && pl.horarios) base = pl.horarios.slice();
  else {
    base = [];
    for (let h = cfg.slotInicio; h <= cfg.slotFim; h++) base.push(h);
  }
  if (!pl) return base;
  return base.filter(h =>
    (pl.ultimaSaida == null || h <= pl.ultimaSaida) &&
    Math.round(h * 60) + cfg.saidaApos + pl.duracaoMin <= cfg.retornoLimiteMin
  );
}

// Data e minuto de agora no fuso da operação, não no do servidor (UTC).
function agoraEmTrindade() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    minuto: Number(partes.hour) * 60 + Number(partes.minute)
  };
}

function saidaLabel(h, cfg) {
  const t = Math.round(h * 60) + cfg.saidaApos;
  return doisDig(Math.floor(t / 60) % 24) + ":" + doisDig(t % 60);
}

/* ------------------------------ validação dos pedidos ------------------------------

   Só entra no banco o que passou por aqui. Campos desconhecidos são ignorados
   (a gravação lê só o que está nesta lista), tipos são exatos (pax é número, não
   texto) e as mensagens de erro são fixas por campo — nunca ecoam o valor
   recebido. Os campos de rastreio (origem, como conheceu, sessão) não barram a
   reserva: um valor fora da lista vira "outro"/vazio, porque perder uma reserva
   por causa de um parâmetro de campanha estranho custaria mais que o rastreio. */

const LIMITE_PAX_PEDIDO = 15;     // pessoas por reserva (decisão do Lucas, 19/10/2026)
const JANELA_RESERVA_DIAS = 90;   // de hoje até hoje+90 dias, no fuso de Trindade
const WHATSAPP_PADRAO = "5524993337247";

const CARACTERE_DE_CONTROLE = /[\u0000-\u001F\u007F]/;
const DDDS_BR = new Set(
  ("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 " +
   "51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99").split(" ")
);
const COMO_CONHECEU = ["Instagram", "Busca no Google", "Indicação de amigo", "Já conhecia / morador", "Outro"];

function dataReal(s) {
  if (!ehISO(s)) return false;
  const t = new Date(s + "T12:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

// "pass" = dentro da janela [hoje, hoje + 90 dias] no fuso de Trindade.
function conferirData(s, hoje) {
  if (typeof s !== "string" || !dataReal(s)) return "Data inválida.";
  if (s < hoje) return "A data já passou.";
  if (s > somaDiasISO(hoje, JANELA_RESERVA_DIAS)) return "Data fora do período de reservas.";
  return "";
}

/* Telefone: só dígitos depois de normalizar. Brasil com DDD (10 ou 11 dígitos,
   celular começa com 9), com ou sem o 55 na frente, ou número internacional no
   formato E.164 (começa com "+", 8 a 15 dígitos). Devolve os dígitos ou null. */
function normalizarTelefone(bruto) {
  if (typeof bruto !== "string") return null;
  const s = bruto.trim();
  const d = s.replace(/\D/g, "");
  const nacional = n => (n.length === 10 || n.length === 11) && DDDS_BR.has(n.slice(0, 2)) && (n.length === 10 || n[2] === "9");
  if (nacional(d)) return d;
  if (d.startsWith("55")) return (d.length === 12 || d.length === 13) && nacional(d.slice(2)) ? d : null;
  if (s.startsWith("+") && d.length >= 8 && d.length <= 15 && !d.startsWith("0")) return d;
  return null;
}

// Quebras de linha: \r\n vira \n, no máximo uma linha em branco seguida; outros caracteres de controle viram espaço.
const limparTextoLivre = s => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const limparLinha = s => s.replace(CARACTERE_DE_CONTROLE, " ").trim();

function normalizarSessao(v) {
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}
function normalizarDetalhe(v) {
  return typeof v === "string" ? limparLinha(v).slice(0, 100) || null : null;
}

function validarReserva(b, cfg, agora) {
  const e = {};
  const d = {};

  if (typeof b.plano === "string" && Object.hasOwn(PLANOS, b.plano)) d.plano = b.plano;
  else e.plano = "Escolha um passeio.";

  const erroData = conferirData(b.data, agora.data);
  if (erroData) e.data = erroData; else d.data = b.data;

  const horasOk = d.plano ? horariosDoPlano(d.plano, cfg) : [];
  if (typeof b.hora !== "number" || !horasOk.includes(b.hora)) e.hora = "Horário indisponível para este passeio.";
  else if (d.data === agora.data && Math.round(b.hora * 60) <= agora.minuto) e.hora = "Esse horário já passou.";
  else d.hora = b.hora;

  if (typeof b.pax === "number" && Number.isInteger(b.pax) && b.pax >= 1 && b.pax <= Math.min(cfg.capacidade, LIMITE_PAX_PEDIDO)) d.pax = b.pax;
  else e.pax = "Número de pessoas inválido.";

  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  if (nome.length >= 3 && nome.length <= 80 && !CARACTERE_DE_CONTROLE.test(nome)) d.nome = nome;
  else e.nome = "Informe o nome completo.";

  const telefone = normalizarTelefone(b.telefone);
  if (telefone) d.telefone = telefone; else e.telefone = "Telefone com DDD inválido.";

  if (b.email == null || b.email === "") d.email = null;
  else {
    const email = typeof b.email === "string" ? b.email.trim() : "";
    if (email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) d.email = email;
    else e.email = "E-mail inválido.";
  }

  if (b.obs == null || b.obs === "") d.obs = null;
  else if (typeof b.obs !== "string") e.obs = "Observações inválidas.";
  else {
    const obs = limparTextoLivre(b.obs);
    if (obs.length > 500) e.obs = "Observações muito longas (máximo 500 caracteres).";
    else d.obs = obs || null;
  }

  if (b.instagramCliente == null || b.instagramCliente === "") d.igCliente = null;
  else {
    const ig = typeof b.instagramCliente === "string" ? b.instagramCliente.trim().replace(/^@+/, "") : "";
    if (/^[A-Za-z0-9._]{1,30}$/.test(ig)) d.igCliente = ig;
    else if (ig === "" && typeof b.instagramCliente === "string") d.igCliente = null;
    else e.instagramCliente = "Instagram inválido.";
  }

  if (b.seguiuInstagram == null) d.seguiu = 0;
  else if (typeof b.seguiuInstagram === "boolean") d.seguiu = b.seguiuInstagram ? 1 : 0;
  else e.seguiuInstagram = "Valor inválido.";

  d.origem = normalizarOrigem(b.origem);
  d.origemDetalhe = normalizarDetalhe(b.origemDetalhe);
  d.comoConheceu = typeof b.comoConheceu === "string" && COMO_CONHECEU.includes(b.comoConheceu) ? b.comoConheceu : null;
  d.sessao = normalizarSessao(b.sessao);

  return { erros: e, dados: d };
}

// Código do pedido: aleatório (base32, 8 caracteres), não sequencial — ninguém adivinha o do vizinho.
const ALFABETO_CODIGO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function gerarCodigo() {
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(8))) s += ALFABETO_CODIGO[x & 31];
  return "TA-" + s.slice(0, 4) + "-" + s.slice(4);
}

/* ------------------------------ disponibilidade ------------------------------ */

async function disponibilidade(env, url) {
  const data = url.searchParams.get("data");
  if (conferirData(data, agoraEmTrindade().data)) return erro("Data inválida.");

  await garantirEsquemaReservas(env);
  const cfg = await lerConfig(env);

  const usados = await env.DB
    .prepare(
      "SELECT hora, COALESCE(SUM(pax),0) AS usado FROM reservas " +
      "WHERE data = ?1 AND " + contaNaVaga(2) + " GROUP BY hora"
    )
    .bind(data, new Date().toISOString())
    .all();

  const bloqueios = await env.DB
    .prepare("SELECT hora FROM bloqueios WHERE data = ?")
    .bind(data)
    .all();

  const usadoPor = {};
  for (const r of usados.results) usadoPor[String(r.hora)] = Number(r.usado);

  const diaTodoBloqueado = bloqueios.results.some(r => r.hora === null);
  const horasBloqueadas = new Set(
    bloqueios.results.filter(r => r.hora !== null).map(r => String(r.hora))
  );

  const grade = {};
  const todasHoras = new Set();
  for (const planoId of Object.keys(PLANOS))
    for (const h of horariosDoPlano(planoId, cfg)) todasHoras.add(h);

  for (const h of [...todasHoras].sort((a, b) => a - b)) {
    const usado = usadoPor[String(h)] || 0;
    const bloqueado = diaTodoBloqueado || horasBloqueadas.has(String(h));
    grade[String(h)] = {
      restam: bloqueado ? 0 : Math.max(0, cfg.capacidade - usado),
      bloqueado
    };
  }

  // Quais horários cada passeio aceita, já com a regra de duração aplicada.
  // O site desenha a grade a partir daqui quando a API responde.
  const horariosPorPlano = {};
  for (const planoId of Object.keys(PLANOS)) horariosPorPlano[planoId] = horariosDoPlano(planoId, cfg);

  return ok({ ok: true, data, capacidade: cfg.capacidade, grade, horariosPorPlano });
}

/* ------------------------------ criar reserva ------------------------------

   O que a reserva do site é, de ponta a ponta: o cliente envia o pedido, o
   servidor grava como "pendente" e segura a vaga; a operação confirma pelo
   WhatsApp (depois do sinal de 30% via Pix) e marca "confirmada" no painel.
   Pendente que ninguém confirma no prazo deixa de segurar a vaga — senão um
   robô, ou um cliente que sumiu, trava horários para sempre.

   Prazo da pendente (decisão do Lucas): 6 h depois de criada, ou 12 h antes do
   passeio — o que vier primeiro. Reserva feita com menos de 12 h de
   antecedência já não tem esse "12 h antes" pela frente: ela segura a vaga por
   6 h ou até a hora do passeio, se for antes.

   Nada é apagado nem muda de status por causa do prazo: a pendente vencida só
   deixa de contar na vaga (e o painel a mostra como "expirada"). Linhas
   antigas, de antes desta regra, não têm prazo (expira_em vazio) e continuam
   contando sempre — não dá para uma reserva real de ontem liberar a vaga
   quando este código entrar no ar. Confirmada, faltou e cancelada não têm prazo. */

const PENDENTE_VALIDADE_H = 6;
const PENDENTE_ANTES_DO_PASSEIO_H = 12;
const DUPLICADA_JANELA_MIN = 30;

// Condição "conta na vaga"; n = número do parâmetro que traz o instante de agora (ISO).
const contaNaVaga = n => "status != 'cancelada' AND (status != 'pendente' OR expira_em IS NULL OR expira_em > ?" + n + ")";
const SQL_USADO_NO_HORARIO = "SELECT COALESCE(SUM(pax),0) AS usado FROM reservas WHERE data = ?1 AND hora = ?2 AND " + contaNaVaga(3);
const SQL_RESERVA_POR_CHAVE = "SELECT * FROM reservas WHERE chave_idempotencia = ?1";

function expiraEm(data, hora, criadoMs) {
  const h = 3600e3;
  const inicioMs = Date.parse(data + "T00:00:00Z") + Math.round(hora * h) + 3 * h; // Trindade = UTC−3, sem horário de verão
  let limite = criadoMs + PENDENTE_VALIDADE_H * h;
  const antes = inicioMs - PENDENTE_ANTES_DO_PASSEIO_H * h;
  limite = antes > criadoMs ? Math.min(limite, antes) : Math.min(limite, inicioMs);
  return new Date(limite).toISOString();
}

/* Duas colunas novas na tabela de reservas: expira_em (prazo da pendente) e
   chave_idempotencia (anti-duplicata, com índice único). O mesmo SQL está em
   migracoes/0002_pendente_e_idempotencia.sql. O worker aplica sozinho, uma vez,
   e sem estragar nada se já estiverem lá — assim publicar o site antes de rodar
   a migração não derruba a reserva. */
let esquemaReservasPronto = false;
async function garantirEsquemaReservas(env) {
  if (esquemaReservasPronto) return;
  const { results } = await env.DB.prepare("PRAGMA table_info(reservas)").all();
  const tem = new Set(results.map(c => c.name));
  const novas = [
    ["expira_em", "ALTER TABLE reservas ADD COLUMN expira_em TEXT"],
    ["chave_idempotencia", "ALTER TABLE reservas ADD COLUMN chave_idempotencia TEXT"]
  ];
  for (const [nome, ddl] of novas) {
    if (tem.has(nome)) continue;
    try { await env.DB.prepare(ddl).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
  }
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_chave_idem ON reservas (chave_idempotencia) WHERE chave_idempotencia IS NOT NULL"
  ).run();
  esquemaReservasPronto = true;
}

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{16,64}$/;

/* Vaga, duplicata e gravação numa operação só: o INSERT … SELECT só insere se,
   no mesmo instante, o horário não está bloqueado, a soma de pessoas + este
   pedido cabe na capacidade e não existe pedido igual (mesmo telefone, data,
   horário e passeio) criado nos últimos 30 min. Dois pedidos simultâneos para o
   último lugar não passam os dois — o segundo não insere nada (0 linhas). */
const SQL_INSERIR_RESERVA =
  "INSERT INTO reservas " +
  "(id, codigo, criado_em, plano, data, hora, pax, nome, telefone, email, obs, " +
  "total, voucher, origem, origem_detalhe, como_conheceu, instagram_cliente, " +
  "seguiu_instagram, status, canal, atualizado_em, expira_em, chave_idempotencia) " +
  "SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,'pendente','site',?3,?20,?21 " +
  "WHERE NOT EXISTS (SELECT 1 FROM bloqueios WHERE data = ?5 AND (hora = ?6 OR hora IS NULL)) " +
  "AND (SELECT COALESCE(SUM(pax),0) FROM reservas WHERE data = ?5 AND hora = ?6 AND " + contaNaVaga(3) + ") + ?7 <= ?19 " +
  "AND NOT EXISTS (SELECT 1 FROM reservas WHERE telefone = ?9 AND data = ?5 AND hora = ?6 AND plano = ?4 " +
  "AND status != 'cancelada' AND criado_em > ?22)";

async function criarReserva(b, env, request) {
  await garantirEsquemaReservas(env);
  const cfg = await lerConfig(env);
  const agora = agoraEmTrindade();
  const { erros, dados: d } = validarReserva(b, cfg, agora);

  // Chave de idempotência: cabeçalho Idempotency-Key (ou campo idempotencyKey no JSON).
  const bruta = request.headers.get("idempotency-key") ?? b.idempotencyKey;
  let chave = null;
  if (bruta != null && bruta !== "") {
    if (typeof bruta === "string" && CHAVE_IDEMPOTENCIA.test(bruta)) chave = bruta;
    else erros.idempotencyKey = "Chave inválida.";
  }
  if (Object.keys(erros).length) return ok({ ok: false, erros }, 422);

  const plano = PLANOS[d.plano];
  const criadoMs = Date.now();
  const criadoEm = new Date(criadoMs).toISOString();

  // Mesmo envio repetido (clique duplo, rede ruim): devolve o pedido que já existe, sem gravar outro.
  if (chave) {
    const antiga = await env.DB.prepare(SQL_RESERVA_POR_CHAVE).bind(chave).first();
    if (antiga) return await repetirReserva(env, antiga, d, cfg, criadoEm);
  }

  // Guarda simples contra spam: no máximo 5 pedidos por telefone em 24 h.
  const recentes = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM reservas WHERE telefone = ? AND criado_em > ?")
    .bind(d.telefone, new Date(criadoMs - 86400000).toISOString())
    .first();
  if (recentes && Number(recentes.n) >= 5)
    return erro("Muitos pedidos deste telefone hoje. Fale com a operação pelo WhatsApp.", 429);

  const id = crypto.randomUUID();
  const total = plano.preco * d.pax;
  const voucher = plano.voucher * d.pax;
  const limiteDuplicata = new Date(criadoMs - DUPLICADA_JANELA_MIN * 60000).toISOString();
  const prazo = expiraEm(d.data, d.hora, criadoMs);

  let codigo = null;
  for (let tentativa = 0; tentativa < 3 && !codigo; tentativa++) {
    const candidato = gerarCodigo();
    try {
      const r = await env.DB
        .prepare(SQL_INSERIR_RESERVA)
        .bind(
          id, candidato, criadoEm, d.plano, d.data, d.hora, d.pax, d.nome, d.telefone, d.email, d.obs,
          total, voucher, d.origem, d.origemDetalhe, d.comoConheceu, d.igCliente, d.seguiu, cfg.capacidade,
          prazo, chave, limiteDuplicata
        )
        .run();
      if (r.meta.changes !== 1) {
        if (chave) {
          const antiga = await env.DB.prepare(SQL_RESERVA_POR_CHAVE).bind(chave).first();
          if (antiga) return await repetirReserva(env, antiga, d, cfg, criadoEm);
        }
        return await explicarRecusa(env, d, cfg, criadoEm, limiteDuplicata);
      }
      codigo = candidato;
    } catch (err) {
      const msg = String(err && err.message);
      if (chave && /chave_idempotencia/i.test(msg)) {
        const antiga = await env.DB.prepare(SQL_RESERVA_POR_CHAVE).bind(chave).first();
        if (antiga) return await repetirReserva(env, antiga, d, cfg, criadoEm);
      }
      // Código repetido (chance mínima): sorteia outro. Qualquer outro erro sobe.
      if (!/UNIQUE/i.test(msg) || tentativa === 2) throw err;
    }
  }

  await env.DB
    .prepare("INSERT INTO eventos (ts, tipo, origem, origem_detalhe, sessao, reserva_codigo) VALUES (?,?,?,?,?,?)")
    .bind(criadoEm, "reserva_criada", d.origem, d.origemDetalhe, d.sessao, codigo)
    .run();

  const uso = await env.DB.prepare(SQL_USADO_NO_HORARIO).bind(d.data, d.hora, criadoEm).first();

  return respostaDaReserva({
    codigo, plano, data: d.data, hora: d.hora, pax: d.pax, nome: d.nome, telefone: d.telefone, email: d.email, obs: d.obs,
    total, voucher, origem: d.origem, origemDetalhe: d.origemDetalhe, comoConheceu: d.comoConheceu,
    igCliente: d.igCliente, seguiu: d.seguiu
  }, cfg, Math.max(0, cfg.capacidade - Number(uso.usado || 0)));
}

function respostaDaReserva(m, cfg, restam, extra) {
  // O número do WhatsApp é o do servidor (config), nunca algo vindo do pedido.
  const numeroWA = /^\d{12,13}$/.test(cfg.whatsapp) ? cfg.whatsapp : WHATSAPP_PADRAO;
  const mensagem = montarMensagem({ ...m, cfg });
  return ok({
    ok: true,
    codigo: m.codigo,
    restam,
    whatsapp: "https://wa.me/" + numeroWA + "?text=" + encodeURIComponent(mensagem),
    mensagem,
    ...extra
  });
}

// A mesma chave com outro pedido não é um reenvio: é conflito (409). Com o mesmo pedido, devolve a mesma resposta.
async function repetirReserva(env, r, d, cfg, agoraISO) {
  const igual = r.plano === d.plano && r.data === d.data && Number(r.hora) === d.hora && Number(r.pax) === d.pax && r.telefone === d.telefone;
  if (!igual) return ok({ ok: false, motivo: "chave_em_uso", erro: "Esta chave já foi usada em outro pedido." }, 409);
  const uso = await env.DB.prepare(SQL_USADO_NO_HORARIO).bind(r.data, Number(r.hora), agoraISO).first();
  return respostaDaReserva({
    codigo: r.codigo, plano: PLANOS[r.plano], data: r.data, hora: Number(r.hora), pax: Number(r.pax), nome: r.nome, telefone: r.telefone,
    email: r.email, obs: r.obs, total: Number(r.total), voucher: Number(r.voucher), origem: r.origem, origemDetalhe: r.origem_detalhe,
    comoConheceu: r.como_conheceu, igCliente: r.instagram_cliente, seguiu: Number(r.seguiu_instagram)
  }, cfg, Math.max(0, cfg.capacidade - Number(uso.usado || 0)), { repetido: true });
}

// O INSERT não inseriu nada: descobre por quê (pedido igual há pouco, horário bloqueado ou lotado).
async function explicarRecusa(env, d, cfg, agoraISO, limiteDuplicata) {
  const igual = await env.DB
    .prepare(
      "SELECT 1 AS x FROM reservas WHERE telefone = ?1 AND data = ?2 AND hora = ?3 AND plano = ?4 " +
      "AND status != 'cancelada' AND criado_em > ?5 LIMIT 1"
    )
    .bind(d.telefone, d.data, d.hora, d.plano, limiteDuplicata)
    .first();
  if (igual) {
    return ok({
      ok: false, motivo: "duplicado",
      erro: "Já recebemos um pedido igual há poucos minutos. Se for outro grupo, fale com a operação pelo WhatsApp."
    }, 409);
  }
  const bloq = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM bloqueios WHERE data = ? AND (hora = ? OR hora IS NULL)")
    .bind(d.data, d.hora)
    .first();
  if (Number(bloq.n) > 0) return ok({ ok: false, motivo: "bloqueado", restam: 0 }, 409);
  const uso = await env.DB.prepare(SQL_USADO_NO_HORARIO).bind(d.data, d.hora, agoraISO).first();
  return ok({ ok: false, motivo: "cheio", restam: Math.max(0, cfg.capacidade - Number(uso.usado || 0)) }, 409);
}

// Origem de rastreio: lista fixa; "link:<fonte>" só com letras, números, ponto, hífen e sublinhado.
function normalizarOrigem(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("instagram")) return "instagram";
  if (s.startsWith("google")) return "google";
  if (s.startsWith("facebook")) return "facebook";
  if (s.startsWith("link:")) {
    const fonte = s.slice(5).replace(/[^a-z0-9._-]/g, "").slice(0, 40);
    return fonte ? "link:" + fonte : "outro";
  }
  if (s === "direto") return "direto";
  return "outro";
}

function montarMensagem(d) {
  const { cfg } = d;
  const linhas = [
    "*Pedido de reserva — Trindade Adventure*",
    "",
    "Código: " + d.codigo,
    "Passeio: " + d.plano.nome,
    "Data: " + d.data.split("-").reverse().join("/"),
    "Horário: " + horaLabel(d.hora) + " — saída " + saidaLabel(d.hora, cfg),
    "Pessoas: " + d.pax,
    "Total: R$ " + d.total + (d.voucher ? " (inclui R$ " + d.voucher + " de voucher no almoço)" : ""),
    "",
    "Nome: " + d.nome,
    "WhatsApp: " + d.telefone
  ];
  if (d.email) linhas.push("E-mail: " + d.email);
  if (d.obs) linhas.push("Observações: " + d.obs);
  linhas.push("", "— controle interno —");
  const orig = d.origem === "outro" && d.comoConheceu ? d.comoConheceu : d.origem;
  linhas.push("Origem: " + orig + (d.origemDetalhe ? " (" + d.origemDetalhe + ")" : ""));
  if (d.igCliente) linhas.push("Instagram do cliente: @" + d.igCliente + (d.seguiu ? " — marcou que segue" : ""));
  linhas.push("", "Aguardo a confirmação da vaga. Obrigado!");
  return linhas.join("\n");
}

/* ------------------------------ eventos de funil ------------------------------ */

async function registrarEvento(b, env) {
  const tipos = ["visita", "inicio_reserva", "envio_whatsapp"];
  if (typeof b.tipo !== "string" || !tipos.includes(b.tipo)) return erro("Tipo de evento inválido.");

  const codigo = typeof b.reservaCodigo === "string" && /^TA-[A-Z0-9-]{4,32}$/.test(b.reservaCodigo) ? b.reservaCodigo : null;

  await env.DB
    .prepare("INSERT INTO eventos (ts, tipo, origem, origem_detalhe, sessao, reserva_codigo) VALUES (?,?,?,?,?,?)")
    .bind(new Date().toISOString(), b.tipo, normalizarOrigem(b.origem), normalizarDetalhe(b.origemDetalhe), normalizarSessao(b.sessao), codigo)
    .run();

  return ok({ ok: true });
}

/* ------------------------------ relatórios de violação da CSP ------------------------------

   O navegador manda aqui o que a política (CSP_SITE) bloquearia. Aceita os dois formatos:
   "application/csp-report" ({"csp-report": {...}}) e "application/reports+json" (lista de {type, url, body}).
   Só quatro dados saem do relatório — diretiva, recurso bloqueado SEM query string, caminho da página (sem
   host nem query) e a hora do servidor — e vão para o log do Worker, não para o banco: nenhum dado pessoal
   e nenhuma tabela que possa crescer por spam. Sempre 204. */
function pedacoCsp(valor, max) {
  return typeof valor === "string" ? valor.replace(/[^A-Za-z0-9:/._%@+~=-]/g, "").slice(0, max) : "";
}

function recursoCsp(valor) {
  if (typeof valor !== "string" || !valor) return "";
  if (/^data:/i.test(valor)) return "data";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(valor)) {
    try { const u = new URL(valor); return pedacoCsp(u.origin + u.pathname, 200); } catch { return ""; }
  }
  return pedacoCsp(valor.toLowerCase(), 20); // inline, eval, self, about…
}

function caminhoCsp(valor) {
  if (typeof valor !== "string" || !/^https?:\/\//i.test(valor)) return "";
  try { return pedacoCsp(new URL(valor).pathname, 120); } catch { return ""; }
}

function resumirRelatorioCsp(corpo) {
  const itens = Array.isArray(corpo) ? corpo : [corpo];
  const saida = [];
  for (const item of itens.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const b = item["csp-report"] && typeof item["csp-report"] === "object" ? item["csp-report"] : item.body && typeof item.body === "object" ? item.body : item;
    saida.push({
      diretiva: pedacoCsp(b["effective-directive"] ?? b.effectiveDirective ?? b["violated-directive"] ?? b.violatedDirective, 60).replace(/[^a-z0-9-]/gi, ""),
      bloqueado: recursoCsp(b["blocked-uri"] ?? b.blockedURL ?? b.blockedURI),
      pagina: caminhoCsp(b["document-uri"] ?? b.documentURL ?? b.documentURI ?? item.url)
    });
  }
  return saida;
}

function registrarRelatorioCsp(corpo) {
  for (const r of resumirRelatorioCsp(corpo)) console.log("[csp]", JSON.stringify({ ts: new Date().toISOString(), ...r }));
  return new Response(null, { status: 204 });
}

/* ------------------------------ painel ------------------------------ */

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
function somaDiasISO(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function adminResumo(env) {
  await garantirEsquemaReservas(env);
  const cfg = await lerConfig(env);
  const hoje = hojeSP();
  const fim = somaDiasISO(hoje, 7);
  const agoraISO = new Date().toISOString();

  // A lista do dia mostra todas as não canceladas (a operação precisa ver até a pendente vencida);
  // a agenda de vagas conta só quem segura vaga (pendente vencida não conta).
  const doDia = await env.DB
    .prepare(
      "SELECT hora, plano, pax, status, codigo, nome, telefone FROM reservas " +
      "WHERE data = ? AND status != 'cancelada' ORDER BY hora"
    )
    .bind(hoje)
    .all();

  const proximos = await env.DB
    .prepare(
      "SELECT data, hora, pax, status FROM reservas " +
      "WHERE data >= ?1 AND data <= ?2 AND " + contaNaVaga(3)
    )
    .bind(hoje, fim, agoraISO)
    .all();

  const pendentes = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM reservas WHERE status = 'pendente' AND (expira_em IS NULL OR expira_em > ?1)")
    .bind(agoraISO)
    .first();

  const bloqueios = await env.DB
    .prepare("SELECT id, data, hora, motivo FROM bloqueios WHERE data >= ? ORDER BY data, hora")
    .bind(hoje)
    .all();

  const paxHoje = doDia.results.reduce((s, r) => s + Number(r.pax), 0);
  const receitaHoje = doDia.results.reduce((s, r) => {
    const pl = PLANOS[r.plano];
    return s + (pl ? pl.preco * Number(r.pax) : 0);
  }, 0);

  const agenda = {};
  for (let i = 0; i < 8; i++) {
    const dia = somaDiasISO(hoje, i);
    agenda[dia] = {};
    for (const planoId of Object.keys(PLANOS))
      for (const h of horariosDoPlano(planoId, cfg))
        agenda[dia][String(h)] = { usado: 0, capacidade: cfg.capacidade, bloqueado: false };
  }
  for (const r of proximos.results) {
    if (agenda[r.data] && agenda[r.data][String(r.hora)])
      agenda[r.data][String(r.hora)].usado += Number(r.pax);
  }
  for (const bl of bloqueios.results) {
    if (!agenda[bl.data]) continue;
    if (bl.hora === null) for (const h in agenda[bl.data]) agenda[bl.data][h].bloqueado = true;
    else if (agenda[bl.data][String(bl.hora)]) agenda[bl.data][String(bl.hora)].bloqueado = true;
  }

  return ok({
    ok: true,
    hoje,
    capacidade: cfg.capacidade,
    kpis: {
      reservasHoje: doDia.results.length,
      paxHoje,
      receitaHoje,
      pendentes: Number(pendentes.n)
    },
    reservasHoje: doDia.results,
    agenda,
    bloqueios: bloqueios.results
  });
}

async function adminListarReservas(env, url) {
  await garantirEsquemaReservas(env);
  const status = url.searchParams.get("status");
  const de = url.searchParams.get("de") || "2000-01-01";
  const ate = url.searchParams.get("ate") || "2999-12-31";
  const limite = Math.min(500, Number(url.searchParams.get("limite") || 200));

  let sql =
    "SELECT id, codigo, criado_em, plano, data, hora, pax, nome, telefone, email, obs, " +
    "total, voucher, origem, origem_detalhe, como_conheceu, instagram_cliente, " +
    "seguiu_instagram, status, canal, expira_em FROM reservas WHERE data >= ? AND data <= ?";
  const bind = [de, ate];
  if (status && status !== "todas") { sql += " AND status = ?"; bind.push(status); }
  sql += " ORDER BY data DESC, hora DESC LIMIT ?";
  bind.push(limite);

  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  // Pendente que passou do prazo aparece como "expirada" (só na exibição: o banco continua "pendente").
  const agoraISO = new Date().toISOString();
  for (const r of results) if (r.status === "pendente" && r.expira_em && r.expira_em <= agoraISO) r.status = "expirada";
  return ok({ ok: true, reservas: results });
}

// Código sequencial só das reservas lançadas à mão no painel (as do site usam código aleatório).
const SQL_PROXIMO_CODIGO_MANUAL = "UPDATE config SET valor = CAST(valor AS INTEGER) + 1 WHERE chave = 'proximo_codigo' RETURNING valor";

async function adminCriarReserva(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }
  const plano = PLANOS[b.plano];
  if (!plano || !ehISO(b.data) || !(Number(b.pax) >= 1)) return erro("Dados incompletos.");

  const hora = Number(b.hora);
  const inc = await env.DB
    .prepare(SQL_PROXIMO_CODIGO_MANUAL)
    .first();
  const codigo = "TA-" + (Number(inc.valor) - 1);
  const agora = new Date().toISOString();
  const pax = Math.floor(Number(b.pax));

  await env.DB
    .prepare(
      "INSERT INTO reservas " +
      "(id, codigo, criado_em, plano, data, hora, pax, nome, telefone, email, obs, " +
      "total, voucher, origem, status, canal, atualizado_em) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'balcao', ?, 'manual', ?)"
    )
    .bind(
      crypto.randomUUID(), codigo, agora, b.plano, b.data, hora, pax,
      String(b.nome || "Reserva manual").trim(), String(b.telefone || "").replace(/\D/g, ""),
      b.email || null, String(b.obs || "").slice(0, 500) || null,
      plano.preco * pax, plano.voucher * pax,
      b.status || "confirmada", agora
    )
    .run();

  return ok({ ok: true, codigo });
}

async function adminAtualizarReserva(request, env, id) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }
  const status = ["pendente", "confirmada", "cancelada", "nao_compareceu"];
  if (!status.includes(b.status)) return erro("Status inválido.");

  // Confirmar (ou reativar) uma reserva que não segurava mais a vaga — cancelada ou pendente
  // vencida — só pode se o horário ainda comportar: senão seria overbooking silencioso.
  if (b.status === "confirmada" || b.status === "pendente") {
    await garantirEsquemaReservas(env);
    const agoraISO = new Date().toISOString();
    const atual = await env.DB
      .prepare("SELECT data, hora, pax, status, expira_em FROM reservas WHERE id = ?1")
      .bind(id)
      .first();
    if (!atual) return erro("Reserva não encontrada.", 404);
    const seguravaVaga = atual.status !== "cancelada" && (atual.status !== "pendente" || !atual.expira_em || atual.expira_em > agoraISO);
    if (!seguravaVaga) {
      const cfg = await lerConfig(env);
      const uso = await env.DB
        .prepare(
          "SELECT COALESCE(SUM(pax),0) AS usado FROM reservas WHERE data = ?1 AND hora = ?2 AND id != ?3 AND " + contaNaVaga(4)
        )
        .bind(atual.data, atual.hora, id, agoraISO)
        .first();
      if (Number(uso.usado) + Number(atual.pax) > cfg.capacidade)
        return erro("Esse horário já está lotado: a vaga desta reserva foi liberada. Abra espaço no horário (ou ajuste a capacidade) antes de confirmar.", 409);
    }
  }

  const r = await env.DB
    .prepare("UPDATE reservas SET status = ?, atualizado_em = ? WHERE id = ?")
    .bind(b.status, new Date().toISOString(), id)
    .run();

  if (!r.meta.changes) return erro("Reserva não encontrada.", 404);
  return ok({ ok: true });
}

async function adminListarBloqueios(env) {
  const { results } = await env.DB
    .prepare("SELECT id, data, hora, motivo, criado_em FROM bloqueios WHERE data >= ? ORDER BY data, hora")
    .bind(hojeSP())
    .all();
  return ok({ ok: true, bloqueios: results });
}

async function adminCriarBloqueio(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }
  if (!ehISO(b.data)) return erro("Data inválida.");
  const hora = b.hora === null || b.hora === undefined || b.hora === "" ? null : Number(b.hora);

  await env.DB
    .prepare("INSERT INTO bloqueios (id, data, hora, motivo, criado_em) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), b.data, hora, String(b.motivo || "").slice(0, 120) || null, new Date().toISOString())
    .run();

  return ok({ ok: true });
}

async function adminRemoverBloqueio(env, id) {
  await env.DB.prepare("DELETE FROM bloqueios WHERE id = ?").bind(id).run();
  return ok({ ok: true });
}

async function adminOrigem(env, url) {
  const dias = Math.min(365, Number(url.searchParams.get("dias") || 30));
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const porOrigem = await env.DB
    .prepare(
      "SELECT origem, COUNT(*) AS n, COALESCE(SUM(pax),0) AS pax, COALESCE(SUM(total),0) AS receita " +
      "FROM reservas WHERE criado_em > ? GROUP BY origem ORDER BY n DESC"
    )
    .bind(desde)
    .all();

  const funil = await env.DB
    .prepare(
      "SELECT tipo, COUNT(DISTINCT sessao) AS sessoes, COUNT(*) AS eventos " +
      "FROM eventos WHERE ts > ? GROUP BY tipo"
    )
    .bind(desde)
    .all();

  const instagram = await env.DB
    .prepare(
      "SELECT codigo, data, nome, instagram_cliente, seguiu_instagram, status FROM reservas " +
      "WHERE criado_em > ? AND instagram_cliente IS NOT NULL ORDER BY criado_em DESC LIMIT 100"
    )
    .bind(desde)
    .all();

  const confirmadas = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM reservas WHERE criado_em > ? AND status = 'confirmada'")
    .bind(desde)
    .first();

  return ok({
    ok: true,
    dias,
    porOrigem: porOrigem.results,
    funil: funil.results,
    confirmadas: Number(confirmadas.n),
    instagram: instagram.results
  });
}

async function adminLerConfig(env) {
  const { results } = await env.DB.prepare("SELECT chave, valor FROM config").all();
  const c = {};
  for (const r of results) c[r.chave] = r.valor;
  return ok({ ok: true, config: c });
}

async function adminGravarConfig(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }
  const permitidas = new Set([
    "capacidade", "slot_inicio", "slot_fim", "saida_apos", "cancelamento_h", "retorno_limite",
    "whatsapp", "instagram", "cupom", "beneficio_instagram"
  ]);
  const stmts = [];
  for (const [k, v] of Object.entries(b || {})) {
    if (!permitidas.has(k)) continue;
    // Vazio é permitido: lerConfig() volta ao padrão (RETORNO_LIMITE_PADRAO).
    if (k === "retorno_limite" && String(v).trim() && !/^\d{1,2}:\d{2}$/.test(String(v).trim())) {
      return erro("Retorno até: use o formato HH:MM, por exemplo 18:20.");
    }
    stmts.push(
      env.DB.prepare("INSERT INTO config (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = ?")
        .bind(k, String(v), String(v))
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return ok({ ok: true });
}

// Exportadas só para os testes de testes/ (o Pages usa apenas o export default).
export { expiraEm, normalizarTelefone, conferirData, validarReserva, verificarTurnstile, resumirRelatorioCsp };

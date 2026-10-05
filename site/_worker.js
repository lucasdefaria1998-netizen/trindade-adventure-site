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
const erro = (mensagem, status = 400) =>
  new Response(JSON.stringify({ ok: false, erro: mensagem }), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
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
      return erro("Erro interno: " + (e && e.message ? e.message : String(e)), 500);
    }
  }
};

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

const EXTENSAO = /\.[a-z0-9]{1,8}$/i;
const SEM_CACHE = "no-cache";

async function servirSite(request, env, url) {
  const p = url.pathname;
  const metodo = request.method;
  if (metodo !== "GET" && metodo !== "HEAD") return env.ASSETS.fetch(request);

  // O painel tem página e login próprios (Cloudflare Access); passa direto.
  if (p === "/admin" || p.startsWith("/admin/") || p === "/admin.html") return env.ASSETS.fetch(request);

  if (EXTENSAO.test(p) || p.startsWith("/assets/") || p.startsWith("/vendor/")) {
    return servirArquivo(request, env, p);
  }

  // /passeios/ e /passeios são o mesmo endereço: fica um só, sem barra no fim.
  if (p.length > 1 && p.endsWith("/")) {
    return Response.redirect(url.origin + p.replace(/\/+$/, "") + url.search, 301);
  }

  return servirPagina(request, env, url);
}

async function servirArquivo(request, env, p) {
  const r = await env.ASSETS.fetch(request);
  const tipo = r.headers.get("content-type") || "";
  const pediuHTML = /\.html?$/i.test(p);
  // Segunda trava: mesmo que um deploy saia sem o 404.html e o Pages volte a
  // responder o index.html no lugar de um arquivo, isso não chega ao visitante.
  const ehFallbackDaSPA = r.status === 200 && !pediuHTML && tipo.includes("text/html");
  if (r.status === 404 || ehFallbackDaSPA) return arquivoNaoEncontrado(r);
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
  return aplicarMetadados(resposta, meta, !pagina);
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

function aplicarMetadados(resposta, m, naoEncontrada) {
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

  // Sem JavaScript, a seção "não encontrada" fica escondida em todas as
  // páginas; numa resposta 404 ela precisa aparecer.
  if (naoEncontrada) {
    rw = rw.on('[data-secao="nao-encontrada"]', { element(el) { el.removeAttribute("hidden"); } });
  }
  return rw.transform(resposta);
}

/* ------------------------------ roteador ------------------------------ */

async function rotearAPI(request, env, url) {
  const p = url.pathname;
  const metodo = request.method;

  if (p === "/api/disponibilidade" && metodo === "GET") return disponibilidade(env, url);
  if (p === "/api/reservas" && metodo === "POST") return criarReserva(request, env);
  if (p === "/api/eventos" && metodo === "POST") return registrarEvento(request, env);

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
    instagram: c.instagram || "trindadeadventurerj",
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

/* ------------------------------ disponibilidade ------------------------------ */

async function disponibilidade(env, url) {
  const data = url.searchParams.get("data");
  if (!ehISO(data)) return erro("Data inválida.");

  const cfg = await lerConfig(env);

  const usados = await env.DB
    .prepare(
      "SELECT hora, COALESCE(SUM(pax),0) AS usado FROM reservas " +
      "WHERE data = ? AND status != 'cancelada' GROUP BY hora"
    )
    .bind(data)
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

/* ------------------------------ criar reserva ------------------------------ */

async function criarReserva(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }

  const cfg = await lerConfig(env);
  const plano = PLANOS[b.plano];
  const e = {};

  if (!plano) e.plano = "Escolha um passeio.";
  const emTrindade = agoraEmTrindade();
  if (!ehISO(b.data)) e.data = "Data inválida.";
  else if (b.data < emTrindade.data) e.data = "A data já passou.";

  const hora = Number(b.hora);
  const horasOk = plano ? horariosDoPlano(b.plano, cfg) : [];
  if (!horasOk.includes(hora)) e.hora = "Horário indisponível para este passeio.";
  else if (b.data === emTrindade.data && Math.round(hora * 60) <= emTrindade.minuto) e.hora = "Esse horário já passou.";

  const pax = Math.floor(Number(b.pax));
  if (!(pax >= 1 && pax <= cfg.capacidade)) e.pax = "Número de pessoas inválido.";

  const nome = String(b.nome || "").trim();
  if (nome.length < 3) e.nome = "Informe o nome completo.";

  const telefone = String(b.telefone || "").replace(/\D/g, "");
  if (telefone.length < 10 || telefone.length > 13) e.telefone = "Telefone com DDD inválido.";

  const email = String(b.email || "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = "E-mail inválido.";

  if (Object.keys(e).length) return ok({ ok: false, erros: e }, 422);

  // Guarda simples contra spam: no máximo 5 pedidos por telefone em 24 h.
  const recentes = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM reservas WHERE telefone = ? AND criado_em > ?")
    .bind(telefone, new Date(Date.now() - 86400000).toISOString())
    .first();
  if (recentes && Number(recentes.n) >= 5)
    return erro("Muitos pedidos deste telefone hoje. Fale com a operação pelo WhatsApp.", 429);

  // Vaga: confere de novo agora, no servidor.
  const dispRow = await env.DB
    .prepare("SELECT COALESCE(SUM(pax),0) AS usado FROM reservas WHERE data = ? AND hora = ? AND status != 'cancelada'")
    .bind(b.data, hora)
    .first();
  const bloqRow = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM bloqueios WHERE data = ? AND (hora = ? OR hora IS NULL)")
    .bind(b.data, hora)
    .first();

  const usado = Number(dispRow.usado || 0);
  const restam = cfg.capacidade - usado;
  if (Number(bloqRow.n) > 0) return ok({ ok: false, motivo: "bloqueado", restam: 0 }, 409);
  if (pax > restam) return ok({ ok: false, motivo: "cheio", restam: Math.max(0, restam) }, 409);

  // Código sequencial, incrementado de forma atômica.
  const inc = await env.DB
    .prepare("UPDATE config SET valor = CAST(valor AS INTEGER) + 1 WHERE chave = 'proximo_codigo' RETURNING valor")
    .first();
  const numero = Number(inc.valor) - 1;
  const codigo = "TA-" + numero;

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  const total = plano.preco * pax;
  const voucher = plano.voucher * pax;
  const origem = normalizarOrigem(b.origem);
  const seguiu = b.seguiuInstagram ? 1 : 0;
  const igCliente = String(b.instagramCliente || "").trim().replace(/^@+/, "").slice(0, 60);

  await env.DB
    .prepare(
      "INSERT INTO reservas " +
      "(id, codigo, criado_em, plano, data, hora, pax, nome, telefone, email, obs, " +
      "total, voucher, origem, origem_detalhe, como_conheceu, instagram_cliente, " +
      "seguiu_instagram, status, canal, atualizado_em) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pendente', 'site', ?)"
    )
    .bind(
      id, codigo, agora, b.plano, b.data, hora, pax, nome, telefone, email || null,
      String(b.obs || "").trim().slice(0, 500) || null, total, voucher, origem,
      String(b.origemDetalhe || "").slice(0, 200) || null,
      String(b.comoConheceu || "").slice(0, 120) || null,
      igCliente || null, seguiu, agora
    )
    .run();

  await env.DB
    .prepare("INSERT INTO eventos (ts, tipo, origem, origem_detalhe, sessao, reserva_codigo) VALUES (?,?,?,?,?,?)")
    .bind(agora, "reserva_criada", origem, String(b.origemDetalhe || "").slice(0, 200) || null,
      String(b.sessao || "").slice(0, 40) || null, codigo)
    .run();

  const mensagem = montarMensagem({
    codigo, plano, data: b.data, hora, pax, nome, telefone, email, obs: b.obs,
    total, voucher, origem, origemDetalhe: b.origemDetalhe, comoConheceu: b.comoConheceu,
    igCliente, seguiu, cfg
  });

  return ok({
    ok: true,
    codigo,
    restam: restam - pax,
    whatsapp: "https://wa.me/" + cfg.whatsapp + "?text=" + encodeURIComponent(mensagem),
    mensagem
  });
}

function normalizarOrigem(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("instagram")) return "instagram";
  if (s.startsWith("google")) return "google";
  if (s.startsWith("facebook")) return "facebook";
  if (s.startsWith("link:")) return s.slice(0, 60);
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

async function registrarEvento(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }

  const tipos = ["visita", "inicio_reserva", "envio_whatsapp"];
  if (!tipos.includes(b.tipo)) return erro("Tipo de evento inválido.");

  await env.DB
    .prepare("INSERT INTO eventos (ts, tipo, origem, origem_detalhe, sessao, reserva_codigo) VALUES (?,?,?,?,?,?)")
    .bind(
      new Date().toISOString(),
      b.tipo,
      normalizarOrigem(b.origem),
      String(b.origemDetalhe || "").slice(0, 200) || null,
      String(b.sessao || "").slice(0, 40) || null,
      String(b.reservaCodigo || "").slice(0, 20) || null
    )
    .run();

  return ok({ ok: true });
}

/* ------------------------------ painel ------------------------------ */

const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
function somaDiasISO(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function adminResumo(env) {
  const cfg = await lerConfig(env);
  const hoje = hojeSP();
  const fim = somaDiasISO(hoje, 7);

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
      "WHERE data >= ? AND data <= ? AND status != 'cancelada'"
    )
    .bind(hoje, fim)
    .all();

  const pendentes = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM reservas WHERE status = 'pendente'")
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
  const status = url.searchParams.get("status");
  const de = url.searchParams.get("de") || "2000-01-01";
  const ate = url.searchParams.get("ate") || "2999-12-31";
  const limite = Math.min(500, Number(url.searchParams.get("limite") || 200));

  let sql =
    "SELECT id, codigo, criado_em, plano, data, hora, pax, nome, telefone, email, obs, " +
    "total, voucher, origem, origem_detalhe, como_conheceu, instagram_cliente, " +
    "seguiu_instagram, status, canal FROM reservas WHERE data >= ? AND data <= ?";
  const bind = [de, ate];
  if (status && status !== "todas") { sql += " AND status = ?"; bind.push(status); }
  sql += " ORDER BY data DESC, hora DESC LIMIT ?";
  bind.push(limite);

  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  return ok({ ok: true, reservas: results });
}

async function adminCriarReserva(request, env) {
  let b;
  try { b = await request.json(); } catch { return erro("Corpo inválido."); }
  const plano = PLANOS[b.plano];
  if (!plano || !ehISO(b.data) || !(Number(b.pax) >= 1)) return erro("Dados incompletos.");

  const hora = Number(b.hora);
  const inc = await env.DB
    .prepare("UPDATE config SET valor = CAST(valor AS INTEGER) + 1 WHERE chave = 'proximo_codigo' RETURNING valor")
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

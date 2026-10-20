/* ===========================================================================
   Trindade Adventure — comportamento do site

   O conteúdo do site está escrito em HTML, não aqui. Este arquivo só acrescenta
   o que exige JavaScript: navegação por rota, tempo e mar ao vivo, o montador
   de reserva que abre o WhatsApp, o mapa e as ilustrações das câmeras.

   Consequência de projeto: com o JavaScript desligado o site continua completo
   e legível — todas as seções aparecem empilhadas e o contato é direto.
   =========================================================================== */
"use strict";

document.documentElement.classList.add("js");

/* --------------------------------------------------------------------------
   Configuração da operação.
   Estes são os únicos valores que mudam com frequência. Para alterar preço,
   telefone ou horário de saída, mexa aqui e nos trechos correspondentes do
   index.html (os preços aparecem nos dois lugares de propósito: o HTML é o que
   o Google e o WhatsApp leem).
   -------------------------------------------------------------------------- */
const CFG = {
  whatsapp: "5524993337247",
  instagram: "trindadeadventurerj",
  pontoEncontro: "Praia do Meio — placa das trilhas, Trindade/Paraty",
  slotInicio: 8,      // primeira saída da grade
  slotFim: 15,        // última saída da grade
  saidaApos: 20,      // minutos entre a concentração e a saída efetiva
  // Horário-limite de retorno: um passeio só aparece num horário se terminar
  // até aqui (concentração + saidaApos + duração do plano). É a mesma regra do
  // _worker.js (RETORNO_LIMITE_PADRAO), que é quem vale; quando a API responde,
  // a grade usa os horários que ela devolve. Ver a explicação completa lá.
  retornoLimite: "18:20",
  fuso: "America/Sao_Paulo",
  capacidade: 20,     // tamanho máximo do grupo por horário
  limitePaxPedido: 15, // máximo de pessoas por reserva (o servidor recusa mais: LIMITE_PAX_PEDIDO no _worker.js)
  janelaReservaDias: 90, // reservas de hoje até hoje + 90 dias (JANELA_RESERVA_DIAS no _worker.js)
  cancelamentoH: 12,
  cupom: "TRINDADE10",
  /* Dois pontos de propósito: a previsão de terra é lida na própria vila, e a
     de mar num ponto ao largo. O modelo marinho não responde para coordenada
     em terra firme — se pedíssemos a onda no endereço da vila, voltaria vazio. */
  clima: {
    local: "Trindade",
    lat: -23.35356, lng: -44.72641,   // Praia do Meio, vila de Trindade
    latMar: -23.369, lngMar: -44.702  // ao largo da Ponta da Trindade
  }
};

/* duracaoMin: duração aproximada, contada da saída — entra na regra do
   horário-limite de retorno e no fim do evento do calendário (.ics).
   horarios: saídas fixas (8.5 = 08:30); null = grade geral de hora em hora.
   ultimaSaida (opcional): corta a grade num horário anterior a slotFim. */
const PLANOS = [
  { id:"essencial", nome:"Trindade Essencial", preco:70,  voucher:0,  dur:"≈ 3h", duracaoMin:180, horarios:null,
    resumo:"Trilha guiada pela Mata Atlântica até a piscina natural do Cachadaço, com água mineral." },
  { id:"adventure", nome:"Trindade Adventure", preco:150, voucher:60, dur:"≈ 6h", duracaoMin:360, horarios:null,
    resumo:"Mergulho de snorkel na piscina natural, Pedra que Engole, água mineral e almoço." },
  { id:"boat",      nome:"Trindade Boat",      preco:400, voucher:60, dur:"≈ 8h", duracaoMin:480, horarios:[8.5],
    resumo:"Barco por cinco paradas na costa da Trindade, snorkel na piscina natural e almoço." }
];

const planoPor = id => PLANOS.find(p => p.id === id) || PLANOS[1];

/* ------------------------------ utilidades ------------------------------ */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const BRL = n => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0 });
const doisDig = n => String(n).padStart(2, "0");
/* Data e hora de agora em Trindade, não no relógio do aparelho: um visitante
   em Manaus, em Lisboa ou com o celular em outro fuso veria a grade de
   "já saiu" e o "hoje" errados. Nem UTC: em Paraty (UTC−3) o toISOString()
   vira o dia seguinte depois das 21h. */
function agoraEmTrindade() {
  try {
    const p = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: CFG.fuso, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) + Number(p.minute) / 60 };
  } catch (e) {
    const d = new Date();
    return { data: `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`,
      hora: d.getHours() + d.getMinutes() / 60 };
  }
}
const hojeISO = () => agoraEmTrindade().data;
const somaDias = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`;
};
const dataBR = iso => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
const diaSemana = iso => ["dom","seg","ter","qua","qui","sex","sáb"][new Date(iso + "T12:00:00").getDay()];
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

const horaLabel = h => doisDig(Math.floor(h)) + ":" + doisDig(Math.round((h % 1) * 60));
const saidaLabel = h => {
  const t = Math.round(h * 60) + CFG.saidaApos;
  return doisDig(Math.floor(t / 60) % 24) + ":" + doisDig(t % 60);
};
const minutosDe = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };

// Horários que cada plano aceita, como o servidor devolveu na última consulta
// de vagas (fonte que vale). Fica null enquanto a API não respondeu.
let horariosDoServidor = null;

/* Saídas possíveis de um plano: a lista fixa dele (ou a grade geral) menos as
   que terminariam depois do horário-limite de retorno. Mesma regra do
   _worker.js; nada é escrito à mão por passeio. */
function horariosDoPlano(p) {
  if (horariosDoServidor && Array.isArray(horariosDoServidor[p.id])) {
    return horariosDoServidor[p.id].slice().sort((a, b) => a - b);
  }
  const base = p.horarios
    ? p.horarios.slice()
    : Array.from({ length: CFG.slotFim - CFG.slotInicio + 1 }, (_, i) => CFG.slotInicio + i);
  const limite = minutosDe(CFG.retornoLimite);
  return base
    .filter(h => (p.ultimaSaida == null || h <= p.ultimaSaida) &&
      Math.round(h * 60) + CFG.saidaApos + p.duracaoMin <= limite)
    .sort((a, b) => a - b);
}

/* Faixa de saídas escrita por extenso, nos formatos que o site já usa:
   "h" → "das 8h às 12h", "hhmm" → "de 08:00 às 12:00", "ultima" → "às 12:00". */
function faixaDeHorarios(p, formato) {
  const horas = horariosDoPlano(p);
  if (!horas.length) return "sem saída disponível";
  const curto = h => Math.floor(h) + "h" + (h % 1 ? doisDig(Math.round((h % 1) * 60)) : "");
  const ini = horas[0], fim = horas[horas.length - 1];
  if (formato === "ultima") return "às " + horaLabel(fim);
  if (horas.length === 1) return formato === "h" ? "às " + curto(ini) : "às " + horaLabel(ini);
  return formato === "h"
    ? `das ${curto(ini)} às ${curto(fim)}`
    : `de ${horaLabel(ini)} às ${horaLabel(fim)}`;
}

function pintarFaixasDeHorarios() {
  $$("[data-faixa-horarios]").forEach(el => {
    const p = PLANOS.find(x => x.id === el.dataset.faixaHorarios);
    if (p) el.textContent = faixaDeHorarios(p, el.dataset.formato);
  });
}

const linkWA = texto => `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(texto)}`;

function torrada(msg) {
  $$(".torrada").forEach(t => t.remove());
  const d = document.createElement("div");
  d.className = "torrada";
  d.setAttribute("role", "status");
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

/* Todo link com data-wa recebe a URL do WhatsApp já com a mensagem pronta.
   Por padrão vai para o WhatsApp da operação (CFG.whatsapp) — é o número que
   deve tocar quando o assunto é a Trindade Adventure. Um parceiro (pousada,
   restaurante) tem o próprio WhatsApp: nesse caso o elemento leva também
   data-wa-numero, e a mensagem vai direto para ele, não para a operação. */
function ligarLinksWhatsApp(raiz) {
  $$("[data-wa]", raiz || document).forEach(a => {
    const numero = a.dataset.waNumero || CFG.whatsapp;
    a.href = `https://wa.me/${numero}?text=${encodeURIComponent(a.dataset.wa)}`;
  });
}

/* ==========================================================================
   Origem do visitante e ponte com o backend (_worker.js + D1).

   O site inteiro funciona sem isto no ar: toda chamada passa por chamarAPI(),
   que nunca lança erro — se a rede falhar ou o backend ainda não estiver
   ligado, ela devolve status 0 e quem chamou decide o que fazer. Em todos os
   pontos de uso, "a API não respondeu" cai de volta no comportamento antigo
   (sem disponibilidade real, reserva só por WhatsApp). Nunca é o caminho que
   quebra a página.
   ========================================================================== */

const Origem = {
  CHAVE_SESSAO: "trindade.sessao",
  CHAVE_ORIGEM: "trindade.origem",

  // Um id por navegador, não por pessoa. Serve só para juntar os eventos de
  // uma mesma visita no funil (visitou → abriu reserva → enviou pedido).
  sessao() {
    try {
      let s = localStorage.getItem(this.CHAVE_SESSAO);
      if (!s) { s = crypto.randomUUID().slice(0, 20); localStorage.setItem(this.CHAVE_SESSAO, s); }
      return s;
    } catch (e) { return "sem-sessao"; }
  },

  // Detecta uma vez, na primeira visita, e guarda — assim um clique que veio
  // do Instagram continua contando como Instagram mesmo se a pessoa voltar ao
  // site direto pela barra de endereço dias depois.
  detectar() {
    try {
      const salvo = localStorage.getItem(this.CHAVE_ORIGEM);
      if (salvo) return JSON.parse(salvo);
    } catch (e) {}

    const params = new URLSearchParams(location.search);
    const fonte = params.get("fonte");
    let origem = "direto", detalhe = "";

    if (fonte) {
      origem = "link:" + fonte.slice(0, 40);
      detalhe = fonte;
    } else if (document.referrer) {
      try {
        const host = new URL(document.referrer).host;
        detalhe = host;
        if (/instagram\.com/.test(host)) origem = "instagram";
        else if (/google\./.test(host)) origem = "google";
        else if (/facebook\.com|fb\.com|fb\.me/.test(host)) origem = "facebook";
        else if (/whatsapp\.com/.test(host)) origem = "whatsapp";
        else origem = "outro";
      } catch (e) { origem = "outro"; }
    }

    const dado = { origem, detalhe };
    try { localStorage.setItem(this.CHAVE_ORIGEM, JSON.stringify(dado)); } catch (e) {}
    return dado;
  }
};

/* Um relato do próprio cliente ("como conheceu") só deve sobrepor a detecção
   automática quando ela veio fraca (visita direta ou não reconhecida) — nunca
   apaga um clique de fato rastreado vindo do Instagram ou do Google. */
function origemEfetiva(detectada, comoConheceuValor) {
  const mapa = { instagram: "instagram", google: "google" };
  if ((detectada.origem === "direto" || detectada.origem === "outro") && mapa[comoConheceuValor]) {
    return mapa[comoConheceuValor];
  }
  return detectada.origem;
}
function rotuloComoConheceu(v) {
  return {
    instagram: "Instagram", google: "Busca no Google", indicacao: "Indicação de amigo",
    ja_conhecia: "Já conhecia / morador", outro: "Outro"
  }[v] || "";
}

async function chamarAPI(caminho, opts) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 7000);
    const r = await fetch(caminho, Object.assign(
      { signal: ac.signal, headers: { "content-type": "application/json" } }, opts || {}
    ));
    clearTimeout(t);
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  } catch (e) {
    return { status: 0, corpo: null };
  }
}

/* Dispara um evento de funil sem bloquear nada — o chamador não espera a
   resposta. Perder um evento de analytics não pode atrasar a experiência. */
function evento(tipo, extra) {
  const o = Origem.detectar();
  chamarAPI("/api/eventos", { method: "POST", body: JSON.stringify(Object.assign({
    tipo, origem: o.origem, origemDetalhe: o.detalhe, sessao: Origem.sessao()
  }, extra || {})) });
}

/* ------------------------------ tema ------------------------------ */

const CHAVE_TEMA = "trindade.tema";
(function iniciarTema() {
  let salvo = null;
  try { salvo = localStorage.getItem(CHAVE_TEMA); } catch (e) { /* modo privado */ }
  if (salvo === "dark" || salvo === "light") document.documentElement.setAttribute("data-theme", salvo);

  const btn = $("#btnTema");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const atual = document.documentElement.getAttribute("data-theme");
    const sistemaEscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const proximo = atual ? (atual === "dark" ? "light" : "dark") : (sistemaEscuro ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", proximo);
    try { localStorage.setItem(CHAVE_TEMA, proximo); } catch (e) {}
  });
})();

/* ------------------------------ rotas ------------------------------ */
/* Cada seção é um endereço próprio (/passeios, /passeios/adventure,
   /reservar?plano=boat). O visitante pode mandar o link exato de um roteiro
   pelo WhatsApp, o Google enxerga cada página separada, e o botão "voltar" do
   celular funciona como ele espera.

   Quais endereços existem, e o título, a descrição e a imagem de cada um, vêm
   da tabela "site-config" no <head> do index.html — a mesma que o _worker.js
   usa para entregar a página já com os metadados certos. Aqui só se troca de
   seção sem recarregar e se atualizam as mesmas tags.

   Endereços antigos com "#/" (até setembro de 2026 o site navegava por hash)
   continuam funcionando: são convertidos para o endereço novo na hora,
   sem recarregar. */

const SITE = (() => {
  try { return JSON.parse($("#site-config").textContent); }
  catch (e) { return { origem: location.origin, paginas: { "/": { secao: "inicio" } }, naoEncontrada: { secao: "nao-encontrada" } }; }
})();

const normalizarCaminho = c => (c.length > 1 ? c.replace(/\/+$/, "") : c) || "/";

// Endereços que mudaram de lugar (o servidor responde 301; aqui vale para a navegação sem recarregar
// e para links antigos com "#/"). Mesma tabela do _worker.js (REDIRECIONAMENTOS).
const REDIRECIONAMENTOS = { "/passeios/fishing": "/pescaria" };
const ehPaginaDoSite = c => {
  const n = normalizarCaminho(c);
  return Object.prototype.hasOwnProperty.call(SITE.paginas, n) || Object.prototype.hasOwnProperty.call(REDIRECIONAMENTOS, n);
};

/* "#/passeios?plano=boat" → "/passeios/boat". Devolve true se trocou o endereço. */
function migrarEnderecoAntigo() {
  const h = location.hash;
  if (!h.startsWith("#/")) return false;
  const [nome, q] = h.slice(2).split("?");
  const params = new URLSearchParams(location.search);
  new URLSearchParams(q || "").forEach((v, k) => params.set(k, v));

  let destino;
  if (!nome || nome === "inicio") destino = "/";
  else if (nome === "passeios" && (params.get("plano") || params.get("passeio"))) {
    destino = "/passeios/" + (params.get("plano") || params.get("passeio"));
    params.delete("plano"); params.delete("passeio");
  } else destino = "/" + nome;

  const resto = params.toString().replace(/=(&|$)/g, "$1");
  history.replaceState(null, "", destino + (resto ? "?" + resto : ""));
  return true;
}

function lerRota() {
  let caminho = normalizarCaminho(location.pathname);
  if (Object.prototype.hasOwnProperty.call(REDIRECIONAMENTOS, caminho)) {
    caminho = REDIRECIONAMENTOS[caminho];
    history.replaceState(null, "", caminho + location.search + location.hash);
  }
  const params = new URLSearchParams(location.search);
  const pagina = SITE.paginas[caminho];
  if (!pagina) return { nome: SITE.naoEncontrada.secao, params, pagina: SITE.naoEncontrada, caminho, existe: false };
  const foco = pagina.foco || {};
  if (foco.plano) params.set("plano", foco.plano);
  if (foco.passeio) params.set("passeio", foco.passeio);
  return { nome: pagina.secao, params, pagina, caminho, existe: true };
}

/* Mesma regra do _worker.js (metadadosDaPagina): canonical e imagem
   absolutos; "noindex" para indexar:false e para página inexistente. */
function aplicarMetadados(rota) {
  const p = rota.pagina;
  const indexar = rota.existe && p.indexar !== false;
  const imagem = SITE.origem + (p.imagem || SITE.imagemPadrao);
  const canonical = rota.existe ? SITE.origem + rota.caminho : null;
  const meta = (seletor, valor) => { const el = $(seletor); if (el && valor != null) el.setAttribute("content", valor); };

  if (p.titulo) document.title = p.titulo;
  meta('meta[name="description"]', p.descricao);
  meta('meta[name="robots"]', indexar ? "index,follow" : "noindex,follow");
  meta('meta[property="og:type"]', p.tipoOg || "website");
  meta('meta[property="og:title"]', p.titulo);
  meta('meta[property="og:description"]', p.descricao);
  meta('meta[property="og:image"]', imagem);
  meta('meta[property="og:image:alt"]', p.imagemAlt || SITE.imagemAltPadrao);
  meta('meta[name="twitter:title"]', p.titulo);
  meta('meta[name="twitter:description"]', p.descricao);
  meta('meta[name="twitter:image"]', imagem);

  // Página inexistente não tem canonical nem og:url (o servidor também os tira).
  let link = $('link[rel="canonical"]');
  let ogUrl = $('meta[property="og:url"]');
  if (canonical) {
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    if (!ogUrl) { ogUrl = document.createElement("meta"); ogUrl.setAttribute("property", "og:url"); document.head.appendChild(ogUrl); }
    link.href = canonical;
    ogUrl.setAttribute("content", canonical);
  } else {
    link?.remove();
    ogUrl?.remove();
  }
}

/* Um <h1> por página, também ao navegar sem recarregar. O servidor já entrega a página certa
   (ver reescreverTitulos no _worker.js); aqui se repete a regra a cada troca de rota: o título
   da seção ativa — ou o nome do passeio, em /passeios/<passeio> — vira h1 e os demais h2/h3.
   Só a tag muda; classes, ids e atributos (aria-labelledby) seguem os mesmos. */
function trocarTag(el, tag) {
  if (!el || el.tagName.toLowerCase() === tag) return el;
  const novo = document.createElement(tag);
  for (const a of el.attributes) novo.setAttribute(a.name, a.value);
  while (el.firstChild) novo.appendChild(el.firstChild);
  el.replaceWith(novo);
  return novo;
}
function ajustarH1(rota) {
  const foco = (rota.pagina && rota.pagina.foco) || {};
  const idFoco = foco.plano ? "roteiro-" + foco.plano : foco.passeio ? "consulta-" + foco.passeio : null;
  const alvo = idFoco
    ? document.querySelector("#" + idFoco + " [data-titulo-foco]")
    : document.querySelector('[data-secao="' + rota.nome + '"] [data-titulo]');
  document.querySelectorAll("[data-titulo]").forEach(h => { if (h !== alvo) trocarTag(h, "h2"); });
  document.querySelectorAll("[data-titulo-foco]").forEach(h => { if (h !== alvo) trocarTag(h, h.closest(".painel-roteiro") ? "h2" : "h3"); });
  if (alvo) trocarTag(alvo, "h1");
}

/* O que só serve a uma página (mapa dos roteiros, formulário de reserva, câmeras) é montado quando
   a rota é aberta; o resto é montado em tempo ocioso, para quem navegar já encontrar pronto. Cada
   montagem roda uma vez. Antes, tudo isso rodava na carga de qualquer página (tarefa longa na home). */
const MONTAGENS = {
  passeios: [prepararMapa],
  reservar: [ligarReserva],
  cameras: [desenharCameras, ligarRelogios]
};
const montadas = new Set();
function montar(nome) {
  if (montadas.has(nome) || !MONTAGENS[nome]) return;
  montadas.add(nome);
  MONTAGENS[nome].forEach(fn => fn());
}
function montarOsDemais() {
  const fila = Object.keys(MONTAGENS);
  const proxima = () => {
    const nome = fila.shift();
    if (!nome) return;
    montar(nome);
    agendarOcioso(proxima);
  };
  agendarOcioso(proxima);
}
function agendarOcioso(fn) {
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 2500 });
  else setTimeout(fn, 300);
}

function aplicarRota(rolarTopo) {
  const rota = lerRota();
  const { nome, params } = rota;
  montar(nome);
  window.dispatchEvent(new Event("trindade:before-route"));

  $$("[data-secao]").forEach(s => { s.hidden = s.dataset.secao !== nome; });
  ajustarH1(rota);
  $$("[data-rota]").forEach(a => {
    if (a.dataset.rota === nome) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  aplicarMetadados(rota);
  fecharMenu();

  const plano = params.get("plano");
  if (plano && planoPor(plano).id === plano) {
    if (nome === "passeios") mostrarRoteiro(plano);
    if (nome === "reservar") { reserva.plano = plano; desenharReserva(); }
  }

  // Um evento só por sessão: entrar e sair da aba de reserva várias vezes não
  // deveria inflar o "abriram reserva" do funil no painel.
  // O script do desafio anti-robô só é baixado na página de reserva.
  if (nome === "reservar") Turnstile.carregar();

  if (nome === "reservar" && !aplicarRota.jaAbriuReserva) {
    aplicarRota.jaAbriuReserva = true;
    evento("inicio_reserva");
  }

  if (rolarTopo !== false) window.scrollTo({ top: 0, behavior: "instant" });
  window.dispatchEvent(new Event("trindade:route"));

  // Links que apontam para um ponto da página: o passo de data da reserva,
  // a aba do roteiro, um passeio sob consulta ou o catálogo da abertura.
  let alvo = null;
  if (plano && planoPor(plano).id === plano) {
    if (nome === "reservar") alvo = "passoData";
    if (nome === "passeios") alvo = "roteiro-" + plano;
  }
  if (nome === "passeios" && params.get("passeio")) alvo = "consulta-" + params.get("passeio");
  if (nome === "inicio" && params.has("catalogo")) alvo = "roteiros-inicio";
  if (alvo) requestAnimationFrame(() => {
    const el = document.getElementById(alvo);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "instant" });
    if (nome === "reservar") $('#listaDatas [aria-pressed="true"]')?.focus({ preventScroll: true });
  });
}

/* Troca de página sem recarregar. Mesmo endereço = reaplica a rota (volta ao
   topo), como antes acontecia ao clicar no link da página em que já se está. */
function navegar(destino, substituir) {
  if (destino !== location.pathname + location.search) {
    history[substituir ? "replaceState" : "pushState"](null, "", destino);
  }
  aplicarRota(true);
}

/* Rolagem pedida pelo site. Usa o motion.js quando ele estiver ligado (rolagem
   suave coordenada); sem ele, a rolagem nativa do navegador. */
function rolarAte(el) {
  if (!el) return;
  if (window.trindadeRolar) window.trindadeRolar(el);
  else el.scrollIntoView({ block: "start", behavior: "smooth" });
}

window.addEventListener("popstate", () => aplicarRota(true));
window.addEventListener("hashchange", () => { if (migrarEnderecoAntigo()) aplicarRota(true); });
document.addEventListener("click", e => {
  // Botão que leva a um ponto da mesma página (ex.: "Ver os 7 passeios").
  const atalho = e.target.closest("[data-rolar]");
  if (atalho && lerRota().nome === "inicio") {
    e.preventDefault();
    rolarAte(document.getElementById(atalho.dataset.rolar));
    return;
  }

  // Link para outra página do site: troca de seção sem recarregar. Clique com
  // Ctrl/Cmd/Shift ou botão do meio continua abrindo nova aba, como o
  // visitante espera; links externos e de âncora (#conteudo) seguem normais.
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest("a[href]");
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !ehPaginaDoSite(url.pathname)) return;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
  e.preventDefault();
  navegar(normalizarCaminho(url.pathname) + url.search);
});

/* Menu no celular e no tablet: painel sob o topo, com fundo que fecha ao
   toque, Esc para sair e foco devolvido ao botão. */
function fecharMenu() {
  const botao = $("#btnMenu");
  if (!botao || botao.getAttribute("aria-expanded") !== "true") return;
  botao.setAttribute("aria-expanded", "false");
  $(".topbar-in")?.removeAttribute("data-menu-open");
  $("#menuFundo").hidden = true;
  document.documentElement.classList.remove("menu-aberto");
  window.dispatchEvent(new CustomEvent("trindade:menu", { detail: { aberto: false } }));
}
function abrirMenu() {
  const botao = $("#btnMenu");
  botao.setAttribute("aria-expanded", "true");
  $(".topbar-in").setAttribute("data-menu-open", "");
  $("#menuFundo").hidden = false;
  document.documentElement.classList.add("menu-aberto");
  window.dispatchEvent(new CustomEvent("trindade:menu", { detail: { aberto: true } }));
  ($('#menuPrincipal a[aria-current="page"]') || $("#menuPrincipal a"))?.focus();
}
function ligarMenu() {
  const botao = $("#btnMenu");
  const menu = $("#menuPrincipal");
  if (!botao || !menu) return;
  botao.addEventListener("click", () => {
    if (botao.getAttribute("aria-expanded") === "true") fecharMenu(); else abrirMenu();
  });
  $("#menuFundo")?.addEventListener("click", fecharMenu);
  menu.addEventListener("click", e => { if (e.target.closest("a[data-rota]")) fecharMenu(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && botao.getAttribute("aria-expanded") === "true") { fecharMenu(); botao.focus(); }
  });
  // Ao voltar para a largura de desktop, o painel não pode ficar preso aberto.
  matchMedia("(min-width: 1041px)").addEventListener("change", ev => { if (ev.matches) fecharMenu(); });
}

/* ------------------------------ abas de roteiro ------------------------------ */

function mostrarRoteiro(id) {
  $$("[data-aba]").forEach(b => {
    const ativo = b.dataset.aba === id;
    b.setAttribute("aria-selected", ativo ? "true" : "false");
    b.tabIndex = ativo ? 0 : -1;
  });
  $$(".painel-roteiro").forEach(p => { p.hidden = p.id !== "roteiro-" + id; });
  window.dispatchEvent(new Event("trindade:panel"));
}

$$("[data-aba]").forEach(b => {
  b.addEventListener("click", () => {
    mostrarRoteiro(b.dataset.aba);
    // Endereço e metadados do roteiro escolhido, sem empilhar no histórico.
    const destino = "/passeios/" + b.dataset.aba;
    if (location.pathname !== destino) {
      history.replaceState(null, "", destino);
      const rota = lerRota();
      aplicarMetadados(rota);
      ajustarH1(rota); // o título da página acompanha a aba (S12)
    }
  });
  // Setas do teclado trocam de aba, como o padrão de abas do WAI-ARIA.
  b.addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const abas = $$("[data-aba]");
    const prox = abas[(abas.indexOf(b) + (e.key === "ArrowRight" ? 1 : -1) + abas.length) % abas.length];
    prox.focus(); prox.click();
  });
});

/* ==========================================================================
   Tempo e mar da Ponta da Trindade, ao vivo.

   Fonte: Open-Meteo (open-meteo.com) — sem chave, CORS liberado, gratuito para
   uso não comercial até 10 mil chamadas por dia, dados em CC BY 4.0. A menção
   no rodapé é exigida pela licença: não remova.

   Duas chamadas em paralelo: previsão (temperatura, vento, chuva, UV) e marinha
   (altura e período de onda). A marinha pode não cobrir o ponto — nesse caso a
   barra mostra o resto e omite a onda, sem quebrar. A leitura é defensiva de
   propósito: campo ausente derruba só aquele indicador, nunca a página.
   ========================================================================== */

const WMO = {
  0:["Céu limpo","sol"], 1:["Predomínio de sol","sol"], 2:["Parcialmente nublado","nuvem"],
  3:["Nublado","nuvem"], 45:["Névoa","nevoa"], 48:["Névoa com geada","nevoa"],
  51:["Garoa fraca","chuva"], 53:["Garoa","chuva"], 55:["Garoa forte","chuva"],
  56:["Garoa congelante","chuva"], 57:["Garoa congelante forte","chuva"],
  61:["Chuva fraca","chuva"], 63:["Chuva","chuva"], 65:["Chuva forte","chuva"],
  66:["Chuva congelante","chuva"], 67:["Chuva congelante forte","chuva"],
  71:["Neve fraca","neve"], 73:["Neve","neve"], 75:["Neve forte","neve"], 77:["Grãos de neve","neve"],
  80:["Pancadas fracas","chuva"], 81:["Pancadas de chuva","chuva"], 82:["Pancadas fortes","chuva"],
  85:["Pancadas de neve","neve"], 86:["Pancadas de neve fortes","neve"],
  95:["Trovoada","tempestade"], 96:["Trovoada com granizo","tempestade"], 99:["Trovoada com granizo","tempestade"]
};

const ICO = {
  sol:'<circle cx="12" cy="12" r="4.6"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
  nuvem:'<path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .4-7.57 5.6 5.6 0 0 0-10.85-1.2A4.2 4.2 0 0 0 7.5 18.5z"/>',
  chuva:'<path d="M7.6 15.4h8.8a3.6 3.6 0 0 0 .4-7.18 5.4 5.4 0 0 0-10.4-1.1A4 4 0 0 0 7.6 15.4z"/><path d="M9 18.4l-1 2.4M13 18.4l-1 2.4M17 18.4l-1 2.4"/>',
  tempestade:'<path d="M7.6 15.4h8.8a3.6 3.6 0 0 0 .4-7.18 5.4 5.4 0 0 0-10.4-1.1A4 4 0 0 0 7.6 15.4z"/><path d="M13 17l-3 3.4h3l-1.4 3"/>',
  nevoa:'<path d="M4 9.5h16M6 13h12M4 16.5h16"/>',
  neve:'<path d="M7.6 14.4h8.8a3.6 3.6 0 0 0 .4-7.18 5.4 5.4 0 0 0-10.4-1.1A4 4 0 0 0 7.6 14.4z"/><path d="M9.5 18h.01M13 20h.01M16.5 18h.01"/>',
  onda:'<path d="M2.5 15q3.2-3 6.4 0t6.4 0 6.2-1"/><path d="M2.5 19.5q3.2-3 6.4 0t6.4 0 6.2-1"/>',
  vento:'<path d="M3 8.5h10.5a2.8 2.8 0 1 0-2.8-2.8"/><path d="M3 13h14a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3 17.5h7"/>',
  uv:'<circle cx="12" cy="13" r="3.4"/><path d="M12 5.4v1.8M5.6 13h1.8M16.6 13h1.8M7.2 8.2l1.3 1.3M15.5 9.5l1.3-1.3M4 20h16"/>',
  termo:'<path d="M14 14.2V5.6a2 2 0 1 0-4 0v8.6a3.6 3.6 0 1 0 4 0z"/><path d="M12 8.6v6"/>',
  porsol:'<circle cx="12" cy="12.4" r="3.6"/><path d="M12 5.6v1.6M6.4 12.4H4.8M19.2 12.4h-1.6M7.6 8l1.2 1.2M15.2 9.2L16.4 8"/><path d="M3.5 18.4h17"/>'
};
const ico = (k, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
  + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k] || ICO.nuvem}</svg>`;

const numero = v => (typeof v === "number" && isFinite(v)) ? v : null;

/* Saída segura no DOM: todo texto que NÃO é constante deste arquivo (resposta de
   API, localStorage, parâmetro da URL) passa por esc() antes de ir para um
   innerHTML, e número vindo de fora passa por numero()/inteiroSeguro(). */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inteiroSeguro = (v, padrao = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : padrao; };
const HHMM = /^\d{2}:\d{2}$/;
const CODIGO_PEDIDO = /^TA-[A-Z0-9-]{4,32}$/;

/* Só o link do WhatsApp da operação é aceito vindo do servidor (https://wa.me/<número fixo>);
   qualquer outra coisa — javascript:, outro host, outro número — vira o link montado aqui. */
function waHrefSeguro(href, alternativa) {
  try {
    const u = new URL(href);
    if (u.protocol === "https:" && u.origin === "https://wa.me" && u.pathname === "/" + CFG.whatsapp && !u.username && !u.password) return u.href;
  } catch (e) { /* URL inválida */ }
  return alternativa;
}

/* Dados do clima, venham da API ou do localStorage (que qualquer um edita): reconstrói só com
   número, textos conhecidos e horários HH:MM. O que não passa vira "sem dado". */
function climaSeguro(d) {
  if (!d || typeof d !== "object") return null;
  const temp = numero(d.temp);
  if (temp === null) return null;
  const textosConhecidos = new Set([...Object.values(WMO).map(v => v[0]), "Tempo indefinido"]);
  return {
    temp,
    sensacao: numero(d.sensacao), vento: numero(d.vento), dia: d.dia === true,
    texto: textosConhecidos.has(d.texto) ? d.texto : "Tempo indefinido",
    icone: Object.hasOwn(ICO, d.icone) ? d.icone : "nuvem",
    chuvaProb: numero(d.chuvaProb), uv: numero(d.uv), maxima: numero(d.maxima), minima: numero(d.minima),
    por: typeof d.por === "string" && HHMM.test(d.por) ? d.por : "",
    onda: numero(d.onda),
    hora: typeof d.hora === "string" && HHMM.test(d.hora) ? d.hora : ""
  };
}

const Clima = {
  estado: "idle",
  dados: null,
  erro: "",
  TTL: 15 * 60 * 1000,
  CHAVE: "trindade.clima",

  doCache() {
    try {
      const bruto = localStorage.getItem(this.CHAVE);
      if (!bruto) return null;
      const o = JSON.parse(bruto);
      if (!o || typeof o.ts !== "number" || Date.now() - o.ts > this.TTL) return null;
      const dados = climaSeguro(o.dados);
      return dados ? { ts: o.ts, dados } : null;
    } catch (e) { return null; }
  },

  async json(url, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  },

  async carregar(forcar) {
    if (this.estado === "carregando") return;
    if (!forcar) {
      const c = this.doCache();
      if (c) { this.dados = c.dados; this.estado = "ok"; this.pintar(); return; }
    }
    this.estado = "carregando"; this.erro = ""; this.pintar();

    const fuso = "&timezone=America%2FSao_Paulo";
    const uPrev = "https://api.open-meteo.com/v1/forecast?"
      + `latitude=${CFG.clima.lat}&longitude=${CFG.clima.lng}` + fuso
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset"
      + "&forecast_days=2";
    const uMar = "https://marine-api.open-meteo.com/v1/marine?"
      + `latitude=${CFG.clima.latMar}&longitude=${CFG.clima.lngMar}` + fuso
      + "&current=wave_height,wave_period";

    const [prev, mar] = await Promise.allSettled([this.json(uPrev, 9000), this.json(uMar, 9000)]);

    if (prev.status !== "fulfilled") {
      this.estado = "erro";
      this.erro = /abort/i.test(String(prev.reason))
        ? "A previsão demorou demais para responder."
        : "Não consegui falar com o serviço de previsão.";
      this.pintar();
      return;
    }

    const j = prev.value || {};
    const c = j.current || {};
    const d = j.daily || {};
    const temp = numero(c.temperature_2m);
    if (temp === null) {
      this.estado = "erro";
      this.erro = "A previsão respondeu num formato que eu não reconheci.";
      this.pintar();
      return;
    }

    const [txt, icone] = WMO[numero(c.weather_code)] || ["Tempo indefinido", "nuvem"];
    const m = (mar.status === "fulfilled" && mar.value && mar.value.current) ? mar.value.current : {};

    this.dados = climaSeguro({
      temp,
      sensacao: numero(c.apparent_temperature),
      vento: numero(c.wind_speed_10m),
      dia: c.is_day === 1 || c.is_day === true,
      texto: txt, icone,
      chuvaProb: Array.isArray(d.precipitation_probability_max) ? numero(d.precipitation_probability_max[0]) : null,
      uv: Array.isArray(d.uv_index_max) ? numero(d.uv_index_max[0]) : null,
      maxima: Array.isArray(d.temperature_2m_max) ? numero(d.temperature_2m_max[0]) : null,
      minima: Array.isArray(d.temperature_2m_min) ? numero(d.temperature_2m_min[0]) : null,
      por: Array.isArray(d.sunset) ? String(d.sunset[0] || "").slice(11, 16) : "",
      onda: numero(m.wave_height),
      hora: String(c.time || "").slice(11, 16)
    });
    this.estado = "ok";
    try { localStorage.setItem(this.CHAVE, JSON.stringify({ ts: Date.now(), dados: this.dados })); } catch (e) {}
    this.pintar();
  },

  /* Indicação para o visitante. Não decide nada: quem decide é o guia no dia. */
  parecer(d) {
    if (d.onda !== null && d.onda >= 2.0) return ["bad", "Mar grosso — barco provavelmente não sai"];
    if (d.chuvaProb !== null && d.chuvaProb >= 80) return ["warn", "Chance alta de chuva — confirme antes de sair de casa"];
    if (d.vento !== null && d.vento >= 45) return ["warn", "Vento forte — o guia pode alterar o roteiro"];
    if (d.onda !== null && d.onda >= 1.4) return ["warn", "Mar mexido — parada de snorkel pode mudar"];
    return ["ok", "Condição boa para trilha e barco"];
  },

  pintar() {
    const el = $("#climaBar");
    if (!el) return;
    el.setAttribute("aria-busy", String(this.estado === "carregando"));
    el.innerHTML = this.markup();
    window.dispatchEvent(new Event("trindade:weather"));
    const b = $("[data-recarregar]", el);
    if (b) b.onclick = () => this.carregar(true);
  },

  /* Faixa de rodapé: uma linha só, discreta. É informação de apoio para quem
     está decidindo o dia — não precisa competir com a chamada da página. */
  markup() {
    const local = CFG.clima.local;

    if (this.estado === "carregando" || this.estado === "idle") {
      return `<div class="clima-skeleton" role="status"><span class="sr">Consultando tempo e mar de ${local}…</span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>`;
    }
    if (this.estado === "erro") {
      return `<div class="clima-faixa">
        <span class="clima-local">${local}: tempo e mar indisponíveis agora.</span>
        <button class="clima-acao" type="button" data-recarregar>Tentar de novo</button>
      </div>`;
    }

    const d = this.dados;
    const [nivel, recado] = this.parecer(d);
    const item = (k, valor, rot) => `<li>${ico(k, 14)}<b class="num">${esc(valor)}</b> ${esc(rot)}</li>`;

    return `<div class="clima-faixa">
      <span class="clima-agora">${ico(d.icone, 18)}<b class="num">${Math.round(d.temp)}°</b>
        <span>${esc(d.texto)}</span><span class="clima-local">· ${esc(local)} agora</span></span>
      <span class="ponto-${nivel}">${esc(recado)}</span>
      <ul class="clima-dados" aria-label="Detalhes do tempo e do mar">
        ${d.vento !== null ? item("vento", Math.round(d.vento) + " km/h", "vento") : ""}
        ${d.onda !== null ? item("onda", d.onda.toFixed(1).replace(".", ",") + " m", "onda") : ""}
        ${d.chuvaProb !== null ? item("chuva", Math.round(d.chuvaProb) + "%", "chuva") : ""}
        ${d.uv !== null ? item("uv", Math.round(d.uv), "UV") : ""}
        ${d.maxima !== null && d.minima !== null ? item("termo", Math.round(d.minima) + "° / " + Math.round(d.maxima) + "°", "mín/máx") : ""}
        ${d.por ? item("porsol", d.por, "pôr do sol") : ""}
      </ul>
      <span class="clima-meta" title="Fonte: Open-Meteo">${d.hora ? "às " + esc(d.hora) : ""}<button class="clima-acao" type="button" data-recarregar>Atualizar</button></span>
    </div>`;
  }
};

/* ==========================================================================
   Montador de reserva.

   Não existe banco de dados: a reserva é montada aqui e entregue no WhatsApp
   da operação, que é onde ela realmente acontece. Por isso o site não promete
   "restam 3 vagas" — número que só um servidor compartilhado saberia. Ele diz
   a verdade: o grupo tem no máximo 20 pessoas e a vaga fica garantida quando a
   operação confirmar.
   ========================================================================== */

const reserva = {
  plano: "adventure",
  data: hojeISO(),
  hora: null,
  pax: 2,
  comoConheceu: "",
  instagramCliente: "",
  seguiuInstagram: false,
  enviada: false
};

// Última leitura real de vagas vinda do backend, para a data em foco. Fica
// null sempre que a API não respondeu — nesse caso a grade de horários volta
// a mostrar só "sai às Xh", sem prometer número de vaga nenhum.
let dispoCache = null;

function desenharPlanos() {
  const alvo = $("#escolhaPlano");
  if (!alvo) return;
  alvo.innerHTML = PLANOS.map(p => {
    const sel = p.id === reserva.plano;
    return `<button type="button" class="plano-opcao" data-plano="${p.id}" aria-pressed="${sel}">
      <span class="plano-nome">${p.nome}</span>
      <span class="plano-preco"><b>${BRL(p.preco)}</b> <span>por pessoa</span></span>
      <span class="plano-info">${p.horarios ? "Encontro às " + horariosDoPlano(p).map(horaLabel).join(" e ") + ", saída às " + horariosDoPlano(p).map(h => saidaLabel(h)).join(" e ") : "Saídas " + faixaDeHorarios(p, "hhmm").replace(/^de /, "das ")} · ${p.dur}</span>
      ${p.voucher ? `<span class="plano-info">Inclui voucher de ${BRL(p.voucher)} no almoço</span>` : ""}
    </button>`;
  }).join("");
}

function desenharDatas() {
  const alvo = $("#listaDatas");
  if (!alvo) return;
  const dias = Array.from({ length: 14 }, (_, i) => somaDias(hojeISO(), i));
  alvo.innerHTML = dias.map(iso => `
    <button type="button" class="data-btn" data-data="${iso}" aria-pressed="${iso === reserva.data}">
      <div class="dsem">${diaSemana(iso)}</div>
      <div class="dia">${iso.slice(8, 10)}</div>
      <div class="mes">${MESES[+iso.slice(5, 7) - 1]}</div>
    </button>`).join("");
  const dt = $("#dtPick");
  if (dt) { dt.value = reserva.data; dt.min = hojeISO(); dt.max = somaDias(hojeISO(), CFG.janelaReservaDias); }
}

/* Chamada em todo ponto que hoje já disparava a antiga desenharHorarios():
   pinta imediatamente com o que sabe (nunca deixa a tela em branco esperando
   rede) e manda buscar o número real de vagas em paralelo. */
function desenharHorarios() {
  pintarHorarios();
  atualizarDisponibilidade();
}

function pintarHorarios() {
  const alvo = $("#listaHorarios");
  if (!alvo) return;
  const p = planoPor(reserva.plano);
  const horas = horariosDoPlano(p);

  // Uma saída que já passou hoje não pode ser escolhida hoje.
  const agora = agoraEmTrindade();
  const ehHoje = reserva.data === agora.data;
  const horaAtual = agora.hora;

  const grade = (dispoCache && dispoCache.data === reserva.data) ? dispoCache.grade : null;

  alvo.innerHTML = horas.map(h => {
    const passou = ehHoje && h <= horaAtual;
    const info = grade ? grade[String(h)] : null; // já normalizada em atualizarDisponibilidade(): { restam: inteiro, bloqueado: booleano }
    const semVaga = !!(info && (info.bloqueado || info.restam <= 0));
    const off = passou || semVaga;

    let legenda = passou ? "já saiu" : "sai " + saidaLabel(h);
    if (!passou && info) {
      legenda = info.bloqueado ? "indisponível"
        : info.restam <= 0 ? "esgotado"
        : info.restam + " vaga" + (info.restam > 1 ? "s" : "");
    }
    const capacidade = inteiroSeguro(dispoCache && dispoCache.capacidade, CFG.capacidade) || CFG.capacidade;
    const proporcao = info && !off ? Math.min(1, Math.max(0, info.restam / capacidade)) : 0;

    return `<button type="button" class="hslot" data-hora="${Number(h)}" ${off ? "disabled" : ""}
      aria-pressed="${reserva.hora === h}">
      <b>${esc(horaLabel(h))}</b>
      <span class="saida">${esc(legenda)}</span>
      ${info ? `<span class="slot-capacity" aria-hidden="true"><span class="slot-capacity-fill" data-ratio="${proporcao}" style="--capacity-ratio:${proporcao}"></span></span>` : ""}
    </button>`;
  }).join("");

  const aviso = $("#avisoHorario");
  if (aviso) {
    // Última saída da grade geral (a do servidor, quando ele respondeu).
    const ultimaGeral = grade ? Math.max(...Object.keys(grade).map(Number)) : CFG.slotFim;
    const cortado = !p.horarios && horas.length && horas[horas.length - 1] < ultimaGeral;
    aviso.textContent = p.horarios
      ? `${p.nome} tem encontro às ${horas.map(horaLabel).join(" e ")} e saída às ${horas.map(h => saidaLabel(h)).join(" e ")}.`
      : `Saídas de hora em hora, ${faixaDeHorarios(p, "hhmm").replace(/^de /, "das ")}.` +
        (cortado ? ` O roteiro dura ${p.dur.replace("≈ ", "cerca de ")}, por isso não há saída mais tarde.` : "");
  }
  $("#rotuloData").textContent = "— " + dataBR(reserva.data);
  window.dispatchEvent(new Event("trindade:slots"));
}

/* Busca as vagas reais da data em foco. Se a API não responder (backend
   ainda não ligado, ou fora do ar por qualquer motivo), dispoCache fica nulo
   e pintarHorarios() volta ao comportamento de sempre — sem inventar número. */
async function atualizarDisponibilidade() {
  const dataAlvo = reserva.data;
  const r = await chamarAPI("/api/disponibilidade?data=" + encodeURIComponent(dataAlvo));
  if (reserva.data !== dataAlvo) return; // a pessoa já trocou de data enquanto isso carregava

  // A resposta da API vira dado simples antes de ir para a tela: só inteiros e booleanos.
  const gradeSegura = {};
  if (r.status === 200 && r.corpo && r.corpo.ok && r.corpo.grade && typeof r.corpo.grade === "object") {
    for (const [h, info] of Object.entries(r.corpo.grade)) {
      if (Number.isFinite(Number(h)) && info && typeof info === "object")
        gradeSegura[String(Number(h))] = { restam: Math.max(0, inteiroSeguro(info.restam)), bloqueado: info.bloqueado === true };
    }
  }
  dispoCache = (r.status === 200 && r.corpo && r.corpo.ok)
    ? { data: dataAlvo, grade: gradeSegura, capacidade: Math.max(1, inteiroSeguro(r.corpo.capacidade, CFG.capacidade)) }
    : null;
  if (dispoCache && r.corpo.horariosPorPlano && typeof r.corpo.horariosPorPlano === "object") {
    const porPlano = {};
    for (const [id, lista] of Object.entries(r.corpo.horariosPorPlano))
      if (Array.isArray(lista)) porPlano[id] = lista.map(Number).filter(Number.isFinite);
    horariosDoServidor = porPlano;
    // O servidor pode ter um limite de retorno diferente do padrão: um horário
    // escolhido antes pode não valer mais para este passeio.
    if (reserva.hora !== null && !horariosDoPlano(planoPor(reserva.plano)).includes(reserva.hora)) {
      reserva.hora = null;
      desenharResumo();
    }
    desenharPlanos();
    pintarFaixasDeHorarios();
  }
  if (preSelecionarHorarioUnico()) desenharResumo(); // Boat: o único horário livre já vem selecionado
  pintarHorarios();

  // O horário que a pessoa já tinha escolhido pode ter lotado agora mesmo
  // (outra reserva chegou enquanto ela preenchia o formulário).
  if (reserva.hora !== null && dispoCache) {
    const info = dispoCache.grade[String(reserva.hora)];
    if (info && (info.bloqueado || info.restam <= 0)) {
      reserva.hora = null;
      desenharResumo();
      pintarHorarios();
      torrada("Esse horário acabou de lotar. Escolha outro, por favor.");
    }
  }
}

function desenharPax() {
  const sel = $("#fPax");
  if (!sel || sel.options.length) return;
  sel.innerHTML = Array.from({ length: Math.min(CFG.limitePaxPedido, CFG.capacidade) }, (_, i) => i + 1)
    .map(n => `<option value="${n}">${n} ${n === 1 ? "pessoa" : "pessoas"}</option>`).join("");
  sel.value = String(reserva.pax);
}

function desenharResumo() {
  const p = planoPor(reserva.plano);
  const total = p.preco * reserva.pax;
  const voucher = p.voucher * reserva.pax;

  $("#rsPasseio").textContent = p.nome;
  $("#rsData").textContent = `${dataBR(reserva.data)} (${diaSemana(reserva.data)})`;
  $("#rsHora").textContent = reserva.hora === null ? "—" : `${horaLabel(reserva.hora)} · sai ${saidaLabel(reserva.hora)}`;
  $("#rsPax").textContent = String(reserva.pax);
  $("#rsCalculo").textContent = `${BRL(p.preco)} × ${reserva.pax}`;
  $("#rsSubtotal").textContent = BRL(total);
  $("#rsTotal").textContent = BRL(total);
  // O voucher já está dentro do valor do passeio: aparece como "incluso", nunca como um valor a somar.
  $("#rsVoucherLinha").hidden = !voucher;
  if (voucher) $("#rsVoucher").textContent = `incluso · ${BRL(voucher)}`;
}

/* Passeio com um único horário (o Trindade Boat): se ele está livre na data escolhida, já vem
   selecionado — a pessoa não precisa clicar no único botão para o resumo mostrar o horário.
   Só vale depois de saber as vagas da data (ou de a API não responder); horário que já saiu,
   bloqueado ou esgotado fica sem seleção. Passeios com vários horários nunca pré-selecionam. */
function preSelecionarHorarioUnico() {
  if (reserva.hora !== null) return false;
  const horas = horariosDoPlano(planoPor(reserva.plano));
  if (horas.length !== 1) return false;
  const h = horas[0];
  const agora = agoraEmTrindade();
  if (reserva.data === agora.data && h <= agora.hora) return false;
  const grade = (dispoCache && dispoCache.data === reserva.data) ? dispoCache.grade : null;
  const info = grade ? grade[String(h)] : null;
  if (info && (info.bloqueado || info.restam <= 0)) return false;
  reserva.hora = h;
  mostrarErro(null, "#errHora", "");
  return true;
}

function desenharReserva() {
  // Trocar de plano pode invalidar o horário escolhido (o Trindade Boat só tem encontro às 8:30).
  const p = planoPor(reserva.plano);
  if (reserva.hora !== null && !horariosDoPlano(p).includes(reserva.hora)) reserva.hora = null;
  desenharPlanos(); desenharDatas(); desenharHorarios(); desenharPax(); desenharResumo();
}

/* ------------------------------ validação ------------------------------ */

function mostrarErro(idCampo, idErro, msg) {
  const campo = $(idCampo), erro = $(idErro);
  if (erro) { erro.textContent = msg || ""; erro.hidden = !msg; }
  if (campo) {
    if (msg) campo.setAttribute("aria-invalid", "true");
    else campo.removeAttribute("aria-invalid");
  }
}

function validar() {
  let primeiro = null;
  const falha = (sel, idCampo, idErro, msg) => {
    mostrarErro(idCampo, idErro, msg);
    if (msg && !primeiro) primeiro = $(sel);
  };

  const nome = $("#fNome").value.trim();
  falha("#fNome", "#fNome", "#errNome", nome.length < 3 ? "Informe o nome completo." : "");

  const tel = $("#fTel").value.replace(/\D/g, "");
  falha("#fTel", "#fTel", "#errTel", tel.length < 10 ? "Informe um telefone com DDD." : "");

  const email = $("#fEmail").value.trim();
  falha("#fEmail", "#fEmail", "#errEmail",
    email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "E-mail inválido." : "");

  const insta = ($("#fInstagram") ? $("#fInstagram").value.trim() : "").replace(/^@+/, "");
  falha("#fInstagram", "#fInstagram", "#errInstagram", insta && !/^[A-Za-z0-9._]{1,30}$/.test(insta) ? "Use só letras, números, ponto e sublinhado." : "");

  const agora = agoraEmTrindade();
  const semData = reserva.data < agora.data;
  const erroData = $("#errData");
  erroData.textContent = semData ? "A data já passou." : "";
  erroData.hidden = !semData;
  if (semData && !primeiro) primeiro = erroData;

  // O horário pode ter sido escolhido há um tempo e já ter passado, ou não
  // valer para o passeio (duração além do horário-limite de retorno).
  const semHora = reserva.hora === null;
  const horaInvalida = !semHora && !horariosDoPlano(planoPor(reserva.plano)).includes(reserva.hora);
  const horaPassou = !semHora && reserva.data === agora.data && reserva.hora <= agora.hora;
  const erroHora = $("#errHora");
  erroHora.textContent = semHora ? "Escolha o horário da saída."
    : horaInvalida ? "Esse horário não está disponível para este passeio. Escolha outro."
    : horaPassou ? "Esse horário já passou. Escolha outro."
    : "";
  erroHora.hidden = !erroHora.textContent;
  if (erroHora.textContent && !primeiro) primeiro = $("#listaHorarios");
  if (horaPassou || horaInvalida) { reserva.hora = null; pintarHorarios(); desenharResumo(); }

  const semAceite = !$("#fAceite").checked;
  const erroAceite = $("#errAceite");
  erroAceite.textContent = semAceite ? "Para enviar, é preciso concordar com os Termos do Passeio e a Política de Privacidade." : "";
  erroAceite.hidden = !semAceite;
  if (semAceite && !primeiro) primeiro = $("#fAceite");

  return primeiro;
}

/* ------------------------------ envio ------------------------------ */

function codigoReserva() {
  // Código curto só para o cliente e a operação citarem a mesma reserva na
  // conversa. Não é identificador de sistema: não há sistema.
  const d = new Date();
  const base = doisDig(d.getDate()) + doisDig(d.getHours()) + doisDig(d.getMinutes());
  return "TA-" + base;
}

function mensagemWhatsApp(dados) {
  const p = planoPor(reserva.plano);
  const total = p.preco * reserva.pax;
  const voucher = p.voucher * reserva.pax;
  const linhas = [
    "*Pedido de reserva — Trindade Adventure*",
    "",
    `Código: ${dados.codigo}`,
    `Passeio: ${p.nome}`,
    `Data: ${dataBR(reserva.data)} (${diaSemana(reserva.data)})`,
    `Horário: ${horaLabel(reserva.hora)} — saída ${saidaLabel(reserva.hora)}`,
    `Pessoas: ${reserva.pax}`,
    `Total: ${BRL(total)}` + (voucher ? ` (inclui ${BRL(voucher)} de voucher no almoço)` : ""),
    "",
    `Nome: ${dados.nome}`,
    `WhatsApp: ${dados.tel}`
  ];
  if (dados.email) linhas.push(`E-mail: ${dados.email}`);
  if (dados.obs) linhas.push(`Observações: ${dados.obs}`);
  linhas.push("", "Aguardo a confirmação da vaga. Obrigado!");
  return linhas.join("\n");
}

/* Arquivo .ics para o visitante salvar o passeio no calendário do celular.
   Um lembrete no dia certo reduz o não comparecimento, que é o custo real
   de uma reserva feita por conversa. */
function baixarICS(dados) {
  const p = planoPor(reserva.plano);
  const horas = Math.floor(reserva.hora);
  const min = Math.round((reserva.hora % 1) * 60);
  const inicio = `${reserva.data.replace(/-/g, "")}T${doisDig(horas)}${doisDig(min)}00`;
  // Fim = concentração + saída + duração do passeio (antes era sempre 4 h).
  const fimMin = Math.min(23 * 60 + 59, Math.round(reserva.hora * 60) + CFG.saidaApos + p.duracaoMin);
  const fim = `${reserva.data.replace(/-/g, "")}T${doisDig(Math.floor(fimMin / 60))}${doisDig(fimMin % 60)}00`;
  const esc = s => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trindade Adventure//PT-BR",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${dados.codigo}@trindadeadventure`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;TZID=America/Sao_Paulo:${inicio}`,
    `DTEND;TZID=America/Sao_Paulo:${fim}`,
    `SUMMARY:${esc(p.nome)} — Trindade Adventure`,
    `LOCATION:${esc(CFG.pontoEncontro)}`,
    `DESCRIPTION:${esc(`Reserva ${dados.codigo} · ${reserva.pax} pessoa(s). Concentração ${horaLabel(reserva.hora)}, saída ${saidaLabel(reserva.hora)}. Leve calçado fechado, protetor solar e água.`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT12H", "ACTION:DISPLAY",
    "DESCRIPTION:Passeio amanhã — Trindade Adventure", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `trindade-adventure-${dados.codigo}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let ultimoEnvio = null;

/* Desafio anti-robô (Cloudflare Turnstile) da reserva. O script só é baixado quando a
   pessoa entra na rota /reservar. A cada envio pede-se um token novo (ele vale 5 minutos
   e só uma vez), então formulário aberto por muito tempo continua funcionando. Se o
   script não carregar (bloqueador, rede) ou o desafio falhar, token() devolve null e o
   envio segue pelo WhatsApp, sem gravar — nunca fica um botão sem resposta. */
const Turnstile = {
  _script: null, id: null, _resolver: null,
  sitekey() { return (document.querySelector('meta[name="turnstile-sitekey"]') || {}).content || ""; },
  carregar() {
    if (!this._script) {
      this._script = new Promise(resolve => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true; s.defer = true;
        s.onload = () => resolve(window.turnstile || null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return this._script;
  },
  async token() {
    const api = await this.carregar();
    const caixa = document.getElementById("turnstileBox");
    if (!api || !caixa || !this.sitekey()) return null;
    return new Promise(resolve => {
      const fim = t => { if (this._resolver === fim) { this._resolver = null; clearTimeout(limite); resolve(t || null); } };
      const limite = setTimeout(() => fim(null), 20000);
      this._resolver = fim;
      try {
        if (this.id === null) {
          this.id = api.render(caixa, {
            sitekey: this.sitekey(), action: "reserva", execution: "execute", appearance: "interaction-only", language: "pt-br",
            callback: t => this._resolver && this._resolver(t),
            "error-callback": () => { this._resolver && this._resolver(null); return true; },
            "timeout-callback": () => { this._resolver && this._resolver(null); }
          });
        } else api.reset(this.id);
        api.execute(this.id);
      } catch (e) { fim(null); }
    });
  }
};

/* Chave de idempotência do envio: o mesmo pedido leva sempre a mesma chave, então um reenvio
   (clique duplo, rede que caiu depois de o servidor gravar) devolve a MESMA reserva em vez de
   criar outra. Se o pedido mudou (outro horário, outro nº de pessoas…), a chave é nova.
   Depois de um envio que deu certo, a chave é descartada. */
let chaveEnvio = null;
function chaveDoEnvio(assinatura) {
  if (!chaveEnvio || chaveEnvio.assinatura !== assinatura) chaveEnvio = { assinatura, chave: crypto.randomUUID() };
  return chaveEnvio.chave;
}

function mostrarConfirmacao(dados) {
  const p = planoPor(reserva.plano);
  const total = p.preco * reserva.pax;
  const voucher = p.voucher * reserva.pax;
  const alvo = $("#reservaFeita");

  // Código e link vêm do servidor: o código só vale no formato do pedido e o link só se for o wa.me da operação.
  const codigoSeguro = CODIGO_PEDIDO.test(String(dados.codigo)) ? String(dados.codigo) : codigoReserva();
  const hrefSeguro = waHrefSeguro(dados.waHref, linkWA(mensagemWhatsApp(Object.assign({}, dados, { codigo: codigoSeguro }))));

  alvo.innerHTML = `
    <div class="caixa confirma">
      <div class="selo">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>
      </div>
      <div>
        <h2>Pedido enviado</h2>
        <p>Abrimos o WhatsApp com o pedido pronto. A vaga fica garantida assim que a operação responder confirmando.</p>
      </div>
      <div class="codigo">
        <p>Código do pedido</p>
        <p class="num">${esc(codigoSeguro)}</p>
      </div>
      <div class="linhas">
        <div class="linha"><span>Passeio</span><b>${esc(p.nome)}</b></div>
        <div class="linha"><span>Data e horário</span><b class="num">${esc(dataBR(reserva.data))} · ${esc(horaLabel(reserva.hora))}</b></div>
        <div class="linha"><span>Saída efetiva</span><b class="num">${esc(saidaLabel(reserva.hora))}</b></div>
        <div class="linha"><span>Pessoas</span><b class="num">${inteiroSeguro(reserva.pax)}</b></div>
        <div class="linha"><span>Total</span><b class="num">${esc(BRL(total))}</b></div>
        ${voucher ? `<div class="linha linha-ouro"><span>Voucher almoço</span><b class="num">incluso · ${esc(BRL(voucher))}</b></div>` : ""}
      </div>
      <p class="nota">Ponto de encontro: ${esc(CFG.pontoEncontro)}. Chegue 15 minutos antes, com protetor solar, água e calçado fechado.</p>
      <a class="btn btn-primario btn-largo" id="btnAbrirWA" href="${esc(hrefSeguro)}" target="_blank" rel="noopener">
        Reabrir o WhatsApp com o pedido
      </a>
      <button class="btn btn-secundario btn-largo" type="button" id="btnICS">Salvar no meu calendário</button>
      <button class="btn btn-secundario btn-largo" type="button" id="btnNova">Fazer outro pedido</button>
    </div>`;

  alvo.hidden = false;
  $("#formReserva").hidden = true;
  rolarAte(alvo);
  $("#btnAbrirWA").focus();
  window.dispatchEvent(new Event("trindade:confirmation"));

  $("#btnICS").onclick = () => { baixarICS(dados); torrada("Arquivo do calendário baixado."); };
  $("#btnNova").onclick = () => {
    alvo.hidden = true;
    $("#formReserva").hidden = false;
    reserva.hora = null;
    $("#fAceite").checked = false;
    desenharReserva();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/* ------------------------------ eventos da reserva ------------------------------ */

function ligarReserva() {
  const form = $("#formReserva");
  if (!form) return;
  form.hidden = false;

  // Depois da última saída do dia, a agenda abre no dia seguinte: não faz
  // sentido mostrar primeiro uma grade inteira de horários que já passaram.
  if (agoraEmTrindade().hora >= CFG.slotFim) reserva.data = somaDias(hojeISO(), 1);

  form.addEventListener("click", ev => {
    // Escolhido o passeio, a próxima decisão é a data: leva a pessoa até ela.
    const bp = ev.target.closest("[data-plano]");
    if (bp) {
      reserva.plano = bp.dataset.plano;
      desenharReserva();
      rolarAte($("#passoData"));
      $('#listaDatas [aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }

    const bd = ev.target.closest("[data-data]");
    if (bd) { reserva.data = bd.dataset.data; reserva.hora = null; desenharDatas(); desenharHorarios(); desenharResumo(); return; }

    const bh = ev.target.closest("[data-hora]");
    if (bh && !bh.disabled) {
      reserva.hora = Number(bh.dataset.hora);
      desenharHorarios(); desenharResumo();
      mostrarErro(null, "#errHora", "");
    }
  });

  $("#dtPick").addEventListener("change", ev => {
    if (!ev.target.value) return;
    // Uma data digitada fora da janela não passa pelo min/max do seletor: ajusta aqui.
    const limite = somaDias(hojeISO(), CFG.janelaReservaDias);
    if (ev.target.value > limite) ev.target.value = limite;
    reserva.data = ev.target.value;
    reserva.hora = null;
    desenharDatas(); desenharHorarios(); desenharResumo();
  });

  $("#fPax").addEventListener("change", ev => {
    reserva.pax = Number(ev.target.value) || 1;
    desenharResumo();
  });

  // Máscara leve de telefone: formata sem impedir colar ou apagar.
  $("#fTel").addEventListener("input", ev => {
    const d = ev.target.value.replace(/\D/g, "").slice(0, 11);
    if (!d) { ev.target.value = ""; return; }
    if (d.length <= 2) ev.target.value = `(${d}`;
    else if (d.length <= 6) ev.target.value = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    else if (d.length <= 10) ev.target.value = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    else ev.target.value = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  });

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const problema = validar();
    if (problema) {
      rolarAte(problema.closest(".passo") || problema);
      if (problema.focus) problema.focus({ preventScroll: true });
      torrada("Faltou preencher alguma coisa.");
      return;
    }

    const dadosForm = {
      nome: $("#fNome").value.trim(),
      tel: $("#fTel").value.trim(),
      email: $("#fEmail").value.trim(),
      obs: $("#fObs").value.trim()
    };
    reserva.comoConheceu = $("#fComoConheceu") ? $("#fComoConheceu").value : "";
    reserva.instagramCliente = $("#fInstagram") ? $("#fInstagram").value.trim().replace(/^@+/, "") : "";
    reserva.seguiuInstagram = $("#fSeguiu") ? $("#fSeguiu").checked : false;

    // A aba do WhatsApp precisa abrir dentro do mesmo gesto de clique, senão
    // o navegador entende como pop-up indesejado e bloqueia. Por isso ela
    // abre em branco agora e só recebe o endereço quando o servidor responder.
    const abaWA = window.open("", "_blank");

    const botao = form.querySelector('button[type="submit"]');
    if (botao) { botao.disabled = true; botao.textContent = "Enviando…"; }

    const o = Origem.detectar();
    const chave = chaveDoEnvio([reserva.plano, reserva.data, reserva.hora, reserva.pax, dadosForm.tel, dadosForm.nome].join("|"));
    // Token novo do desafio anti-robô a cada envio. Sem ele (script bloqueado, rede ruim) não
    // adianta chamar o servidor: vai direto para o WhatsApp, abaixo, com a mesma aba já aberta.
    const tokenAnti = await Turnstile.token();
    let resultado;
    if (!tokenAnti) {
      resultado = { status: 0, corpo: null };
      torrada("Não deu para registrar no site agora. Seguimos pelo WhatsApp.");
    } else resultado = await chamarAPI("/api/reservas", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": chave },
      body: JSON.stringify({
        plano: reserva.plano, data: reserva.data, hora: reserva.hora, pax: reserva.pax,
        nome: dadosForm.nome, telefone: dadosForm.tel, email: dadosForm.email, obs: dadosForm.obs,
        origem: origemEfetiva(o, reserva.comoConheceu), origemDetalhe: o.detalhe,
        comoConheceu: rotuloComoConheceu(reserva.comoConheceu),
        instagramCliente: reserva.instagramCliente, seguiuInstagram: reserva.seguiuInstagram,
        sessao: Origem.sessao(),
        "cf-turnstile-response": tokenAnti
      })
    });

    if (botao) { botao.disabled = false; botao.textContent = "Enviar reserva no WhatsApp"; }

    if (resultado.status === 409) {
      if (abaWA) abaWA.close();
      const motivo = resultado.corpo && resultado.corpo.motivo;
      if (motivo === "duplicado") {
        torrada("Já recebemos um pedido igual há poucos minutos. Se for outro grupo, fale com a gente pelo WhatsApp.");
        return;
      }
      if (motivo === "chave_em_uso") { chaveEnvio = null; torrada("Não foi possível enviar agora. Tente de novo."); return; }
      torrada("Esse horário acabou de lotar. Escolha outro, por favor.");
      atualizarDisponibilidade();
      return;
    }
    if (resultado.status === 422) {
      if (abaWA) abaWA.close();
      torrada("Confira os dados — o servidor recusou algum campo.");
      return;
    }
    // 403 (origem), 413 (tamanho), 415 (tipo), 429 (muitos pedidos) e erros 5xx: o
    // pedido não foi gravado. A aba do WhatsApp já está aberta e segue pelo fluxo
    // de sempre (abaixo), então a pessoa não fica sem resposta.
    if ([403, 413, 415, 429].includes(resultado.status) || (resultado.status >= 500 && resultado.status !== 503)) {
      torrada("Não deu para registrar no site agora. Seguimos pelo WhatsApp.");
    }

    let dados;
    if (resultado.status === 200 && resultado.corpo && resultado.corpo.ok) {
      // Caminho normal: o servidor gravou a reserva, conferiu a vaga de
      // verdade e devolveu a mensagem pronta — já com a origem, pro dono ver.
      // Código e link vêm do servidor, mas só entram se tiverem o formato esperado (S08): o código do
      // pedido (TA-…) e um link https://wa.me/<número da operação>. Senão vale o que se monta aqui.
      const codigoServidor = CODIGO_PEDIDO.test(String(resultado.corpo.codigo)) ? String(resultado.corpo.codigo) : codigoReserva();
      dados = Object.assign({ codigo: codigoServidor }, dadosForm);
      dados.waHref = waHrefSeguro(resultado.corpo.whatsapp, linkWA(mensagemWhatsApp(dados)));
      chaveEnvio = null;
    } else {
      // API fora do ar, ou o banco ainda não foi ligado ao projeto: volta ao
      // fluxo de sempre, só pelo WhatsApp, sem gravar nada.
      dados = Object.assign({ codigo: codigoReserva() }, dadosForm);
      dados.waHref = linkWA(mensagemWhatsApp(dados));
    }

    if (abaWA) abaWA.location = dados.waHref;
    else window.open(dados.waHref, "_blank", "noopener");

    ultimoEnvio = dados;
    evento("envio_whatsapp", { reservaCodigo: dados.codigo });
    mostrarConfirmacao(dados);
  });

  desenharReserva();
}

/* ==========================================================================
   Mapa dos roteiros — coordenadas reais sobre OpenStreetMap.

   A versão anterior era um croqui desenhado à mão, com os pontos posicionados
   "a olho" sobre um fundo inventado: bonito e errado. Quem confiasse nele para
   se localizar em Trindade se perderia. Agora cada ponto tem latitude e
   longitude conferidas na base do OpenStreetMap, e o mapa é o mapa de verdade.

   Três lugares que a operação cita — Praia dos Ranchos, Cachoeira dos Codós e
   Poço das Duas Paredes — ainda não têm registro na base aberta. Ficam de fora
   do mapa em vez de ganharem um ponto chutado.
   ========================================================================== */

const TIPOS = {
  encontro:   { c:"#0a6273", l:"Encontro" },
  trilha:     { c:"#2f6b46", l:"Trilha" },
  praia:      { c:"#d09140", l:"Praia" },
  piscina:    { c:"#3fabbe", l:"Piscina natural" },
  cachoeira:  { c:"#7f5bd4", l:"Cachoeira" },
  mirante:    { c:"#a8422b", l:"Mirante" },
  restaurante:{ c:"#c0392b", l:"Restaurante" },
  barco:      { c:"#12849a", l:"Embarque" }
};

const PONTOS = [
  { nome:"Praia do Meio",                 tipo:"encontro",  lat:-23.35356, lng:-44.72641,
    obs:"Ponto de encontro dos passeios, na placa das trilhas." },
  { nome:"Trilha do Cachadaço",           tipo:"trilha",    lat:-23.35550, lng:-44.72971,
    obs:"Entrada da trilha, 1,5 km até a praia." },
  { nome:"Praia do Cachadaço",            tipo:"praia",     lat:-23.35685, lng:-44.73092,
    obs:"Mar aberto e correnteza. Banho só onde o guia liberar." },
  { nome:"Piscina Natural do Cachadaço",  tipo:"piscina",   lat:-23.36242, lng:-44.73120,
    obs:"Água protegida pelas pedras de granito. Ponto alto do roteiro." },
  { nome:"Cachoeira da Pedra que Engole", tipo:"cachoeira", lat:-23.35083, lng:-44.73062,
    obs:"15 a 20 min de caminhada do fim da Praia do Meio." },
  { nome:"Praia do Cepilho",              tipo:"praia",     lat:-23.34451, lng:-44.71457,
    obs:"A praia do surf, na chegada da vila." },
  { nome:"Praia de Fora",                 tipo:"praia",     lat:-23.35083, lng:-44.72238,
    obs:"Uma das mais próximas da vila." },
  { nome:"Trilha da Praia Brava",         tipo:"trilha",    lat:-23.33840, lng:-44.70550,
    obs:"Início da trilha para a Praia Brava." },
  { nome:"Praia do Sono",                 tipo:"praia",     lat:-23.33422, lng:-44.63261,
    obs:"Parada mais longa do Trindade Boat." }
];

const linkMaps = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/* Sem Leaflet (CDN fora do ar, extensão bloqueando) o visitante ainda precisa
   das localizações. A lista abaixo entrega a mesma informação sem o mapa. */
function listaDePontos() {
  return `<ul class="pontos-lista">
    ${PONTOS.map(p => `<li>
      <span class="ponto-cor" style="background:${TIPOS[p.tipo].c}" aria-hidden="true"></span>
      <div>
        <b>${p.nome}</b>
        <p class="tiny muted">${p.obs}</p>
        <a class="tiny" href="${linkMaps(p)}" target="_blank" rel="noopener">Abrir no Google Maps</a>
      </div>
    </li>`).join("")}
  </ul>`;
}

function prepararMapa() {
  const alvo = $("#mapaWrap");
  if (!alvo) return;
  alvo.innerHTML = '<div class="mapa-loading" role="status">Mapa dos roteiros · carregamento ao aproximar</div>';
  let started = false;
  const load = () => {
    if (started) return;
    started = true;
    // O estilo do Leaflet vem junto com o mapa, não no carregamento da página.
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/vendor/leaflet-1.9.4.min.css";
    document.head.append(css);
    const script = document.createElement("script");
    script.src = "/vendor/leaflet-1.9.4.min.js";
    script.onload = desenharMapa;
    script.onerror = desenharMapa;
    document.head.append(script);
  };
  if (!("IntersectionObserver" in window)) { load(); return; }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
  }, { rootMargin: "300px" });
  observer.observe(alvo);
}

function desenharMapa() {
  const alvo = $("#mapaWrap");
  if (!alvo) return;

  const usados = [...new Set(PONTOS.map(p => p.tipo))];
  const legenda = `<div class="mapa-legenda">
    ${usados.map(t => `<span><i style="background:${TIPOS[t].c}"></i>${TIPOS[t].l}</span>`).join("")}
  </div>`;

  if (!window.L) {
    alvo.innerHTML = `<div class="caixa">
      <p class="mapa-nota" style="margin:0 0 14px">O mapa não pôde ser carregado. Os pontos do roteiro:</p>
      ${listaDePontos()}
    </div>`;
    return;
  }

  alvo.innerHTML = `<div class="mapa"><div id="mapaLeaflet" aria-label="Mapa com os pontos dos roteiros em Trindade"></div>${legenda}</div>
    <p class="mapa-nota">
      Coordenadas conferidas na base do OpenStreetMap. Toque num ponto para abrir no Google Maps.
      Praia dos Ranchos, Cachoeira dos Codós e Poço das Duas Paredes ainda não têm registro na base aberta
      e por isso não aparecem aqui.
    </p>`;

  const mapa = L.map("mapaLeaflet", { scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(mapa);

  PONTOS.forEach(p => {
    const t = TIPOS[p.tipo];
    L.circleMarker([p.lat, p.lng], {
      radius: p.tipo === "encontro" ? 11 : 8,
      color: "#fff", weight: 2.5, fillColor: t.c, fillOpacity: 1
    })
      .addTo(mapa)
      .bindTooltip(p.nome, { direction: "top", offset: [0, -8] })
      .bindPopup(`<b>${p.nome}</b><br>${p.obs}<br>
        <a href="${linkMaps(p)}" target="_blank" rel="noopener">Abrir no Google Maps</a>`);
  });

  /* O mapa nasce dentro de uma seção que o roteador mantém escondida. Enquanto
     ela está oculta o container mede zero, e um fitBounds nesse estado colapsa
     para o zoom máximo — o mapa abria na escala de rua, em vez da enseada
     inteira. Então o enquadramento só acontece quando o container ganha
     tamanho de verdade, e só na primeira vez: depois disso o visitante manda
     no zoom, e mexer nele seria desfazer o que ele acabou de fazer. */
  const limites = L.latLngBounds(PONTOS.map(p => [p.lat, p.lng]));
  const caixa = document.getElementById("mapaLeaflet");
  let enquadrado = false;

  const ajustar = () => {
    if (!caixa.clientWidth || !caixa.clientHeight) return;
    mapa.invalidateSize();
    if (!enquadrado) { mapa.fitBounds(limites, { padding: [34, 34] }); enquadrado = true; }
  };

  if (window.ResizeObserver) new ResizeObserver(ajustar).observe(caixa);
  window.addEventListener("trindade:route", () => setTimeout(ajustar, 60));
  setTimeout(ajustar, 300);
}

/* ==========================================================================
   Ilustrações vetoriais: quadros das câmeras e fotos que faltam nas pousadas.
   São desenhadas pelo próprio site — nenhum arquivo extra para baixar.
   ========================================================================== */

const rnd = () => Math.random().toString(36).slice(2, 6);

function cenaCamera(tipo) {
  const u = "v" + rnd();
  const base = {
    praia:  { ceu:"#5b7f8c", chao:"#8d9a86", agua:"#4d7f88" },
    trilha: { ceu:"#43604f", chao:"#3d4d3c", agua:"#375248" },
    pier:   { ceu:"#546f80", chao:"#6d7c80", agua:"#3f6b78" },
    sede:   { ceu:"#5a6470", chao:"#767c7f", agua:"#5a6470" }
  }[tipo];

  return `<svg class="cena" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" role="img"
      aria-label="Ilustração simulando o quadro de uma câmera; não é imagem real">
    <defs>
      <linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${base.ceu}"/><stop offset="1" stop-color="#b7c3c0"/></linearGradient>
      <radialGradient id="${u}v" cx=".5" cy=".5" r=".78"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    </defs>
    <rect width="640" height="360" fill="url(#${u}s)"/>
    <path d="M0 150q120 -40 240 -8t180 -4 220 18v34H0Z" fill="#2f4237" opacity=".8"/>
    <rect y="182" width="640" height="178" fill="${base.chao}"/>
    ${tipo === "praia" || tipo === "pier" ? `<path d="M0 182h640v58q-160 22 -320 4T0 240Z" fill="${base.agua}"/>` : ""}
    ${tipo === "pier" ? `<g fill="#5d5044"><rect x="250" y="206" width="180" height="12"/><rect x="266" y="218" width="9" height="46"/><rect x="336" y="218" width="9" height="46"/><rect x="406" y="218" width="9" height="46"/></g>` : ""}
    ${tipo === "trilha" ? `<g fill="#2c3d2f"><rect x="90" y="60" width="26" height="300" rx="8"/><rect x="500" y="40" width="32" height="320" rx="10"/></g><path d="M320 360q-6 -100 24 -170" stroke="#6d6a52" stroke-width="42" fill="none" opacity=".55"/>` : ""}
    ${tipo === "sede" ? `<g><rect x="120" y="120" width="400" height="110" rx="6" fill="#8a8f8c"/><rect x="150" y="150" width="60" height="50" fill="#3a4a50"/><rect x="240" y="150" width="60" height="50" fill="#3a4a50"/><rect x="330" y="150" width="60" height="50" fill="#3a4a50"/><rect x="420" y="150" width="60" height="50" fill="#3a4a50"/><rect x="290" y="250" width="120" height="40" rx="4" fill="#4d5a5e"/></g>` : ""}
    <g fill="#26333a" opacity=".8">
      <ellipse cx="210" cy="286" rx="12" ry="4"/><rect x="204" y="248" width="12" height="34" rx="5"/><circle cx="210" cy="240" r="7"/>
      <ellipse cx="248" cy="292" rx="12" ry="4"/><rect x="242" y="252" width="12" height="36" rx="5"/><circle cx="248" cy="244" r="7"/>
      <ellipse cx="430" cy="300" rx="13" ry="4"/><rect x="423" y="258" width="13" height="38" rx="5"/><circle cx="430" cy="250" r="7.5"/>
    </g>
    <rect width="640" height="360" fill="url(#${u}v)"/>
  </svg>`;
}

/* ==========================================================================
   Mini-galeria: fotos reais de um parceiro (pousada, restaurante), com
   prev/next e contador. Usada dentro de um contêiner que já tem posição
   relativa e recorte (a classe .media do site já dá isso) — por isso o HTML
   daqui não traz wrapper próprio, só as imagens e os controles.
   ========================================================================== */
const FOTOS_RESPONSIVAS = {"/assets/costa-trindade.jpg":{"src":"/assets/costa-trindade-720.webp","srcset":"/assets/costa-trindade-480.webp 480w, /assets/costa-trindade-720.webp 720w","width":720,"height":896},"/assets/og-v2.jpg":{"src":"/assets/og-v2-1200.webp","srcset":"/assets/og-v2-480.webp 480w, /assets/og-v2-800.webp 800w, /assets/og-v2-1200.webp 1200w","width":1200,"height":630},"/assets/piscina-v2.jpg":{"src":"/assets/piscina-v2-1155.webp","srcset":"/assets/piscina-v2-480.webp 480w, /assets/piscina-v2-800.webp 800w, /assets/piscina-v2-1155.webp 1155w","width":1155,"height":768},"/assets/pousada-hymbe-1.jpg":{"src":"/assets/pousada-hymbe-1-720.webp","srcset":"/assets/pousada-hymbe-1-480.webp 480w, /assets/pousada-hymbe-1-720.webp 720w","width":720,"height":912},"/assets/pousada-hymbe-2.jpg":{"src":"/assets/pousada-hymbe-2-720.webp","srcset":"/assets/pousada-hymbe-2-480.webp 480w, /assets/pousada-hymbe-2-720.webp 720w","width":720,"height":864},"/assets/pousada-hymbe-3.jpg":{"src":"/assets/pousada-hymbe-3-720.webp","srcset":"/assets/pousada-hymbe-3-480.webp 480w, /assets/pousada-hymbe-3-720.webp 720w","width":720,"height":928},"/assets/pousada-hymbe-4.jpg":{"src":"/assets/pousada-hymbe-4-720.webp","srcset":"/assets/pousada-hymbe-4-480.webp 480w, /assets/pousada-hymbe-4-720.webp 720w","width":720,"height":896},"/assets/pousada-hymbe-5.jpg":{"src":"/assets/pousada-hymbe-5-720.webp","srcset":"/assets/pousada-hymbe-5-480.webp 480w, /assets/pousada-hymbe-5-720.webp 720w","width":720,"height":896},"/assets/pousada-hymbe-6.jpg":{"src":"/assets/pousada-hymbe-6-720.webp","srcset":"/assets/pousada-hymbe-6-480.webp 480w, /assets/pousada-hymbe-6-720.webp 720w","width":720,"height":896},"/assets/pousada-madeira-1.jpg":{"src":"/assets/pousada-madeira-1-720.webp","srcset":"/assets/pousada-madeira-1-480.webp 480w, /assets/pousada-madeira-1-720.webp 720w","width":720,"height":704},"/assets/pousada-madeira-2.jpg":{"src":"/assets/pousada-madeira-2-720.webp","srcset":"/assets/pousada-madeira-2-480.webp 480w, /assets/pousada-madeira-2-720.webp 720w","width":720,"height":880},"/assets/pousada-madeira-3.jpg":{"src":"/assets/pousada-madeira-3-720.webp","srcset":"/assets/pousada-madeira-3-480.webp 480w, /assets/pousada-madeira-3-720.webp 720w","width":720,"height":529},"/assets/pousada-madeira-4.jpg":{"src":"/assets/pousada-madeira-4-720.webp","srcset":"/assets/pousada-madeira-4-480.webp 480w, /assets/pousada-madeira-4-720.webp 720w","width":720,"height":918},"/assets/praia-v2.jpg":{"src":"/assets/praia-v2-712.webp","srcset":"/assets/praia-v2-480.webp 480w, /assets/praia-v2-712.webp 712w","width":712,"height":473},"/assets/restaurante-hymbe-1.jpg":{"src":"/assets/restaurante-hymbe-1-720.webp","srcset":"/assets/restaurante-hymbe-1-480.webp 480w, /assets/restaurante-hymbe-1-720.webp 720w","width":720,"height":1192},"/assets/restaurante-hymbe-2.jpg":{"src":"/assets/restaurante-hymbe-2-720.webp","srcset":"/assets/restaurante-hymbe-2-480.webp 480w, /assets/restaurante-hymbe-2-720.webp 720w","width":720,"height":440},"/assets/restaurante-hymbe-3.jpg":{"src":"/assets/restaurante-hymbe-3-720.webp","srcset":"/assets/restaurante-hymbe-3-480.webp 480w, /assets/restaurante-hymbe-3-720.webp 720w","width":720,"height":968},"/assets/restaurante-hymbe-4.jpg":{"src":"/assets/restaurante-hymbe-4-720.webp","srcset":"/assets/restaurante-hymbe-4-480.webp 480w, /assets/restaurante-hymbe-4-720.webp 720w","width":720,"height":512},"/assets/restaurante-hymbe-5.jpg":{"src":"/assets/restaurante-hymbe-5-720.webp","srcset":"/assets/restaurante-hymbe-5-480.webp 480w, /assets/restaurante-hymbe-5-720.webp 720w","width":720,"height":472},"/assets/trilha-v2.jpg":{"src":"/assets/trilha-v2-1024.webp","srcset":"/assets/trilha-v2-480.webp 480w, /assets/trilha-v2-800.webp 800w, /assets/trilha-v2-1024.webp 1024w","width":1024,"height":768},"/assets/vista-trindade-1.jpg":{"src":"/assets/vista-trindade-1-720.webp","srcset":"/assets/vista-trindade-1-480.webp 480w, /assets/vista-trindade-1-720.webp 720w","width":720,"height":1301},"/assets/vista-trindade-2.jpg":{"src":"/assets/vista-trindade-2-720.webp","srcset":"/assets/vista-trindade-2-480.webp 480w, /assets/vista-trindade-2-720.webp 720w","width":720,"height":1072},"/assets/vista-trindade-3.jpg":{"src":"/assets/vista-trindade-3-720.webp","srcset":"/assets/vista-trindade-3-480.webp 480w, /assets/vista-trindade-3-720.webp 720w","width":720,"height":1253},"/assets/vista-trindade-4.jpg":{"src":"/assets/vista-trindade-4-720.webp","srcset":"/assets/vista-trindade-4-480.webp 480w, /assets/vista-trindade-4-720.webp 720w","width":720,"height":1256}};
function miniGaleriaHTML(fotos) {
  if (!fotos || !fotos.length) return "";
  const imgs = fotos.map((f, i) =>
    `<img src="${FOTOS_RESPONSIVAS[f.src]?.src || f.src}" ${FOTOS_RESPONSIVAS[f.src] ? `srcset="${FOTOS_RESPONSIVAS[f.src].srcset}" sizes="(max-width: 720px) 92vw, 440px" width="${FOTOS_RESPONSIVAS[f.src].width}" height="${FOTOS_RESPONSIVAS[f.src].height}"` : ""} alt="${f.alt}" loading="lazy" decoding="async" data-mg-img${i > 0 ? " hidden" : ""}>`
  ).join("");
  if (fotos.length < 2) return imgs;
  return imgs +
    `<button type="button" class="mg-nav prev" data-mg-prev aria-label="Foto anterior">‹</button>
     <button type="button" class="mg-nav next" data-mg-next aria-label="Próxima foto">›</button>
     <span class="mg-cont num" data-mg-cont>1 / ${fotos.length}</span>`;
}

/* Um único ouvinte delegado cuida de toda mini-galeria da página, inclusive
   as que a home clona da seção de pousadas (espelharPousadas) — o clone leva
   os mesmos atributos data-*, então o clique funciona sem religar nada. */
function ligarMiniGalerias() {
  document.addEventListener("click", ev => {
    const prev = ev.target.closest("[data-mg-prev]");
    const next = ev.target.closest("[data-mg-next]");
    if (!prev && !next) return;
    const galeria = ev.target.closest(".media");
    if (!galeria) return;
    const imgs = $$("[data-mg-img]", galeria);
    if (imgs.length < 2) return;
    const atual = imgs.findIndex(i => !i.hidden);
    const total = imgs.length;
    const novo = ((prev ? atual - 1 : atual + 1) + total) % total;
    imgs[atual].hidden = true;
    imgs[novo].hidden = false;
    const cont = $("[data-mg-cont]", galeria);
    if (cont) cont.textContent = (novo + 1) + " / " + total;
  });
}

function cenaPousada(indice) {
  const tom = ["#ece6d7", "#e6e0cf", "#e2ddcc"][indice % 3];
  return `<svg class="cena" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" role="img"
      aria-label="Espaço reservado para a foto da pousada">
    <rect width="640" height="400" fill="${tom}"/>
    <g transform="translate(260,150)" fill="none" stroke="#0d6b38" stroke-width="9"
       stroke-linecap="round" stroke-linejoin="round" opacity=".3">
      <path d="M4 84 L38 22 L64 66"/><path d="M52 84 L80 40 L116 84"/>
      <path d="M4 104 q14 -10 28 0 t28 0 t28 0 t28 0"/><path d="M18 126 q14 -10 28 0 t28 0 t28 0"/>
    </g>
    <text x="320" y="330" text-anchor="middle" font-family="ui-monospace,monospace" font-size="12"
      letter-spacing="2.2" fill="#8a7a5c" opacity=".85">FOTO DA POUSADA</text>
  </svg>`;
}

const CAMERAS = [
  { nome:"Praia do Meio — ponto de encontro", local:"Entrada das trilhas", cena:"praia" },
  { nome:"Início da Trilha do Cachadaço",     local:"Portal da trilha",    cena:"trilha" },
  { nome:"Píer de embarque",                  local:"Trindade Boat · saída 8:50", cena:"pier" },
  { nome:"Estacionamento / recepção",         local:"Sede operacional",     cena:"sede" }
];

function desenharCameras() {
  const alvo = $("#listaCams");
  if (!alvo) return;
  alvo.innerHTML = CAMERAS.map((c, i) => `
    <article class="cam">
      <div class="feed">
        ${cenaCamera(c.cena)}
        <div class="scan"></div>
        <div class="osd" aria-hidden="true">
          <div class="tl"><span class="rec"></span> SIMULADO</div>
          <div class="tr">CAM ${doisDig(i + 1)}</div>
          <div class="bl">${c.local}</div>
          <div class="br" data-relogio>--:--:--</div>
        </div>
      </div>
      <div class="cam-legenda">
        <b>${c.nome}</b>
        <p>Sem transmissão configurada · quadro ilustrativo</p>
      </div>
    </article>`).join("");
}

function ligarRelogios() {
  const nos = $$("[data-relogio]");
  if (!nos.length) return;
  const tique = () => {
    const d = new Date();
    const t = `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}:${doisDig(d.getSeconds())}`;
    nos.forEach(n => { n.textContent = t; });
  };
  tique();
  setInterval(tique, 1000);
}

/* As pousadas também aparecem na primeira página. Em vez de repetir o HTML dos
   cartões — e correr o risco de os dois textos divergirem com o tempo —, a home
   clona os cartões da seção de pousadas. Existe um só original a manter.
   Os ids são removidos das cópias para não duplicar identificadores no documento. */
function espelharPousadas() {
  const destino = $("#pousadasInicio");
  const origem = $("#pousadas .pousadas");
  if (!destino || !origem) return;

  Array.from(origem.children).forEach(cartao => {
    const copia = cartao.cloneNode(true);
    copia.removeAttribute("id");
    $$("[id]", copia).forEach(n => n.removeAttribute("id"));
    $$("[data-cena]", copia).forEach(n => n.removeAttribute("data-cena"));
    destino.appendChild(copia);
  });

  // As ilustrações de espaço reservado são recriadas para as cópias.
  $$(".thumb.media", destino).forEach((caixa, i) => {
    if (!caixa.querySelector("img")) caixa.innerHTML = cenaPousada(i);
  });
}

/* ------------------------------ partida ------------------------------ */

/* Dados legais no rodapé, montados a partir de "negocio" na tabela
   site-config. Só entra o que estiver preenchido: campo vazio não vira
   "CNPJ: " solto na tela. Para acrescentar razão social ou Cadastur, basta
   preencher lá — nunca com dado provisório ou inventado. */
function mostrarDadosDaEmpresa() {
  const alvo = $("#dadosEmpresa");
  const n = SITE.negocio || {};
  if (!alvo) return;
  const partes = [
    n.razaoSocial && n.razaoSocial !== n.nome ? n.razaoSocial : "",
    n.cnpj ? "CNPJ " + n.cnpj : "",
    n.cadastur ? "Cadastur " + n.cadastur : ""
  ].filter(Boolean);
  alvo.textContent = partes.join(" · ");
  alvo.hidden = !partes.length;
}

/* Pousadas: "Direto com a pousada" só pode aparecer quando o botão de fato
   fala com a pousada (link com data-wa-numero, o WhatsApp dela). Sem isso, o
   link cai no WhatsApp da Trindade Adventure e o texto precisa dizer isso. */
function ajustarCanaisDeContato(raiz) {
  $$("[data-canal-contato]", raiz || document).forEach(rotulo => {
    const cartao = rotulo.closest(".parceira");
    const link = cartao && cartao.querySelector("a[data-wa]");
    if (!link) return;
    const direto = !!link.dataset.waNumero && link.dataset.waNumero !== CFG.whatsapp;
    rotulo.textContent = direto ? "Direto com a pousada" : "Atendimento pela Trindade Adventure";
  });
}

function iniciar() {
  // Link antigo (#/passeios?plano=boat) vira o endereço novo antes de tudo.
  migrarEnderecoAntigo();
  ligarMenu();
  ligarLinksWhatsApp();
  ajustarCanaisDeContato();
  mostrarDadosDaEmpresa();
  pintarFaixasDeHorarios();
  $("#ano").textContent = String(new Date().getFullYear());

  // Fotos reais dos parceiros que já enviaram — o resto (ainda sem foto)
  // continua com o espaço reservado ilustrado.
  const fotoHymbe = $("#fotoHymbe");
  if (fotoHymbe) {
    fotoHymbe.innerHTML = miniGaleriaHTML([
      { src: "/assets/pousada-hymbe-3.jpg", alt: "Quarto da Pousada Hymbé com cama de casal e luminária pendente" },
      { src: "/assets/pousada-hymbe-1.jpg", alt: "Quarto da Pousada Hymbé com cama de casal e beliche, toalhas dobradas" },
      { src: "/assets/pousada-hymbe-2.jpg", alt: "Quarto da Pousada Hymbé com cortina e abajur de palha" },
      { src: "/assets/pousada-hymbe-4.jpg", alt: "Quarto da Pousada Hymbé com remos decorativos na parede" },
      { src: "/assets/pousada-hymbe-5.jpg", alt: "Área comum da Pousada Hymbé com vista para a serra" },
      { src: "/assets/pousada-hymbe-6.jpg", alt: "Corredor de entrada da Pousada Hymbé, com tapete de boas-vindas" }
    ]);
  }

  const fotoMadeira = $("#fotoMadeira");
  if (fotoMadeira) {
    fotoMadeira.innerHTML = miniGaleriaHTML([
      { src: "/assets/pousada-madeira-1.jpg", alt: "Casa de Madeira Trindade — varanda com rede e quintal" },
      { src: "/assets/pousada-madeira-2.jpg", alt: "Café da manhã servido na varanda da Casa de Madeira, com vista para o jardim" },
      { src: "/assets/pousada-madeira-4.jpg", alt: "Varanda da Casa de Madeira com rede e vista para o jardim" },
      { src: "/assets/pousada-madeira-3.jpg", alt: "Casa de Madeira Trindade iluminada à noite" }
    ]);
  }

  const fotoRestauranteHymbe = $("#fotoRestauranteHymbe");
  if (fotoRestauranteHymbe) {
    fotoRestauranteHymbe.innerHTML = miniGaleriaHTML([
      { src: "/assets/restaurante-hymbe-2.jpg", alt: "Espreguiçadeiras do restaurante Hymbé na areia da praia" },
      { src: "/assets/restaurante-hymbe-5.jpg", alt: "Deck do restaurante Hymbé ao entardecer" },
      { src: "/assets/restaurante-hymbe-4.jpg", alt: "Placa de boas-vindas do restaurante Hymbé" },
      { src: "/assets/restaurante-hymbe-1.jpg", alt: "Guarda-sóis do restaurante Hymbé na praia" },
      { src: "/assets/restaurante-hymbe-3.jpg", alt: "Vista aérea da praia em frente ao restaurante Hymbé" }
    ]);
  }

  $$("[data-cena]").forEach((el, i) => { el.innerHTML = cenaPousada(i + 1); });

  ligarMiniGalerias();
  espelharPousadas();

  // Se a detecção automática já sabe que veio do Instagram ou do Google,
  // deixa pré-marcado no formulário — a pessoa só confirma, não escolhe do zero.
  const oInicial = Origem.detectar();
  const selComoConheceu = $("#fComoConheceu");
  if (selComoConheceu && (oInicial.origem === "instagram" || oInicial.origem === "google")) {
    selComoConheceu.value = oInicial.origem;
  }

  aplicarRota(false);
  montarOsDemais();

  // Tempo e mar e a métrica de visita esperam a página terminar de carregar:
  // no 4G, a foto da abertura chega primeiro. A faixa já reserva o espaço.
  const depoisDeCarregar = () => { Clima.carregar(false); evento("visita"); };
  if (document.readyState === "complete") depoisDeCarregar();
  else window.addEventListener("load", depoisDeCarregar, { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();

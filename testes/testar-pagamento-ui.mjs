// Testes da parte do SITE (app.js) e do PAINEL (admin.html) do pagamento online (Asaas, só Pix).
//
// Sem navegador e sem dependências: o app.js e o admin.html guardam a lógica de decisão em trechos
// marcados (<pagamento-puro> … </pagamento-puro> e <painel-pagamento-puro> … </painel-pagamento-puro>),
// sem DOM. Este script recorta esses trechos, roda cada um isolado (node:vm) e confere as regras.
// Também confere que os números que o site mostra batem com os que o _worker.js cobra (mesmos preços,
// mesma regra de 30%, mesmo limite de tempo) e que, com a flag desligada, o envio não muda.
//
//   node testes/testar-pagamento-ui.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let falhas = 0, total = 0;
function checar(nome, ok, detalhe) {
  total++; if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${nome}${!ok && detalhe !== undefined ? "  →  " + detalhe : ""}`);
}
const ler = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
function recortar(src, marca, nome) {
  const ini = src.indexOf(`<${marca}>`), fim = src.indexOf(`</${marca}>`);
  if (ini < 0 || fim < 0) throw new Error(`trecho <${marca}> não encontrado`);
  const trecho = src.slice(src.indexOf("\n", ini) + 1, src.lastIndexOf("\n", fim));
  return vm.runInNewContext(trecho + `\n;${nome}`, { URL, URLSearchParams });
}
const appSrc = ler("../site/app.js");
const P = recortar(appSrc, "pagamento-puro", "PagamentoPuro");
const w = await import("data:text/javascript;base64," + Buffer.from(ler("../site/_worker.js")).toString("base64"));

const HOJE = "2026-10-26", AMANHA = "2026-10-27";
const RESPOSTA_LIGADO = {
  ok: true, data: AMANHA, grade: {},
  pagamentoOnline: { planos: ["essencial", "adventure", "boat"], percentualSinal: 30, hoje: HOJE,
    precos: { essencial: 80, adventure: 150, boat: 400 }, saidaAposMin: 20, quitarAntesMin: 15, minimoLinkMin: 10 }
};
const cfg = P.ler(RESPOSTA_LIGADO);
const PL = id => ({ id });
const PARAPENTE = { id: "parapente", soWhatsApp: true, horarioCombinado: true };

// ---------------- descobrir a flag ----------------
checar("F1  resposta SEM pagamentoOnline (flag desligada) → nada ligado", P.ler({ ok: true, grade: {} }) === null);
checar("F1  resposta quebrada / erro / tipos errados → nada ligado", P.ler(null) === null && P.ler({ ok: false, pagamentoOnline: RESPOSTA_LIGADO.pagamentoOnline }) === null
  && P.ler({ ok: true, pagamentoOnline: "sim" }) === null && P.ler({ ok: true, pagamentoOnline: { planos: [], percentualSinal: 30, hoje: HOJE } }) === null
  && P.ler({ ok: true, pagamentoOnline: { planos: ["essencial"], percentualSinal: 30, hoje: "amanhã" } }) === null);
checar("F1  resposta do servidor ligado → configuração lida", cfg && cfg.planos.join() === "essencial,adventure,boat" && cfg.percentualSinal === 30 && cfg.hoje === HOJE && cfg.precos.boat === 400 && cfg.minimoLinkMin === 10);
checar("F1  só os passeios que o servidor lista pagam online; o parapente segue no WhatsApp", P.pagaOnline(cfg, PL("essencial")) && P.pagaOnline(cfg, PL("adventure")) && P.pagaOnline(cfg, PL("boat")) && !P.pagaOnline(cfg, PARAPENTE) && !P.pagaOnline(cfg, PL("outro")) && !P.pagaOnline(null, PL("essencial")));
checar("F1  mesmo se o servidor listar o parapente, sem horário/vaga ele não paga online (PENDENTE-LUCAS)", !P.pagaOnline(P.ler({ ok: true, pagamentoOnline: { ...RESPOSTA_LIGADO.pagamentoOnline, planos: ["parapente"], precos: { parapente: 350 } } }), PARAPENTE));
const pendApp = [...appSrc.matchAll(/PENDENTE-LUCAS:?([^\n]*)/g)].map(m => m[1].trim());
checar("F1  único PENDENTE-LUCAS no app.js é o do parapente", pendApp.length === 1 && /^horários\/vagas do parapente/.test(pendApp[0]), JSON.stringify(pendApp));

// ---------------- 30% / 100% ----------------
const outroDia = P.opcoes(cfg, "essencial", AMANHA, 2);
checar("O1  outro dia: duas opções, sinal 30% (R$ 48 + saldo R$ 112) ou 100% (R$ 160)", !outroDia.mesmoDia && outroDia.modos.length === 2
  && outroDia.modos[0].modo === "sinal" && outroDia.modos[0].agoraCentavos === 4800 && outroDia.modos[0].saldoCentavos === 11200
  && outroDia.modos[1].modo === "integral" && outroDia.modos[1].agoraCentavos === 16000 && outroDia.modos[1].saldoCentavos === 0, JSON.stringify(outroDia));
const mesmoDia = P.opcoes(cfg, "boat", HOJE, 1);
checar("O1  mesmo dia (pelo 'hoje' do servidor): só 100%", mesmoDia.mesmoDia && mesmoDia.modos.length === 1 && mesmoDia.modos[0].modo === "integral" && mesmoDia.modos[0].agoraCentavos === 40000);
checar("O1  mesmo dia: a escolha vira 100% mesmo se a pessoa tinha marcado sinal; outro dia sem escolha = nenhuma", P.escolhaEfetiva(cfg, HOJE, "sinal") === "integral" && P.escolhaEfetiva(cfg, HOJE, null) === "integral" && P.escolhaEfetiva(cfg, AMANHA, null) === null && P.escolhaEfetiva(cfg, AMANHA, "x") === null && P.escolhaEfetiva(cfg, AMANHA, "sinal") === "sinal");
let iguais = true, exemplo = "";
for (const id of ["essencial", "adventure", "boat"]) for (let pax = 1; pax <= 15; pax++) for (const data of [HOJE, AMANHA]) {
  const op = P.opcoes(cfg, id, data, pax);
  for (const m of op.modos) {
    const s = w.calcularCobranca({ totalReais: cfg.precos[id] * pax, data, hoje: HOJE, escolha: m.modo });
    if (s.erro || s.agoraCentavos !== m.agoraCentavos || s.saldoCentavos !== m.saldoCentavos || s.modalidade !== m.modo) { iguais = false; exemplo = `${id} ${pax} ${data} ${m.modo}`; }
  }
  if (data === HOJE && !w.calcularCobranca({ totalReais: cfg.precos[id] * pax, data, hoje: HOJE, escolha: "sinal" }).erro) { iguais = false; exemplo = "sinal no mesmo dia"; }
}
checar("O1  valores do site = valores que o _worker.js cobra (3 passeios × 1–15 pessoas × hoje/amanhã)", iguais, exemplo);
checar("O1  Adventure com voucher: sinal de 30% sobre o total com voucher (R$ 150 → R$ 45 + R$ 105)", (o => o.modos[0].agoraCentavos === 4500 && o.modos[0].saldoCentavos === 10500)(P.opcoes(cfg, "adventure", AMANHA, 1)));
checar("O1  valores em reais como no resto do site", P.reais(4800) === "R$ 48" && P.reais(1050) === "R$ 10,50" && P.reais(240000) === "R$ 2.400");

// ---------------- horários sem tempo de pagar ----------------
const agora = { data: HOJE, hora: 10 }; // 10h00 em Trindade
checar("H1  hoje 10h00: concentração das 10h (limite 10h05) sem tempo; 11h (limite 11h05) com tempo", P.semTempo(cfg, HOJE, 10, agora) && !P.semTempo(cfg, HOJE, 11, agora));
checar("H1  amanhã nunca fica sem tempo; sem configuração também não", !P.semTempo(cfg, AMANHA, 8, agora) && !P.semTempo(null, HOJE, 10, agora));
let mesmoLimite = true, ex2 = "";
const cfgW = { saidaApos: 20 };
for (let min = 6 * 60; min <= 18 * 60; min += 5) for (const h of [7, 8, 8.5, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
  const agoraMs = Date.parse(HOJE + "T00:00:00Z") + (min + 180) * 60000;
  const servidorSemTempo = w.minutosDoLink(agoraMs, w.limiteQuitacaoMs(HOJE, h, cfgW), 30) === null;
  const site = P.semTempo(cfg, HOJE, h, { data: HOJE, hora: min / 60 });
  if (h * 60 > min && site !== servidorSemTempo) { mesmoLimite = false; ex2 = `agora ${min / 60}h, concentração ${h}h: site ${site}, servidor ${servidorSemTempo}`; }
}
checar("H1  o site esconde exatamente os horários que o servidor recusaria (sem_tempo_pagamento), das 6h às 18h", mesmoLimite, ex2);

// ---------------- corpo do POST ----------------
const base = { plano: "essencial", data: AMANHA, hora: 9, pax: 2, nome: "Ana", "cf-turnstile-response": "x" };
checar("E1  flag desligada: o corpo do POST é o MESMO objeto, sem 'pagamento'", P.corpoDoPedido(base, null, PL("essencial"), AMANHA, "sinal") === base && !("pagamento" in base));
checar("E1  parapente com a flag ligada: corpo igual (não passa pela API de qualquer jeito)", P.corpoDoPedido(base, cfg, PARAPENTE, AMANHA, "sinal") === base);
const c1 = P.corpoDoPedido(base, cfg, PL("essencial"), AMANHA, "sinal");
const c2 = P.corpoDoPedido(base, cfg, PL("essencial"), HOJE, "sinal");
checar("E1  flag ligada: corpo ganha só 'pagamento' (sinal; no mesmo dia vira integral)", c1 !== base && c1.pagamento === "sinal" && JSON.stringify({ ...c1, pagamento: undefined }) === JSON.stringify(base) && c2.pagamento === "integral");

// ---------------- resposta do POST ----------------
const ok200 = { ok: true, restam: 9, pagamento: { modalidade: "sinal", mesmoDia: false, valor: 48, total: 160, saldo: 112, link: "https://sandbox.asaas.com/checkoutSession/show?id=abc", ref: "a".repeat(32), expiraEm: "x" } };
const r1 = P.respostaDoEnvio(200, ok200);
checar("R1  200 com link do Asaas: segue para o link, com o valor do SERVIDOR", r1.acao === "pagar" && r1.link === ok200.pagamento.link && r1.agoraCentavos === 4800 && r1.saldoCentavos === 11200 && r1.ref === "a".repeat(32));
checar("R1  link que não é https do Asaas não é seguido (vira 'indisponível')", ["http://sandbox.asaas.com/x", "https://asaas.com.evil.io/x", "https://evilasaas.com/x", "javascript:alert(1)", "https://u:p@www.asaas.com/x", ""].every(l => P.respostaDoEnvio(200, { ...ok200, pagamento: { ...ok200.pagamento, link: l } }).acao === "indisponivel")
  && P.linkSeguro("https://www.asaas.com/c/xyz") === "https://www.asaas.com/c/xyz" && P.linkSeguro("https://asaas.com/c/1") !== null);
checar("R1  409 sem_tempo_pagamento → mensagem 'não dá mais tempo de pagar para esse horário'", P.respostaDoEnvio(409, { ok: false, motivo: "sem_tempo_pagamento" }).acao === "sem_tempo" && /não dá mais tempo de pagar para esse horário/i.test(P.MENSAGEM.sem_tempo));
checar("R1  409 sem_tempo_sinal → pede 100%; 409 mesmo_dia_integral → 100%; 422 erros.pagamento → escolher", P.respostaDoEnvio(409, { motivo: "sem_tempo_sinal" }).acao === "so_integral" && P.respostaDoEnvio(409, { motivo: "mesmo_dia_integral" }).acao === "mesmo_dia" && P.respostaDoEnvio(422, { ok: false, erros: { pagamento: "Escolha" } }).acao === "escolher");
checar("R1  503 (pagamento indisponível), rede caída (0), 429 e 5xx → 'indisponível' com WhatsApp, nada cobrado", [503, 0, 429, 500, 502, 403].every(s => P.respostaDoEnvio(s, { ok: false, motivo: "pagamento_indisponivel" }).acao === "indisponivel") && /indisponível/.test(P.MENSAGEM.indisponivel) && /Nada foi cobrado/.test(P.MENSAGEM.indisponivel));
checar("R1  409 duplicado/cheio/chave_em_uso, 422 de outro campo e 200 sem pagamento → tratamento antigo", ["duplicado", "cheio", "chave_em_uso"].every(m => P.respostaDoEnvio(409, { motivo: m }) === null) && P.respostaDoEnvio(422, { erros: { nome: "x" } }) === null && P.respostaDoEnvio(200, { ok: true, codigo: "TA-1234-ABCD", whatsapp: "https://wa.me/1" }) === null);

// ---------------- página de volta ----------------
checar("V1  ref da URL: só 32 hex", P.refDaURL("?pagamento=" + "b".repeat(32)) === "b".repeat(32) && P.refDaURL("?pagamento=xyz") === null && P.refDaURL("?pagamento=" + "B".repeat(32)) === null && P.refDaURL("") === null);
const base200 = { ok: true, tipo: "sinal", valor: 48, passeio: "Trindade Essencial", data: AMANHA, hora: "09:00", pax: 2 };
const E = (st, extra) => P.estadoDoRetorno(200, { ...base200, status: st, ...extra });
const aguard = E("aguardando");
checar("V1  aguardando: continua consultando, sem código", aguard.estado === "aguardando" && !aguard.final && !aguard.codigo && /Aguardando/.test(P.textoDoRetorno(aguard).titulo));
const pago = E("pago", { saldo: 112, confirmada: true, codigo: "TA-2610-ABCD", situacao: "confirmada" });
checar("V1  pago (servidor confirmou): para, mostra o código e o saldo", pago.estado === "pago" && pago.final && pago.codigo === "TA-2610-ABCD" && /R\$ 112/.test(P.textoDoRetorno(pago).texto) && /12 horas antes/.test(P.textoDoRetorno(pago).texto));
const pagoInt = P.estadoDoRetorno(200, { ...base200, tipo: "integral", valor: 160, status: "pago", saldo: 0, confirmada: true, codigo: "TA-2610-ABCD", situacao: "confirmada" });
checar("V1  pago 100%: reserva quitada, sem falar de saldo", /quitada/.test(P.textoDoRetorno(pagoInt).texto) && !/saldo/.test(P.textoDoRetorno(pagoInt).texto));
checar("V1  pago com código fora do formato: não mostra código, segue consultando", (e => e.estado === "processando" && !e.final && !e.codigo)(E("pago", { confirmada: true, codigo: "<b>x</b>", situacao: "confirmada" })));
checar("V1  pago, ainda processando: segue consultando", (e => e.estado === "processando" && !e.final)(E("pago", { situacao: "processando", confirmada: false })));
const semVaga = E("pago", { situacao: "sem_vaga", confirmada: false });
checar("V1  pago_sem_vaga: 'a equipe vai entrar em contato para você escolher entre reagendar e devolução', sem prazo", semVaga.estado === "pago_sem_vaga" && semVaga.final && P.textoDoRetorno(semVaga).texto === "A equipe vai entrar em contato para você escolher entre reagendar e devolução." && !/\d+\s*(h|horas|dias|min)/.test(P.textoDoRetorno(semVaga).texto));
checar("V1  expirado / expirada: para, vaga liberada, nada cobrado", ["expirado", "expirada"].every(s => (e => e.estado === "expirado" && e.final && /nada foi cobrado/.test(P.textoDoRetorno(e).texto))(E(s))));
checar("V1  cancelado / cancelada: para, nada cobrado", ["cancelado", "cancelada"].every(s => (e => e.estado === "cancelado" && e.final && /Nada foi cobrado/.test(P.textoDoRetorno(e).texto))(E(s))));
checar("V1  cancelada sem saldo (sinal retido): para, explica", (e => e.estado === "cancelada_sem_saldo" && e.final && /15 minutos/.test(P.textoDoRetorno(e).texto))(E("pago", { situacao: "cancelada_sem_saldo", confirmada: false })));
checar("V1  404 'Pagamento não encontrado.' → aviso; 404 'Rota não encontrada.' (flag desligada) → não mostra nada novo", P.estadoDoRetorno(404, { ok: false, erro: "Pagamento não encontrado." }).estado === "nao_encontrado" && (e => e.estado === "desligado" && e.final)(P.estadoDoRetorno(404, { ok: false, erro: "Rota não encontrada." })) && P.estadoDoRetorno(404, null).estado === "desligado");
checar("V1  429 / rede / 5xx: segue tentando", [0, 429, 500, 503].every(s => (e => e.estado === "erro_rede" && !e.final)(P.estadoDoRetorno(s, null))));
checar("V1  campos de texto da resposta são limitados (passeio ≤ 80, data/hora no formato)", (e => e.passeio.length === 80 && e.data === "" && e.hora === "")(P.estadoDoRetorno(200, { ok: true, status: "aguardando", passeio: "x".repeat(200), data: "<i>", hora: "9h" })));

// ---------------- só Pix ----------------
const trechoPuro = appSrc.slice(appSrc.indexOf("<pagamento-puro>"), appSrc.indexOf("/* ------------------------------ eventos da reserva"));
checar("C1  nenhum cartão no site: app.js sem CREDIT_CARD/DEBIT_CARD/'cartão de crédito'; o passo diz 'só Pix'", !/CREDIT_CARD|DEBIT_CARD|cart[aã]o de cr[eé]dito/i.test(appSrc) && /só Pix/.test(trechoPuro));

// ---------------- fluxo antigo intacto com a flag desligada (leitura do código) ----------------
checar("A1  envio: a aba em branco do WhatsApp só deixa de abrir quando o passeio paga online", /const abaWA = pgOnline \? null : window\.open\("", "_blank"\);/.test(appSrc));
checar("A1  envio: o corpo passa por corpoDoPedido (que devolve o mesmo objeto com a flag desligada)", /JSON\.stringify\(PagamentoPuro\.corpoDoPedido\(\{/.test(appSrc));
checar("A1  envio: a chave de idempotência só muda quando paga online", /\.concat\(pgOnline \? \[escolhaPg\] : \[\]\)\.join\("\|"\)/.test(appSrc));
checar("A1  o passo 'Pagamento' só é criado quando há configuração do servidor", /if \(!pagamentoCfg && !passo\) return;/.test(appSrc) && !/id="passoPagamento"/.test(ler("../site/index.html")));
checar("A1  a página de volta só aparece com ?pagamento=<32 hex> em /reservar, e 404 de rota não mostra nada", /lerRota\(\)\.nome === "reservar" \? PagamentoPuro\.refDaURL\(location\.search\)/.test(appSrc) && /e\.estado === "desligado"/.test(appSrc));

// ======================= PAINEL (admin.html) =======================
const adminSrc = ler("../site/admin.html");
const A = recortar(adminSrc, "painel-pagamento-puro", "PainelPagamento");
const R = (o) => ({ id: "r1", codigo: "TA-1", status: "confirmada", total: 160, pax: 2, plano: "essencial", ...o });
const sinal = A.linha(R({ pagamento_modalidade: "sinal", pagamento_status: "sinal_pago", pago_centavos: 4800, cobranca_tipo: "sinal", cobranca_status: "paga" }));
checar("G1  linha com sinal pago: modalidade, pago R$ 48, saldo R$ 112, cobrança 'sinal: paga'", sinal.modalidade === "sinal 30%" && sinal.pago === "R$ 48" && sinal.saldo === "R$ 112" && sinal.status === "sinal pago" && sinal.cobranca === "sinal: paga", JSON.stringify(sinal));
checar("G1  sinal pago e confirmada → botão 'gerar link do saldo'; sem reagendar/devolver", sinal.acoes.saldo && !sinal.acoes.reagendar && !sinal.acoes.devolver);
const quit = A.linha(R({ pagamento_modalidade: "integral", pagamento_status: "quitado", pago_centavos: 16000, cobranca_tipo: "integral", cobranca_status: "paga" }));
checar("G1  integral quitado: saldo R$ 0, sem botão de saldo", quit.modalidade === "integral" && quit.saldo === "R$ 0" && !quit.acoes.saldo && !quit.acoes.devolver);
const semTempo = A.linha(R({ pagamento_modalidade: "sinal", pagamento_status: "sinal_pago", pago_centavos: 4800, saldo_sem_tempo: true }));
checar("G1  saldo_sem_tempo: indicador e sem botão de saldo (o servidor recusaria)", !semTempo.acoes.saldo && semTempo.alertas.some(x => /tarde/.test(x.texto)));
const pSemVaga = A.linha(R({ status: "pendente", pagamento_modalidade: "integral", pagamento_status: "pago_sem_vaga", pago_centavos: 16000 }));
checar("G1  pago_sem_vaga: alerta + 'reagendar' e 'devolver'", pSemVaga.acoes.reagendar && pSemVaga.acoes.devolver && !pSemVaga.acoes.saldo && pSemVaga.alertas.some(x => x.tipo === "erro" && /reagende ou devolva/.test(x.texto)));
const retido = A.linha(R({ status: "cancelada", pagamento_modalidade: "sinal", pagamento_status: "sinal_retido", pago_centavos: 4800 }));
checar("G1  cancelada por saldo não pago: indicador 'sinal retido', sem ações", retido.status === "sinal retido" && retido.alertas.some(x => /sinal retido/.test(x.texto)) && !retido.acoes.saldo && !retido.acoes.devolver && !retido.acoes.reagendar);
const manual = A.linha(R({ status: "cancelada", pagamento_modalidade: "integral", pagamento_status: "devolucao_manual", pago_centavos: 16000 }));
checar("G1  devolucao_manual: indicador 'devolver por fora' e botão para tentar de novo", manual.status === "devolver por fora" && manual.acoes.devolver && manual.alertas.some(x => /por fora/.test(x.texto)));
const local = A.linha(R({ pagamento_modalidade: "sinal", pagamento_status: "saldo_no_local", pago_centavos: 4800 }));
checar("G1  saldo pago no local: saldo R$ 0, sem botões de saldo", local.status === "saldo pago no local" && local.saldo === "R$ 0" && !local.acoes.saldo && !local.acoes.saldoLocal);
checar("G1  botão 'saldo pago no local' só com confirmada + sinal pago (inclusive quando já não dá tempo do link)", sinal.acoes.saldoLocal && semTempo.acoes.saldoLocal && !quit.acoes.saldoLocal && !A.linha(R({ status: "pendente", pagamento_modalidade: "sinal", pagamento_status: "sinal_pago" })).acoes.saldoLocal);
checar("G3  'saldo pago no local' pede confirmação antes de chamar o servidor", /if \(!confirm\("Marcar o saldo de "/.test(adminSrc) && /\/saldo-local"/.test(adminSrc));
const antiga = A.linha(R({ pagamento_modalidade: null, pagamento_status: null }));
checar("G1  reserva sem pagamento online (WhatsApp/balcão): colunas '—' e nenhum botão novo", antiga.modalidade === "—" && antiga.pago === "—" && antiga.saldo === "—" && !antiga.acoes.saldo && !antiga.acoes.reagendar && !antiga.acoes.devolver);
const disp = { ok: true, grade: { "8": { restam: 5, bloqueado: false }, "9": { restam: 1, bloqueado: false }, "10": { restam: 20, bloqueado: true }, "8.5": { restam: 9, bloqueado: false } }, horariosPorPlano: { essencial: [8, 9, 10], boat: [8.5, 11] } };
checar("G2  reagendar: só horários do passeio, sem bloqueio e com vaga para o grupo", A.horariosLivres(disp, "essencial", 2).join() === "8" && A.horariosLivres(disp, "essencial", 1).join() === "8,9" && A.horariosLivres(disp, "boat", 2).join() === "8.5" && A.horariosLivres(null, "boat", 1).length === 0 && A.horariosLivres({ ok: false }, "boat", 1).length === 0);
checar("G3  painel: colunas e botões novos só quando a lista traz pagamentoOnline === true", /const pg = d\.pagamentoOnline === true;/.test(adminSrc) && /\(pg \? "<th>Modalidade<\/th><th>Pago<\/th><th>Saldo<\/th><th>Cobrança<\/th>" : ""\)/.test(adminSrc) && /\(pg \? colunasPagamento\(r\) : ""\)/.test(adminSrc));
checar("G3  'gerar link do saldo' só mostra e copia o link (não envia nada ao cliente)", /o painel não envia nada/.test(adminSrc) && /navigator\.clipboard\.writeText/.test(adminSrc) && !/wa\.me|sendMessage|mailto:/.test(adminSrc.slice(adminSrc.indexOf("<painel-pagamento-puro>"), adminSrc.indexOf('$("#fAplicar")'))));
checar("G3  devolver pede confirmação antes de chamar o servidor", /if \(!confirm\("Devolver "/.test(adminSrc));

console.log(`\n${total - falhas}/${total} verificações passaram${falhas ? ` — ${falhas} FALHA(S)` : ""}.\n`);
process.exit(falhas ? 1 : 0);

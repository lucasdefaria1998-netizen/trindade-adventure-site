// Rede de parceiros indicadores (migracoes/0004_parceiros.sql): cadastro, QR/link, atribuição,
// check-in e comissão. Precisa de Node 22.5+ (node:sqlite, mesma exigência de testar-api.mjs) e do
// wrangler pages dev em http://127.0.0.1:8788 (ver LEIA-ME — "Testar antes de publicar").
// Liga e desliga config.parceiros_ativo durante o teste; termina com a flag desligada e os dados de
// teste apagados, para não interferir nos outros scripts.
import {
  checar, resumo, post, reservaValida, ipNovo, telNovo, exec, sql, BASE, contar,
  iniciarServidorDeCertificados, criarJwtAccess, ACCESS_AUD_TESTE, PORTA_CERTS
} from "./lib-testes.mjs";

await iniciarServidorDeCertificados();
const jwt = criarJwtAccess();
const admin = (caminho, opts = {}) => fetch(BASE + "/api/admin" + caminho, {
  ...opts,
  headers: { "content-type": "application/json", "cf-access-jwt-assertion": jwt, origin: BASE, ...(opts.headers || {}) }
});
const jsonDe = async r => { try { return await r.json(); } catch { return null; } };

for (const t of ["reservas", "eventos", "checkins", "comissoes", "vouchers", "parceiros", "guias"]) {
  try { exec(`DELETE FROM ${t}`); } catch { /* tabela ainda não existe (flag nunca foi ligada) */ }
}
exec("UPDATE config SET valor = '0' WHERE chave = 'parceiros_ativo'");

console.log(`\nTestando a rede de parceiros em ${BASE}\n`);

// ---------- Flag desligada: nada novo responde, nada novo roda ----------
{
  const r1 = await admin("/parceiros");
  checar("P1 flag desligada: GET /api/admin/parceiros → 404", r1.status === 404, r1.status);
  const r2 = await admin("/guias");
  checar("P1 flag desligada: GET /api/admin/guias → 404", r2.status === 404, r2.status);
  const r3 = await fetch(BASE + "/api/parceiro?codigo=abcdef");
  checar("P1 flag desligada: GET /api/parceiro → 404 (rota some, não erro de validação)", r3.status === 404, r3.status);
  // Reserva normal continua funcionando igual, mesmo mandando campos de parceiro.
  const antes = contar();
  const rv = await post("/api/reservas", { corpo: reservaValida({ parceiroCodigo: "qualquercoisa", parceiroCupom: "X" }) });
  const j = await jsonDe(rv);
  checar("P1 flag desligada: reserva com campos de parceiro é aceita normalmente", rv.status === 200 && j.ok, rv.status);
  checar("P1 flag desligada: grava 1 linha (sem travar por causa dos campos extras)", contar() === antes + 1);
}

// ---------- Liga a flag; dali em diante os testes usam a rede ----------
{
  const r = await admin("/config", { method: "POST", body: JSON.stringify({ parceiros_ativo: "1" }) });
  checar("P2 liga parceiros_ativo pelo /api/admin/config", r.status === 200 && (await jsonDe(r)).ok);
}

// ---------- Admin: sem JWT/sem Access → 403; cadastro exige nome e tipo ----------
{
  const r1 = await fetch(BASE + "/api/admin/parceiros");
  checar("P3 sem Cf-Access-Jwt-Assertion → 403", r1.status === 403, r1.status);
  const r2 = await admin("/parceiros", { method: "POST", body: JSON.stringify({ nome: "" }) });
  checar("P3 sem nome/tipo → 422", r2.status === 422, r2.status);
  const r3 = await admin("/parceiros", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ nome: "X", tipo: "outro" }) });
  checar("P3 mutação com Origin de fora → 403 (mesmo portão do resto do admin)", r3.status === 403, r3.status);
}

// ---------- Cadastro, código não adivinhável, cupom em caixa alta ----------
let parceiroId, parceiroCodigo;
{
  const nome = 'Pousada "<script>alert(1)</script>" & Cia';
  const r = await admin("/parceiros", { method: "POST", body: JSON.stringify({ nome, tipo: "pousada", cupom: "testcupom1" }) });
  const j = await jsonDe(r);
  checar("P4 cria parceiro → 200 com id e código", r.status === 200 && j.ok && j.id && j.codigo, r.status);
  parceiroId = j.id; parceiroCodigo = j.codigo;
  checar("P4 código não é o nome/slug do parceiro (S3) — só letras/números, 6+ chars", /^[a-z0-9]{6,32}$/.test(parceiroCodigo), parceiroCodigo);

  const lst = await jsonDe(await admin("/parceiros"));
  const linha = lst.parceiros.find(p => p.id === parceiroId);
  checar("P4 nome com HTML é guardado como texto puro (sem sanitizar no servidor — o painel escapa ao desenhar)", linha.nome === nome);
  checar("P4 cupom salvo em caixa alta", linha.cupom === "TESTCUPOM1", linha.cupom);

  const dup = await admin("/parceiros", { method: "POST", body: JSON.stringify({ nome: "Outro", tipo: "outro", cupom: "testcupom1" }) });
  checar("P4 cupom duplicado → 409", dup.status === 409, dup.status);
}

// ---------- Link curto do QR ----------
{
  const r = await fetch(BASE + "/p/" + parceiroCodigo, { redirect: "manual" });
  checar("P5 GET /p/<codigo> → 302 para /reservar?parceiro=<codigo>&parceiroVia=qr", r.status === 302 && r.headers.get("location") === BASE + "/reservar?parceiro=" + parceiroCodigo + "&parceiroVia=qr", r.headers.get("location"));
  const r2 = await fetch(BASE + "/p/não-existe-123456789012345678901234567890", { redirect: "manual" });
  checar("P5 código fora do formato → não casa a rota (404 normal, não um redirect)", r2.status !== 302, r2.status);
}

// ---------- Consulta pública (F2): só o nome, nunca lista, nunca distingue inexistente de inativo ----------
{
  const r = await fetch(BASE + "/api/parceiro?codigo=" + parceiroCodigo);
  const j = await jsonDe(r);
  checar("P6 consulta pública do código válido → 200 com o nome", r.status === 200 && j.nome, r.status);
  const r2 = await fetch(BASE + "/api/parceiro?codigo=naoexisteisso123");
  checar("P6 código inexistente → 404 (igual ao de um parceiro inativo, não dá pra distinguir)", r2.status === 404, r2.status);
  const r3 = await fetch(BASE + "/api/parceiro?codigo=" + encodeURIComponent("' OR 1=1--"));
  checar("P6 código com SQL/símbolos → 404, nunca erro 500", r3.status === 404, r3.status);
}

// ---------- Atribuição: o servidor resolve; parceiro_id do cliente é sempre ignorado (S3) ----------
let reservaComParceiroId, reservaComCupomId, reservaSemParceiroId;
{
  const antes = contar();
  const rv1 = await post("/api/reservas", { corpo: reservaValida({ parceiroCodigo, parceiroVia: "qr", parceiro_id: "forjado-pelo-cliente" }) });
  const j1 = await jsonDe(rv1);
  checar("P7 reserva com código de parceiro válido → 200", rv1.status === 200 && j1.ok, rv1.status);
  let linha = sql("SELECT id, parceiro_id, parceiro_via FROM reservas WHERE codigo = ?", j1.codigo)[0];
  reservaComParceiroId = linha.id;
  checar("P7 parceiro_id resolvido é o do parceiro de verdade, não o 'forjado-pelo-cliente'", linha.parceiro_id === parceiroId, linha.parceiro_id);
  checar("P7 via = qr (como veio no pedido)", linha.parceiro_via === "qr", linha.parceiro_via);

  const rv2 = await post("/api/reservas", { corpo: reservaValida({ parceiroCupom: "testcupom1" }) }); // minúsculo
  const j2 = await jsonDe(rv2);
  linha = sql("SELECT id, parceiro_id, parceiro_via FROM reservas WHERE codigo = ?", j2.codigo)[0];
  reservaComCupomId = linha.id;
  checar("P7 cupom digitado em minúsculo também resolve (comparação não é sensível a caixa)", linha.parceiro_id === parceiroId && linha.parceiro_via === "cupom", JSON.stringify(linha));

  const rv3 = await post("/api/reservas", { corpo: reservaValida({ parceiroCodigo: "codigo-que-nao-existe-123456" }) });
  const j3 = await jsonDe(rv3);
  checar("P7 código inexistente → reserva normal (200), sem parceiro, sem erro ao turista", rv3.status === 200 && j3.ok, rv3.status);
  linha = sql("SELECT id, parceiro_id FROM reservas WHERE codigo = ?", j3.codigo)[0];
  reservaSemParceiroId = linha.id;
  checar("P7 …e sem parceiro_id gravado", linha.parceiro_id === null, linha.parceiro_id);

  checar("P7 gravou exatamente 3 reservas novas", contar() === antes + 3);
}

// ---------- Parceiro inativo: deixa de atribuir, sem erro ----------
{
  await admin("/parceiros/" + parceiroId, { method: "PATCH", body: JSON.stringify({ ativo: false }) });
  const rv = await post("/api/reservas", { corpo: reservaValida({ parceiroCodigo }) });
  const j = await jsonDe(rv);
  checar("P8 parceiro desativado: reserva com o mesmo código → 200, sem parceiro", rv.status === 200 && j.ok, rv.status);
  const linha = sql("SELECT parceiro_id FROM reservas WHERE codigo = ?", j.codigo)[0];
  checar("P8 …parceiro_id vazio", linha.parceiro_id === null);
  await admin("/parceiros/" + parceiroId, { method: "PATCH", body: JSON.stringify({ ativo: true }) }); // reativa para o resto do teste
}

// ---------- Check-in: presentes 0..pax, comissão = presentes × comissao_por_pax_centavos ----------
{
  const r1 = await admin("/reservas/" + reservaComParceiroId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 99 }) });
  checar("P9 presentes maior que pax → 422", r1.status === 422, r1.status);

  const r2 = await admin("/reservas/" + reservaComParceiroId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 2 }) });
  const j2 = await jsonDe(r2);
  checar("P9 check-in com 2 presentes → 200, status presente", r2.status === 200 && j2.status === "presente", r2.status);
  let com = sql("SELECT valor_centavos, status FROM comissoes WHERE reserva_id = ?", reservaComParceiroId)[0];
  checar("P9 comissão = 2 × 1000 = 2000 centavos, pendente", com.valor_centavos === 2000 && com.status === "pendente", JSON.stringify(com));

  // Refazer o check-in recalcula sem duplicar linha.
  const r3 = await admin("/reservas/" + reservaComParceiroId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 1 }) });
  checar("P9 refazer check-in (1 presente) → 200", r3.status === 200);
  const linhas = sql("SELECT COUNT(*) AS n FROM checkins WHERE reserva_id = ?", reservaComParceiroId)[0];
  checar("P9 continua 1 linha só em checkins (idempotente)", Number(linhas.n) === 1);
  com = sql("SELECT valor_centavos FROM comissoes WHERE reserva_id = ?", reservaComParceiroId)[0];
  checar("P9 comissão recalculada para 1 × 1000 = 1000", com.valor_centavos === 1000, com.valor_centavos);

  // 0 presentes = faltou, sem comissão nova.
  const r4 = await admin("/reservas/" + reservaComCupomId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 0 }) });
  const j4 = await jsonDe(r4);
  checar("P9 0 presentes → status faltou", r4.status === 200 && j4.status === "faltou", JSON.stringify(j4));
  const comFaltou = sql("SELECT COUNT(*) AS n FROM comissoes WHERE reserva_id = ?", reservaComCupomId)[0];
  checar("P9 faltou: nenhuma linha de comissão pendente criada", Number(comFaltou.n) === 0);

  // Sem parceiro: check-in funciona, mas não cria comissão.
  const r5 = await admin("/reservas/" + reservaSemParceiroId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 2 }) });
  checar("P9 reserva sem parceiro: check-in → 200", r5.status === 200);
  const semCom = sql("SELECT COUNT(*) AS n FROM comissoes WHERE reserva_id = ?", reservaSemParceiroId)[0];
  checar("P9 …e sem comissão (não tinha parceiro)", Number(semCom.n) === 0);
}

// ---------- Cancelamento cancela comissão pendente (nunca a paga) ----------
{
  const idDaComissao = sql("SELECT id FROM comissoes WHERE reserva_id = ?", reservaComParceiroId)[0].id;
  const pagar = await admin("/comissoes/" + idDaComissao + "/pagar", { method: "POST", body: JSON.stringify({ obs: "teste" }) });
  checar("P10 marcar como pago → 200", pagar.status === 200);
  const pagarDeNovo = await admin("/comissoes/" + idDaComissao + "/pagar", { method: "POST", body: "{}" });
  checar("P10 marcar como pago de novo → 409 (já está paga)", pagarDeNovo.status === 409, pagarDeNovo.status);

  // Cancela a reserva do cupom (que ainda tem comissão pendente de outra rodada de check-in).
  await admin("/reservas/" + reservaComCupomId + "/checkin", { method: "POST", body: JSON.stringify({ presentes: 1 }) });
  const cancelar = await admin("/reservas/" + reservaComCupomId, { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) });
  checar("P10 cancelar reserva → 200", cancelar.status === 200);
  const comCancelada = sql("SELECT status FROM comissoes WHERE reserva_id = ?", reservaComCupomId)[0];
  checar("P10 comissão pendente passa a cancelada", comCancelada.status === "cancelada", comCancelada.status);

  const paga = sql("SELECT status FROM comissoes WHERE id = ?", idDaComissao)[0];
  checar("P10 comissão já paga não é afetada por cancelamentos de outras reservas", paga.status === "paga");
}

// ---------- Guias: cadastro simples ----------
{
  const r = await admin("/guias", { method: "POST", body: JSON.stringify({ nome: "Guia Teste", whatsapp: "(24) 99999-1111" }) });
  const j = await jsonDe(r);
  checar("P11 cadastra guia → 200", r.status === 200 && j.id, r.status);
  const lst = await jsonDe(await admin("/guias"));
  const g = lst.guias.find(x => x.id === j.id);
  checar("P11 whatsapp gravado só com dígitos", g.whatsapp === "24999991111", g.whatsapp);
}

// ---------- adminListarReservas: parceiro/guia/check-in/comissão aparecem; sem PII ao parceiro (isso é sobre a API do admin mesmo, atrás do Access) ----------
{
  const j = await jsonDe(await admin("/reservas?de=2000-01-01&ate=2999-12-31"));
  checar("P12 resposta marca parceirosAtivo: true", j.parceirosAtivo === true);
  const linha = j.reservas.find(r => r.id === reservaComParceiroId);
  checar("P12 reserva trai o nome do parceiro", linha.parceiro && linha.parceiro.nome, JSON.stringify(linha.parceiro));
  checar("P12 checkin aparece com presentes/status", linha.checkin && linha.checkin.status === "presente", JSON.stringify(linha.checkin));
  checar("P12 comissao aparece com valor/status", linha.comissao && linha.comissao.status === "paga", JSON.stringify(linha.comissao));
}

// ---------- Desliga a flag de novo: tudo volta a 404, reserva comum continua OK ----------
{
  await admin("/config", { method: "POST", body: JSON.stringify({ parceiros_ativo: "0" }) });
  const r = await admin("/parceiros");
  checar("P13 flag desligada de novo: /api/admin/parceiros → 404", r.status === 404, r.status);
  const rv = await post("/api/reservas", { corpo: reservaValida() });
  checar("P13 reserva comum continua funcionando com a flag desligada", rv.status === 200 && (await jsonDe(rv)).ok, rv.status);
}

for (const t of ["reservas", "eventos", "checkins", "comissoes", "vouchers", "parceiros", "guias"]) {
  try { exec(`DELETE FROM ${t}`); } catch { /* ignore */ }
}
resumo();

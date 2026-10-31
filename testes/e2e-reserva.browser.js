// Ponta a ponta da reserva, para colar no console do navegador (ou rodar pelo
// javascript_tool) em http://127.0.0.1:8788/reservar — só contra o servidor LOCAL.
// Troca window.open por um stub (nunca abre o WhatsApp de verdade) e devolve
// um resumo: código do pedido, URL do WhatsApp e o texto decodificado.
// Uso:  await window.__e2e("essencial")   |   "adventure"   |   "boat"
window.__e2e = async function (plano, opcoes = {}) {
  const esp = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const urls = []; let abaFechada = false;
  const abrirReal = window.open;
  window.open = () => ({ set location(v) { urls.push(String(v)); }, close() { abaFechada = true; } });
  try {
    if ($("#reservaFeita") && !$("#reservaFeita").hidden && $("#btnNova")) { $("#btnNova").click(); await esp(300); }
    const bp = $(`[data-plano="${plano}"]`); if (!bp) return { erro: "botão do plano não achado" };
    bp.click(); await esp(300);
    const sp = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    const dia = opcoes.data || sp(new Date(Date.now() + 864e5));
    const dt = $("#dtPick"); dt.value = dia; dt.dispatchEvent(new Event("change", { bubbles: true }));
    await esp(1500);
    const horas = [...document.querySelectorAll("#listaHorarios [data-hora]:not([disabled])")];
    if (!horas.length) return { erro: "nenhum horário livre", dia };
    const alvo = opcoes.hora != null ? horas.find(h => Number(h.dataset.hora) === opcoes.hora) : horas[0];
    alvo.click(); await esp(200);
    const tel = "24" + "9" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const campo = (sel, v, ev = "input") => { const e = $(sel); e.value = v; e.dispatchEvent(new Event(ev, { bubbles: true })); };
    campo("#fNome", opcoes.nome || "Teste E2E Automatizado"); campo("#fTel", tel); campo("#fEmail", "teste.e2e@example.com");
    campo("#fObs", opcoes.obs || "Reserva de teste local"); campo("#fPax", String(opcoes.pax || 2), "change");
    const ac = $("#fAceiteTermos"); ac.checked = true; ac.dispatchEvent(new Event("change", { bubbles: true }));
    $("#formReserva").requestSubmit();
    for (let i = 0; i < 100 && ($("#reservaFeita").hidden); i++) await esp(250);
    const feita = !$("#reservaFeita").hidden;
    const url = urls[0] || "";
    const texto = (() => { try { return decodeURIComponent((url.split("?text=")[1]) || ""); } catch { return "(não decodificou)"; } })();
    return {
      plano, dia, hora: alvo.dataset.hora, telefone: tel, confirmacaoVisivel: feita,
      codigo: feita ? ($(".codigo .num") || {}).textContent : null, abaFechada,
      urlWA: url.split("?")[0], textoWA: texto,
      linhasConfirmacao: feita ? [...document.querySelectorAll("#reservaFeita .linha")].map(l => l.textContent.replace(/\s+/g, " ").trim()) : []
    };
  } finally { window.open = abrirReal; }
};

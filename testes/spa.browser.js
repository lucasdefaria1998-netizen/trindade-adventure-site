// Navegação sem recarregar (S12/S13), para rodar no navegador em http://127.0.0.1:8788 (local):
//   (0,eval)(await (await fetch("http://127.0.0.1:8790/spa.browser.js")).text()); await window.__spa.tudo()
// Confere, a cada passo: seção visível, aba/painel e exatamente um <h1>. O painel embutido do
// Claude não dispara requestAnimationFrame; por isso aqui ele vira setTimeout (só para o teste).
window.__spa = {
  async tudo() {
    window.requestAnimationFrame = f => setTimeout(() => f(performance.now()), 16);
    const esp = ms => new Promise(r => setTimeout(r, ms));
    const $ = s => document.querySelector(s);
    const estado = () => ({ caminho: location.pathname, secoes: [...document.querySelectorAll("[data-secao]:not([hidden])")].map(s => s.dataset.secao).join(), aba: [...document.querySelectorAll("[data-aba]")].filter(b => b.getAttribute("aria-selected") === "true").map(b => b.dataset.aba).join(), painel: [...document.querySelectorAll(".painel-roteiro:not([hidden])")].map(p => p.id).join(), h1s: [...document.querySelectorAll("h1")].map(h => h.textContent.trim()) });
    const topo = id => Math.round(document.getElementById(id).getBoundingClientRect().top);
    const passos = [];
    const reg = (nome, extra) => passos.push({ nome, ...estado(), ...(extra || {}) });
    navegar("/"); await esp(400); reg("início");
    $('[data-aba]') || navegar("/passeios"); navegar("/passeios/adventure"); await esp(500); reg("passeios/adventure");
    $('[data-aba="boat"]').click(); await esp(400); reg("clique na aba Boat");
    $('[data-aba="essencial"]').click(); await esp(400); reg("clique na aba Essencial");
    navegar("/passeios/juatinga"); await esp(900); reg("passeios/juatinga", { cardNoTopo: topo("consulta-juatinga") });
    navegar("/passeios/mamangua"); await esp(900); reg("passeios/mamangua", { cardNoTopo: topo("consulta-mamangua") });
    history.back(); await esp(600); reg("voltar");
    history.forward(); await esp(600); reg("avançar");
    navegar("/contato"); await esp(500); reg("contato");
    navegar("/reservar?plano=boat"); await esp(700); reg("reservar?plano=boat", { plano: ($('#escolhaPlano [aria-pressed="true"] .plano-nome') || {}).textContent });
    return { todosComUmH1: passos.every(p => p.h1s.length === 1), passos };
  }
};

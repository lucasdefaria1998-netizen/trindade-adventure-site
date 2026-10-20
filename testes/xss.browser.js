// Testes de saída segura (S08) para rodar no navegador, só em http://127.0.0.1:8788 (local).
// Carregue com:  (0,eval)(await (await fetch("http://127.0.0.1:8790/xss.browser.js")).text())
// e rode:        await window.__xss.tudo()
// Nada aqui toca produção: o "servidor malicioso" é um fetch substituído só nesta aba.
window.__xss = {
  async resposta_do_servidor() {
    // O servidor (simulado) devolve um código com HTML e um link javascript:
    const fetchReal = window.fetch; const abertas = []; const abrirReal = window.open; window.__executou = undefined;
    window.fetch = async (u, o) => {
      if (String(u).includes("/api/reservas") && o && o.method === "POST")
        return new Response(JSON.stringify({ ok: true, codigo: "<img src=x onerror=window.__executou='codigo'>", restam: 3, whatsapp: "javascript:window.__executou='link'", mensagem: "x" }), { status: 200, headers: { "content-type": "application/json" } });
      return fetchReal(u, o);
    };
    window.open = () => ({ set location(v) { abertas.push(String(v)); }, close() {} });
    try {
      await window.__e2e("essencial");
      await new Promise(r => setTimeout(r, 400));
      const html = document.querySelector("#reservaFeita").innerHTML;
      const link = document.querySelector("#btnAbrirWA");
      return {
        executou: window.__executou ?? null,
        imgInjetada: !!document.querySelector("#reservaFeita img[src='x']"),
        codigoMostrado: (document.querySelector(".codigo .num") || {}).textContent,
        hrefDoBotao: link && link.getAttribute("href").slice(0, 40),
        abas: abertas.map(u => u.slice(0, 40)),
        contemJavascriptNoHtml: /javascript:/i.test(html)
      };
    } finally { window.fetch = fetchReal; window.open = abrirReal; }
  },

  async clima_adulterado() {
    window.__executou = undefined;
    const lixo = { ts: Date.now(), dados: { temp: 25, sensacao: "<b>", vento: "10", dia: true, texto: "<img src=x onerror=window.__executou='clima'>", icone: '"><svg onload=window.__executou="icone">',
      chuvaProb: 10, uv: "<i>", maxima: 30, minima: 20, por: "<script>1</script>", onda: 1.2, hora: "<b>x</b>" } };
    localStorage.setItem("trindade.clima", JSON.stringify(lixo));
    Clima.estado = "idle"; await Clima.carregar(false); await new Promise(r => setTimeout(r, 300));
    const barra = document.querySelector("#climaBar");
    return { executou: window.__executou ?? null, imgNaBarra: !!barra.querySelector("img"), svgComOnload: !!barra.querySelector("[onload]"), texto: (barra.querySelector(".clima-agora span") || {}).textContent, scriptNaBarra: !!barra.querySelector("script") };
  },

  async disponibilidade_adulterada() {
    window.__executou = undefined;
    const fetchReal = window.fetch;
    window.fetch = async (u, o) => String(u).includes("/api/disponibilidade")
      ? new Response(JSON.stringify({ ok: true, capacidade: "<b>20</b>", grade: { "9": { restam: "<img src=x onerror=window.__executou='vaga'>", bloqueado: false }, "10": { restam: 4, bloqueado: "sim" } }, horariosPorPlano: { essencial: [9, 10, "<x>"], adventure: [9], boat: [8.5] } }), { status: 200, headers: { "content-type": "application/json" } })
      : fetchReal(u, o);
    try {
      reserva.hora = null; dispoCache = null; await atualizarDisponibilidade(); await new Promise(r => setTimeout(r, 300));
      const lista = document.querySelector("#listaHorarios");
      return { executou: window.__executou ?? null, imgNaLista: !!lista.querySelector("img"), textos: [...lista.querySelectorAll(".saida")].slice(0, 3).map(e => e.textContent) };
    } finally { window.fetch = fetchReal; }
  },

  async tudo() {
    const r = {};
    r.servidor = await this.resposta_do_servidor();
    r.clima = await this.clima_adulterado();
    r.disponibilidade = await this.disponibilidade_adulterada();
    localStorage.removeItem("trindade.clima");
    return r;
  }
};

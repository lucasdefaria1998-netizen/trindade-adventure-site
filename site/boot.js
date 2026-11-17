/* Folhas de estilo que não bloqueiam o primeiro desenho (auditoria 16/11, P1.2). O CSS crítico vem
   inline no <head>; a fonte do Google e o estilo.css inteiro chegam com media="print" (o navegador
   baixa sem segurar a pintura) e passam a valer aqui. Vem com defer: roda depois do HTML lido e antes
   do app.js. Sem JavaScript, o <noscript> do index.html carrega as duas do jeito normal.
   O que precisa rodar ANTES do primeiro desenho (classe .js, tema, preferência de movimento) saiu
   daqui para o <script id="boot-inline"> do index.html, liberado na CSP por hash. */
(function () {
  var ls = document.querySelectorAll('link[rel="stylesheet"][data-async]');
  for (var i = 0; i < ls.length; i++) ls[i].media = 'all';
})();

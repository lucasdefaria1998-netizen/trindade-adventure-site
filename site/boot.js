/* Antes do primeiro desenho: marca o JavaScript, o tema e a preferência de movimento, para a
   abertura não piscar nem animar quem pediu para parar. Vem sem defer, no <head>, antes do CSS.
   Saiu do HTML (era um <script> inline) para a política de segurança de conteúdo poder valer
   com script-src 'self', sem hash escrito à mão. */
(function () {
  var r = document.documentElement, p = false;
  r.classList.add('js');
  try {
    p = localStorage.getItem('trindade.motion') === 'paused';
    var t = localStorage.getItem('trindade.tema');
    if (t === 'dark' || t === 'light') r.setAttribute('data-theme', t);
  } catch (e) {}
  r.setAttribute('data-motion', p || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'paused' : 'running');

  /* A fonte do Google chega como preload (não bloqueia o desenho) e vira folha de estilo quando
     termina de baixar. Era um onload= no próprio <link>; o evento não borbulha, então escuta-se na captura. */
  document.addEventListener('load', function (e) {
    var l = e.target;
    if (l && l.tagName === 'LINK' && l.rel === 'preload' && l.as === 'style') l.rel = 'stylesheet';
  }, true);
})();

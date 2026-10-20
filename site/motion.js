/* Movimento progressivo. O app.js cuida das regras do negócio; aqui só entra
   o que é acabamento: rolagem suave no desktop, revelação discreta ao rolar e
   o botão que pausa tudo. Sem este arquivo o site continua completo. */
(() => {
 'use strict';
 const root = document.documentElement;
 const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
 const ponteiroFino = matchMedia('(min-width: 1000px) and (hover: hover) and (pointer: fine)');
 const botao = document.getElementById('btnMovimento');
 let pausado = false, lenis = null, quadro = 0, pendentes = [];
 try { pausado = localStorage.getItem('trindade.motion') === 'paused'; } catch (e) {}

 const ativo = () => !pausado && !reduzido.matches;

 function rolagemSuave() {
  const quer = ativo() && ponteiroFino.matches && !!window.Lenis;
  if (quer && !lenis) {
   lenis = new Lenis({ lerp: .1, smoothWheel: true, syncTouch: false,
    prevent: no => !!no.closest?.('dialog,#mapaLeaflet,.nav,[data-lenis-prevent]') });
   const passo = t => { lenis?.raf(t); quadro = requestAnimationFrame(passo); };
   quadro = requestAnimationFrame(passo);
  } else if (!quer && lenis) {
   cancelAnimationFrame(quadro); lenis.destroy(); lenis = null;
  }
 }

 /* Só o que está abaixo da dobra ganha a classe que o esconde, e ela sai
    assim que o elemento entra na tela, recebe foco ou a seção muda. */
 /* A checagem é pela posição, a cada rolagem: um elemento que passou direto
    por baixo da tela numa rolagem rápida também é revelado, nunca fica preso. */
 function conferirPendentes() {
  if (!pendentes.length) return;
  const limite = innerHeight * .94;
  pendentes = pendentes.filter(el => {
   if (el.getBoundingClientRect().top < limite) { el.classList.remove('revelar'); return false; }
   return true;
  });
 }
 function revelar() {
  pendentes.forEach(el => el.classList.remove('revelar'));
  pendentes = [];
  if (!ativo()) return;
  const secao = document.querySelector('[data-secao]:not([hidden])');
  if (!secao) return;
  pendentes = [...secao.querySelectorAll('[data-revelar]')].filter(el => el.getBoundingClientRect().top > innerHeight * .94);
  pendentes.forEach((el, i) => { el.style.setProperty('--atraso', (i % 4) * 70 + 'ms'); el.classList.add('revelar'); });
 }

 function aplicar() {
  root.dataset.motion = ativo() ? 'running' : 'paused';
  if (botao) {
   botao.textContent = reduzido.matches ? 'Movimento reduzido pelo sistema' : ativo() ? 'Pausar animações' : 'Ativar animações';
   botao.disabled = reduzido.matches;
   botao.setAttribute('aria-pressed', String(!ativo()));
  }
  rolagemSuave();
  revelar();
 }

 /* Na carga, o que mede posição (revelar) e cria o Lenis espera a primeira pintura: o estado do
    movimento (data-motion) já vai certo no primeiro instante, e o que fica abaixo da dobra só ganha
    a classe de revelação depois. Se a pessoa rolar antes disso, a rolagem nativa funciona e nada
    fica escondido. */
 function aposPrimeiraPintura(fn) {
  const rodar = () => { if (rodar.feito) return; rodar.feito = true; fn(); };
  if ('requestIdleCallback' in window) requestIdleCallback(rodar, { timeout: 1200 });
  else setTimeout(rodar, 200);
  return rodar;
 }

 botao?.addEventListener('click', () => {
  pausado = !pausado;
  try { localStorage.setItem('trindade.motion', pausado ? 'paused' : 'running'); } catch (e) {}
  aplicar();
 });
 document.addEventListener('focusin', e => e.target.closest?.('.revelar')?.classList.remove('revelar'));
 reduzido.addEventListener('change', aplicar);
 ponteiroFino.addEventListener('change', rolagemSuave);
 addEventListener('trindade:route', () => requestAnimationFrame(() => { lenis?.scrollTo(scrollY, { immediate: true }); revelar(); }));

 /* Rolagem pedida pelo próprio site (âncoras, passo da reserva): usa o Lenis
    quando ele está ligado, para as duas rolagens não disputarem a página. */
 window.trindadeRolar = (alvo, opcoes = {}) => {
  if (!alvo) return;
  const topo = parseFloat(getComputedStyle(root).getPropertyValue('--topo')) || 72;
  if (lenis) lenis.scrollTo(alvo, { offset: -(topo + 16), duration: .9 });
  else alvo.scrollIntoView({ block: opcoes.bloco || 'start', behavior: ativo() ? 'smooth' : 'instant' });
 };

 const topbar = document.querySelector('.topbar');
 let agendado = 0;
 addEventListener('scroll', () => {
  if (agendado) return;
  agendado = requestAnimationFrame(() => { agendado = 0; topbar?.classList.toggle('is-scrolled', scrollY > 8); conferirPendentes(); });
 }, { passive: true });
 addEventListener('resize', conferirPendentes, { passive: true });

 document.addEventListener('visibilitychange', () => { if (document.hidden) lenis?.stop(); else lenis?.start(); });
 document.querySelectorAll('dialog').forEach(d => new MutationObserver(() => { if (d.open) lenis?.stop(); else lenis?.start(); }).observe(d, { attributes: true, attributeFilter: ['open'] }));
 addEventListener('trindade:menu', e => { if (e.detail?.aberto) lenis?.stop(); else lenis?.start(); });

 root.dataset.motion = ativo() ? 'running' : 'paused';
 const inicial = aposPrimeiraPintura(aplicar);
 // Quem interage antes do ocioso (botão de movimento, troca de rota) já exige o estado completo.
 addEventListener('trindade:before-route', inicial, { once: true });
 botao?.addEventListener('pointerdown', inicial, { once: true });
})();

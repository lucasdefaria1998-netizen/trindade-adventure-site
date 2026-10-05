/* Galeria da página de pescaria: setas, miniaturas, teclado, toque e tela
   cheia. As fotos são registros da pesca artesanal local enviados pela
   equipe; as legendas não as apresentam como fotos do passeio embarcado. */
(() => {
 const gallery = document.querySelector('.fishing-gallery');
 const dialog = document.querySelector('#fishingLightbox');
 if (gallery && dialog) {
  const fotos = [
   ['Peixe em destaque', 'Registro de peixe enviado pela equipe.'],
   ['Cavalas', 'Registro identificado como cavala na imagem enviada.'],
   ['Pesca da tainha', 'Pesca artesanal da tainha em Trindade — registro compartilhado por @laiscarmoo.'],
   ['Pescadores e redes', 'Pesca artesanal com redes — cultura caiçara.']
  ];
  const total = fotos.length;
  let atual = 0;
  const show = index => {
   atual = (index + total) % total;
   document.querySelectorAll('[data-fg-slide]').forEach(el => {
    const ativo = Number(el.dataset.fgSlide) === atual;
    el.classList.toggle('is-active', ativo);
    el.setAttribute('aria-hidden', String(!ativo));
   });
   document.querySelectorAll('[data-fg-select]').forEach(el => el.setAttribute('aria-pressed', String(Number(el.dataset.fgSelect) === atual)));
   document.querySelectorAll('[data-fg-count]').forEach(el => { el.textContent = `${atual + 1} / ${total}`; });
   document.querySelector('[data-fg-title]').textContent = fotos[atual][0];
   document.querySelector('#fgLightTitle').textContent = fotos[atual][0];
   document.querySelectorAll('[data-fg-caption],[data-fg-light-caption]').forEach(el => { el.textContent = fotos[atual][1]; });
  };
  document.querySelectorAll('[data-fg-next]').forEach(el => el.addEventListener('click', () => show(atual + 1)));
  document.querySelectorAll('[data-fg-prev]').forEach(el => el.addEventListener('click', () => show(atual - 1)));
  document.querySelectorAll('[data-fg-select]').forEach(el => el.addEventListener('click', () => show(Number(el.dataset.fgSelect))));
  const abrir = document.querySelector('[data-fg-open]');
  abrir.addEventListener('click', () => { dialog.showModal(); dialog.querySelector('[data-fg-close]').focus(); });
  dialog.querySelector('[data-fg-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => abrir.focus({ preventScroll: true }));
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  [gallery, dialog].forEach(el => el.addEventListener('keydown', e => {
   if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(atual + (e.key === 'ArrowRight' ? 1 : -1)); }
  }));
  document.querySelectorAll('.fg-stage,.fg-light-stage').forEach(el => {
   let inicio = null;
   el.addEventListener('touchstart', e => { inicio = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
   el.addEventListener('touchend', e => {
    if (!inicio) return;
    const dx = e.changedTouches[0].clientX - inicio.x, dy = e.changedTouches[0].clientY - inicio.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(atual + (dx < 0 ? 1 : -1));
    inicio = null;
   }, { passive: true });
  });
  // Trocar de página (link, voltar do celular) fecha a galeria ampliada.
  addEventListener('trindade:before-route', () => { if (dialog.open) dialog.close(); });
  show(0);
 }

 /* Links "Referência" dos peixes: abrem a lista de fontes e levam até ela sem
    trocar de página. */
 document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#fonte-"]');
  if (!link) return;
  const alvo = document.getElementById(link.getAttribute('href').slice(1));
  if (!alvo) return;
  e.preventDefault();
  const detalhes = alvo.closest('details');
  if (detalhes) detalhes.open = true;
  alvo.scrollIntoView({ block: 'center', behavior: document.documentElement.dataset.motion === 'running' ? 'smooth' : 'instant' });
  alvo.setAttribute('tabindex', '-1');
  alvo.focus({ preventScroll: true });
 });
})();

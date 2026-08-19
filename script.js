// ── DATES DES AVIS (calcul dynamique, ne se fige jamais) ──
(function () {
  function formatRelativeDate(iso) {
    var then = new Date(iso + 'T00:00:00');
    var now = new Date();
    var days = Math.max(0, Math.floor((now - then) / 86400000));
    if (days === 0) return "aujourd'hui";
    if (days === 1) return 'il y a 1 jour';
    if (days < 30) return 'il y a ' + days + ' jours';
    var months = Math.round(days / 30.44);
    if (months <= 1) return 'il y a 1 mois';
    if (months < 12) return 'il y a ' + months + ' mois';
    var years = Math.round(days / 365.25);
    return years <= 1 ? 'il y a 1 an' : 'il y a ' + years + ' ans';
  }

  document.querySelectorAll('.review-date[data-date]').forEach(function (el) {
    var iso = el.getAttribute('data-date');
    var then = new Date(iso + 'T00:00:00');
    var days = Math.max(0, Math.floor((new Date() - then) / 86400000));
    el.textContent = formatRelativeDate(iso);
    if (days <= 14) {
      var badge = document.createElement('span');
      badge.className = 'review-new';
      badge.textContent = 'Nouveau';
      el.insertAdjacentElement('afterend', badge);
    }
  });
})();

// ── BURGER MENU ──
const burger = document.getElementById('burgerBtn');
const mobileMenu = document.getElementById('mobileMenu');
burger.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('open');
  burger.classList.toggle('open', isOpen);
  burger.setAttribute('aria-expanded', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
});
document.querySelectorAll('.mobile-link, .mobile-rdv').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  });
});

// ── CARROUSEL AVIS (défilement souris/tactile natif) ──
(function() {
  const wrap = document.querySelector('.reviews-track-wrap');
  const track = document.getElementById('reviewsTrack');
  const dotsContainer = document.getElementById('reviewsDots');
  if (!wrap || !track || !dotsContainer) return;
  const cards = track.querySelectorAll('.review-card');
  const total = cards.length;
  const gap = 20;

  function cardStep() { return cards[0].offsetWidth + gap; }
  function visibleCount() { return Math.max(1, Math.round(wrap.clientWidth / cardStep())); }
  function maxIndex() { return Math.max(0, total - visibleCount()); }

  function currentIndex() {
    return Math.round(wrap.scrollLeft / cardStep());
  }

  function buildDots() {
    dotsContainer.innerHTML = '';
    for (let i = 0; i <= maxIndex(); i++) {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Avis ' + (i + 1));
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => goTo(i));
      dotsContainer.appendChild(btn);
    }
    updateDots();
  }
  function updateDots() {
    const idx = Math.min(currentIndex(), maxIndex());
    dotsContainer.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === idx));
  }
  function goTo(index) {
    const idx = Math.max(0, Math.min(index, maxIndex()));
    wrap.scrollTo({ left: idx * cardStep(), behavior: 'smooth' });
  }

  buildDots();

  // ── Auto-scroll, en pause pendant l'interaction ──
  let timer = null;
  function startAuto() {
    stopAuto();
    timer = setInterval(() => {
      const next = currentIndex() >= maxIndex() ? 0 : currentIndex() + 1;
      goTo(next);
    }, 4500);
  }
  function stopAuto() { if (timer) clearInterval(timer); }
  startAuto();
  wrap.addEventListener('mouseenter', stopAuto);
  wrap.addEventListener('mouseleave', startAuto);

  // ── Glisser à la souris (drag-to-scroll) ──
  let isDown = false, startX = 0, startScroll = 0, moved = false;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // le tactile utilise le scroll natif
    isDown = true; moved = false;
    startX = e.clientX;
    startScroll = wrap.scrollLeft;
    wrap.classList.add('dragging');
    stopAuto();
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    wrap.scrollLeft = startScroll - dx;
  });
  function endDrag() {
    if (!isDown) return;
    isDown = false;
    wrap.classList.remove('dragging');
    goTo(currentIndex());
    startAuto();
  }
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointerleave', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);

  // ── Sync des points pendant le scroll (tactile compris) ──
  let scrollTimeout;
  wrap.addEventListener('scroll', () => {
    updateDots();
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => { goTo(currentIndex()); }, 120);
  }, { passive: true });

  window.addEventListener('resize', () => { buildDots(); });
})();

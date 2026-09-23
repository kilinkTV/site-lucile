// ── Rendu de la carte cadeau (HTML) + utilitaires partagés (rendu.js) ──
// Utilisé par la page d'achat (aperçu), la page merci et la page de vérification.
// Nécessite vendor/qrcode.js pour le QR code. Toutes les saisies des clients sont
// insérées en textContent (jamais en HTML).
(function () {
  var SITE = 'https://lucile-diet.fr';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function euros(cents) {
    var v = cents / 100;
    return (v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ',')) + ' €';
  }

  function frDateLong(iso) {
    var p = iso.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function frDate(iso) { var p = iso.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function cardUrl(card) { return SITE + '/carte-cadeau/carte.html?c=' + encodeURIComponent(card.code) + '&s=' + card.sig; }

  // Courbes du guilloché, partagées entre le HTML et le PDF (repère 1414 × 670).
  function guillochePaths() {
    var out = [];
    for (var k = 0; k < 15; k++) {
      var d = '', ph = k * 0.29, amp = 30 + k, y0 = 40 + k * 42;
      for (var x = 0; x <= 1414; x += 8) {
        var y = y0 + Math.sin(x / 70 + ph) * amp * Math.cos(x / 310 - ph * 0.5);
        d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1);
      }
      out.push({ d: d, opacity: k % 2 ? 0.35 : 0.55 });
    }
    return out;
  }

  function guillocheSvg() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'gc-guilloche');
    svg.setAttribute('viewBox', '0 0 1414 670');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    guillochePaths().forEach(function (p) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p.d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#C4A882');
      path.setAttribute('stroke-width', '0.8'); path.setAttribute('opacity', p.opacity);
      svg.appendChild(path);
    });
    return svg;
  }

  // Matrice du QR code (true = module sombre).
  function qrMatrix(text) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), rows = [];
    for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(qr.isDark(r, c)); rows.push(row); }
    return rows;
  }

  function qrSvg(text) {
    var m = qrMatrix(text), n = m.length, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code de vérification de la carte');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#3A2A1E');
    svg.appendChild(path);
    return svg;
  }

  function valueBlock(card) {
    if (card.kind === 'montant') {
      return h('div', { class: 'gc-value' },
        h('div', { class: 'gc-amount-big', text: euros(card.amount_cents) }),
        h('div', { class: 'gc-desc' }, 'à valoir sur un soin', h('br'), 'de drainage lymphatique'));
    }
    return h('div', { class: 'gc-value' },
      h('div', { class: 'gc-presta' }, card.label, h('small', { text: card.detail === "Séance d'environ 1h" ? '≈ 1h · au cabinet' : card.detail === "Séance d'environ 40 min" ? '≈ 40 min · au cabinet' : card.detail })));
  }

  function band(verso) {
    var logo = h('img', { class: 'gc-logo', src: '/carte-cadeau/logo-rond.png', alt: 'Lucile – Diététique & Drainage lymphatique', width: '200', height: '200' });
    if (verso) return h('aside', { class: 'gc-band' }, logo,
      h('p', { class: 'gc-cab' }, h('strong', { text: 'Le cabinet' }), '16 place Sainte-Claire', h('br'), '38000 Grenoble', h('br'), h('br'), 'lucile-diet.fr', h('br'), '@lucile.diet'));
    return h('aside', { class: 'gc-band' }, logo,
      h('h2', null, 'Carte', h('em', { text: 'cadeau' })),
      h('p', { class: 'gc-who' }, 'Lucile Le Pocreau', h('strong', { text: 'Drainage lymphatique' }), 'Grenoble'));
  }

  // card : { code, sig, kind, label, detail, amount_cents, buyer_name, recipient_name, message, created_at, expires_at }
  // Sans code (aperçu avant achat), le numéro et le QR sont remplacés par des exemples.
  function renderRecto(card) {
    var preview = !card.code;
    var code = card.code || 'LD-XXXX-XXXX';
    var qrBox = h('div', { class: 'gc-qr' + (preview ? ' gc-qr--placeholder' : '') }, qrSvg(preview ? SITE : cardUrl(card)), 'Scannez pour vérifier');
    var msg = card.message ? h('p', { class: 'gc-msg', text: '« ' + card.message + ' »' }) : h('p', { class: 'gc-msg' });
    return h('div', { class: 'gc-card' }, guillocheSvg(), band(false),
      h('section', { class: 'gc-main' },
        h('div', { class: 'gc-head' },
          h('p', { class: 'gc-kicker', text: 'Un moment rien que pour vous' }),
          h('p', { class: 'gc-for' }, 'Pour ', h('em', { text: card.recipient_name || 'Prénom Nom' })),
          h('p', { class: 'gc-from' }, 'De la part de ', h('strong', { text: card.buyer_name || 'Votre nom' }))),
        valueBlock(card),
        msg,
        h('div', { class: 'gc-meta' }, "Valable 6 mois, jusqu'au ", h('b', { text: frDateLong(card.expires_at) }), ' · émise le ' + frDate(card.created_at),
          h('div', { class: 'gc-code', text: code })),
        qrBox,
        h('p', { class: 'gc-micro', 'aria-hidden': 'true', text: Array(9).join('LUCILE LE POCREAU · ' + code + ' · CARTE CADEAU AUTHENTIQUE · ') })));
  }

  function renderVerso(card) {
    var code = card.code || 'LD-XXXX-XXXX';
    return h('div', { class: 'gc-card gc-card--verso' }, guillocheSvg(),
      h('section', { class: 'gc-main' },
        h('h3', { text: 'Comment utiliser votre carte' }),
        h('ol', { class: 'gc-steps' },
          h('li', null, h('span', null, 'Réservez sur ', h('b', { text: 'Doctolib' }), ' ou au ', h('b', { class: 'gc-nw', text: '07 67 95 57 09' }), '.')),
          h('li', null, h('span', null, 'Indiquez que vous avez une carte cadeau et donnez son numéro ', h('b', { class: 'gc-nw', text: code }), '.')),
          h('li', null, h('span', null, 'Présentez la carte (imprimée ou sur téléphone) le jour du soin : elle est validée par QR code.'))),
        h('p', { class: 'gc-conds', text: "Valable uniquement sur les soins de drainage lymphatique, pendant 6 mois à compter de la date d'émission. Hors droit de rétractation, carte non remboursable et non échangeable contre des espèces. Chaque numéro n'est valable qu'une fois : toute copie est inutilisable. Conditions sur lucile-diet.fr/carte-cadeau.html." })),
      band(true));
  }

  // Dates d'aperçu : aujourd'hui + 6 mois (même règle que le serveur).
  function previewDates() {
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    var p = today.split('-').map(Number);
    var t = new Date(Date.UTC(p[0], p[1] - 1 + 6, 1));
    var last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(p[2], last));
    return { created_at: today, expires_at: t.toISOString().slice(0, 10) };
  }

  var STATUS = {
    valide: { label: 'Carte valide', icon: '✓' },
    utilisee: { label: 'Carte entièrement utilisée', icon: '●' },
    expiree: { label: 'Carte expirée', icon: '●' },
    bloquee: { label: 'Carte bloquée', icon: '✕' },
  };

  // Charge un script du site à la demande (les bibliothèques PDF ne sont chargées qu'au clic).
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Chargement impossible : ' + src)); };
      document.head.appendChild(s);
    });
  }

  function downloadPdf(card, button) {
    var old = button.textContent;
    button.disabled = true; button.textContent = 'Préparation du PDF…';
    return loadScript('/carte-cadeau/vendor/pdf-lib.min.js')
      .then(function () { return loadScript('/carte-cadeau/vendor/fontkit.umd.min.js'); })
      .then(function () { return loadScript('/carte-cadeau/pdf.js'); })
      .then(function () { return window.GiftCardPdf.build(card); })
      .then(function (bytes) {
        var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        var name = 'carte-cadeau-' + card.code + '.pdf';
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        // Certains navigateurs mobiles (navigateurs intégrés aux applis, anciens iOS) ignorent
        // le téléchargement automatique : un lien direct vers le PDF sert de solution de secours.
        var fallback = button.parentNode.querySelector('.gc-pdf-fallback');
        if (!fallback) {
          fallback = h('p', { class: 'gc-pdf-fallback' }, 'Le téléchargement ne démarre pas ? ', h('a', { target: '_blank', rel: 'noopener', text: 'Ouvrir le PDF' }));
          button.parentNode.appendChild(fallback);
        }
        var link = fallback.querySelector('a');
        if (link.href) URL.revokeObjectURL(link.href);
        link.href = url; // sans attribut download : ouvre le PDF dans la visionneuse du téléphone
      })
      .catch(function (e) { alert('Le PDF n\'a pas pu être créé. Réessayez ou contactez le cabinet.\n' + e.message); })
      .then(function () { button.disabled = false; button.textContent = old; });
  }

  window.GiftCard = {
    h: h, euros: euros, frDate: frDate, frDateLong: frDateLong, cardUrl: cardUrl, qrMatrix: qrMatrix,
    guillochePaths: guillochePaths, renderRecto: renderRecto, renderVerso: renderVerso, previewDates: previewDates,
    STATUS: STATUS, downloadPdf: downloadPdf,
  };
})();

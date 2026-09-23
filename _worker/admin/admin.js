// ── Espace de Lucile : scanner, consulter, valider et gérer les cartes cadeaux ──
(function () {
  'use strict';
  var app = document.getElementById('app');
  var OFFERS = [
    { key: 'zone', label: 'Drainage zone au choix', cents: 5000 },
    { key: 'corps', label: 'Drainage corps entier', cents: 9000 },
  ];
  var ALL_OFFERS = {
    'corps': 'Drainage corps entier – 90 €', 'zone': 'Drainage zone au choix – 50 €',
    'cure-corps': 'Cure corps entier (5 séances) – 360 €', 'cure-zone': 'Cure zone au choix (5 séances) – 200 €',
  };
  var STATUS = { valide: 'Valide', utilisee: 'Utilisée', expiree: 'Expirée', bloquee: 'Bloquée' };
  var PAYMENTS = { 'especes': 'Espèces', 'virement': 'Virement', 'cb-cabinet': 'CB au cabinet', 'offert': 'Offerte' };
  var stopScan = null;
  var listState = { q: '', status: '' };

  // ── Utilitaires ──
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function euros(c) { var v = c / 100; return (v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ',')) + ' €'; }
  function frDate(iso) { var p = iso.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function frDateTime(iso) { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function show() { app.replaceChildren.apply(app, Array.prototype.slice.call(arguments).filter(Boolean)); window.scrollTo(0, 0); }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin', cache: 'no-store' };
    if (opts.body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch('/api' + path, init).then(function (r) {
      if (r.status === 403 || r.redirected || !(r.headers.get('content-type') || '').includes('json')) {
        throw new Error('Session expirée : rechargez la page pour vous reconnecter.');
      }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Erreur ' + r.status); return d; });
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function confirmBox(title, text, okLabel) {
    var d = document.getElementById('confirm');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    document.getElementById('confirm-ok').textContent = okLabel || 'Confirmer';
    return new Promise(function (resolve) {
      d.addEventListener('close', function onClose() { d.removeEventListener('close', onClose); resolve(d.returnValue === 'ok'); });
      d.returnValue = ''; d.showModal();
    });
  }

  function errorView(e) { return h('div', { class: 'alert err', text: e.message }); }

  function remainingText(c) {
    if (c.kind === 'montant') return euros(c.balance_cents);
    return c.sessions_left + ' séance' + (c.sessions_left > 1 ? 's' : '');
  }

  // ── Accueil : recherche + liste ──
  function home() {
    var input = h('input', { type: 'search', placeholder: 'Numéro, nom ou e-mail', value: listState.q, 'aria-label': 'Rechercher une carte', autocomplete: 'off' });
    var list = h('ul', { class: 'list' }, h('li', { class: 'loading', text: 'Chargement…' }));
    var timer;
    function load() {
      api('/cards?q=' + encodeURIComponent(listState.q) + '&status=' + listState.status).then(function (d) {
        if (!d.cards.length) return list.replaceChildren(h('li', { class: 'muted', text: listState.q || listState.status ? 'Aucune carte ne correspond.' : 'Aucune carte pour le moment.' }));
        list.replaceChildren.apply(list, d.cards.map(function (c) {
          return h('li', null, h('a', { class: 'item', href: '#/carte/' + c.code },
            h('strong', { text: c.recipient_name }),
            h('span', { class: 'pill ' + c.status, text: STATUS[c.status] }),
            h('span', { class: 'sub', text: (c.kind === 'montant' ? euros(c.amount_cents) + ' · reste ' + euros(c.balance_cents) : c.label + (c.sessions_total > 1 ? ' · ' + c.sessions_left + '/' + c.sessions_total + ' séances' : '')) + ' · ' + c.code + ' · jusqu\'au ' + frDate(c.expires_at) })));
        }));
      }).catch(function (e) { list.replaceChildren(errorView(e)); });
    }
    input.addEventListener('input', function () { listState.q = input.value.trim(); clearTimeout(timer); timer = setTimeout(load, 250); });
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer par statut' },
      [['', 'Toutes'], ['valide', 'Valides'], ['utilisee', 'Utilisées'], ['expiree', 'Expirées'], ['bloquee', 'Bloquées']].map(function (s) {
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(listState.status === s[0]), text: s[1], onclick: function (e) {
          listState.status = s[0];
          chips.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
          load();
        } });
      }));
    show(
      h('a', { class: 'btn big', href: '#/scan' }, '📷  Scanner une carte'),
      h('div', { class: 'search' }, input),
      chips, list,
      h('div', { class: 'row', style: 'margin-top:22px' },
        h('a', { class: 'btn ghost', href: '#/nouvelle', text: '+ Nouvelle carte' }),
        h('a', { class: 'btn ghost', href: '/api/export.csv', text: 'Export CSV' })));
    load();
  }

  // ── Scanner ──
  function scan() {
    var video = h('video', { playsinline: true, muted: true, autoplay: true });
    var status = h('p', { class: 'muted', style: 'margin-top:10px', text: 'Visez le QR code de la carte.' });
    var manual = h('input', { type: 'text', placeholder: 'LD-XXXX-XXXX', autocapitalize: 'characters', 'aria-label': 'Numéro de carte' });
    show(
      h('h1', null, 'Scanner ', h('em', { text: 'une carte' })),
      h('div', { class: 'scan' }, video, h('div', { class: 'frame' })),
      status,
      h('h2', { text: 'Ou saisir le numéro' }),
      h('form', { class: 'search', onsubmit: function (e) { e.preventDefault(); if (manual.value.trim()) location.hash = '#/carte/' + manual.value.trim().toUpperCase(); } },
        manual, h('button', { class: 'btn', type: 'submit', text: 'OK' })),
      h('a', { class: 'btn ghost', href: '#/', text: '← Retour', style: 'margin-top:12px' }));

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status.textContent = 'Caméra indisponible sur cet appareil : saisissez le numéro.'; return; }
    var stream, raf, stopped = false;
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    var detector = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    stopScan = function () { stopped = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stopScan = null; };

    function found(text) {
      var code = null;
      try { code = new URL(text).searchParams.get('c'); } catch (e) { if (/^LD-/i.test(text)) code = text; }
      if (!code) { status.textContent = 'Ce QR code n\'est pas une carte cadeau du cabinet.'; return false; }
      if (navigator.vibrate) navigator.vibrate(80);
      stopScan();
      location.hash = '#/carte/' + code.toUpperCase();
      return true;
    }
    function tick() {
      if (stopped) return;
      if (video.readyState >= 2) {
        if (detector) {
          detector.detect(video).then(function (codes) { if (!(codes.length && found(codes[0].rawValue))) raf = requestAnimationFrame(tick); }).catch(function () { detector = null; raf = requestAnimationFrame(tick); });
          return;
        }
        var w = video.videoWidth, hh = video.videoHeight, k = Math.min(1, 640 / Math.max(w, hh));
        canvas.width = w * k; canvas.height = hh * k;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var res = window.jsQR && window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (res && found(res.data)) return;
      }
      raf = requestAnimationFrame(tick);
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      if (stopped) return s.getTracks().forEach(function (t) { t.stop(); });
      stream = s; video.srcObject = s; video.play(); tick();
    }).catch(function () { status.textContent = 'Accès à la caméra refusé : autorisez-le dans les réglages, ou saisissez le numéro.'; });
  }

  // ── Fiche d'une carte ──
  function cardPage(code, flash) {
    show(h('p', { class: 'loading', text: 'Chargement de la carte…' }));
    api('/cards/' + encodeURIComponent(code)).then(function (d) { renderCard(d.card, flash); })
      .catch(function (e) { show(errorView(e), h('a', { class: 'btn ghost', href: '#/', text: '← Retour', style: 'margin-top:12px' })); });
  }

  function renderCard(c, flash) {
    var valid = c.status === 'valide';
    var actions = null;

    if (valid && c.kind === 'prestation') {
      actions = h('div', { class: 'stack', style: 'margin-top:16px' },
        h('button', { class: 'btn big', type: 'button', text: 'Valider une séance', onclick: function () {
          var left = c.sessions_left - 1;
          confirmBox('Valider une séance ?', c.label + ' pour ' + c.recipient_name + '. ' + (left ? 'Il restera ' + left + ' séance' + (left > 1 ? 's' : '') + '.' : 'La carte sera entièrement utilisée.'), 'Valider')
            .then(function (ok) { if (ok) use({}); });
        } }));
    }
    if (valid && c.kind === 'montant') {
      var other = h('input', { type: 'number', min: '1', step: '1', inputmode: 'decimal', placeholder: 'Autre montant (€)', 'aria-label': 'Autre montant en euros' });
      actions = h('div', { class: 'stack', style: 'margin-top:16px' },
        h('p', { class: 'muted', text: 'Soin réalisé :' }),
        OFFERS.map(function (o) {
          return h('button', { class: 'btn', type: 'button', text: o.label + ' – ' + euros(o.cents), onclick: function () { askAmount(o.cents, o.label); } });
        }),
        h('form', { class: 'search', onsubmit: function (e) {
          e.preventDefault();
          var cents = Math.round(parseFloat(String(other.value).replace(',', '.')) * 100);
          if (!(cents > 0)) return toast('Indiquez un montant.');
          askAmount(cents, 'Soin de drainage lymphatique');
        } }, other, h('button', { class: 'btn', type: 'submit', text: 'Déduire' })));
    }

    function askAmount(cents, label) {
      var charged = Math.min(cents, c.balance_cents), due = cents - charged;
      var text = due
        ? 'La carte couvre ' + euros(charged) + ' (tout son solde). Reste à payer par un autre moyen : ' + euros(due) + '.'
        : 'Déduire ' + euros(cents) + ' (' + label + '). Il restera ' + euros(c.balance_cents - cents) + '.';
      confirmBox('Déduire de la carte ?', text, 'Déduire').then(function (ok) { if (ok) use({ amount_cents: cents, label: label }); });
    }

    function use(body) {
      api('/cards/' + c.code + '/use', { method: 'POST', body: body }).then(function (d) {
        var mv = d.card.movements[0];
        var msg = c.kind === 'prestation'
          ? 'Séance validée. ' + (d.card.sessions_left ? 'Reste ' + remainingText(d.card) + '.' : 'Carte entièrement utilisée.')
          : euros(d.charged_cents) + ' déduits. Solde : ' + euros(d.card.balance_cents) + '.' + (d.due_cents ? ' Reste à payer : ' + euros(d.due_cents) + '.' : '');
        renderCard(d.card, { text: msg, undo: mv && mv.id, until: Date.now() + 5 * 60 * 1000, warn: !!d.due_cents });
      }).catch(function (e) { toast(e.message); });
    }

    function cancelMovement(id, fromUndo) {
      var go = fromUndo ? Promise.resolve(true) : confirmBox('Annuler cette opération ?', 'La séance ou le montant sera rendu à la carte.', 'Annuler l\'opération');
      go.then(function (ok) {
        if (!ok) return;
        api('/movements/' + id + '/cancel', { method: 'POST' }).then(function (d) { renderCard(d.card, { text: 'Opération annulée, la carte a été recréditée.' }); })
          .catch(function (e) { toast(e.message); });
      });
    }

    function post(path, body, okMsg) {
      return api('/cards/' + c.code + path, { method: 'POST', body: body || {} }).then(function (d) {
        if (d.card) renderCard(d.card, okMsg ? { text: okMsg } : null); else toast(okMsg);
        return d;
      }).catch(function (e) { toast(e.message); });
    }

    var flashBox = null;
    if (flash) {
      flashBox = h('div', { class: 'alert ' + (flash.warn ? 'warn' : 'ok') }, h('div', { text: '✓ ' + flash.text }));
      if (flash.undo && Date.now() < flash.until) {
        var undo = h('button', { class: 'btn small ghost', type: 'button', text: 'Erreur ? Annuler', onclick: function () { cancelMovement(flash.undo, true); } });
        flashBox.appendChild(undo);
        setTimeout(function () { undo.remove(); }, flash.until - Date.now());
      }
    }

    var history = c.movements.length
      ? h('ul', { class: 'history' }, c.movements.map(function (m) {
        return h('li', { class: m.cancelled_at ? 'cancelled' : '' },
          h('span', null, h('span', { class: 'when', text: frDateTime(m.created_at) }),
            m.label + (m.amount_cents ? ' · −' + euros(m.amount_cents) : '') + (m.sessions ? ' · 1 séance' : '') + (m.due_cents ? ' (+' + euros(m.due_cents) + ' payés à part)' : '') + (m.cancelled_at ? ' · annulée' : '')),
          m.cancelled_at ? null : h('button', { class: 'btn small danger', type: 'button', text: 'Annuler', onclick: function () { cancelMovement(m.id); } }));
      }))
      : h('p', { class: 'muted', text: 'Aucune utilisation pour le moment.' });

    var statusNote = null;
    if (c.status === 'expiree') statusNote = h('div', { class: 'alert warn', text: 'Carte expirée le ' + frDate(c.expires_at) + ' : elle ne peut plus être utilisée.' });
    if (c.status === 'utilisee') statusNote = h('div', { class: 'alert warn', text: 'Carte entièrement utilisée.' });
    if (c.status === 'bloquee') statusNote = h('div', { class: 'alert err' }, 'Carte bloquée' + (c.blocked_reason ? ' : ' + c.blocked_reason : '') + '.',
      c.replaced_by ? h('div', null, h('a', { href: '#/carte/' + c.replaced_by, text: 'Voir la nouvelle carte ' + c.replaced_by })) : null);

    show(
      h('a', { href: '#/', text: '← Toutes les cartes', class: 'muted' }),
      flashBox,
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
          h('span', { class: 'code', text: c.code }), h('span', { class: 'pill ' + c.status, text: STATUS[c.status] })),
        h('h1', { style: 'margin-top:10px' }, 'Pour ', h('em', { text: c.recipient_name })),
        h('p', { class: 'muted', text: c.kind === 'montant' ? 'Carte montant libre de ' + euros(c.amount_cents) : c.label + (c.sessions_total > 1 ? ' (' + c.sessions_total + ' séances)' : '') }),
        h('div', { class: 'balance' }, h('strong', { text: remainingText(c) }), h('span', { class: 'muted', text: c.kind === 'montant' ? 'de solde' : 'restante' + (c.sessions_left > 1 ? 's' : '') })),
        statusNote,
        actions,
        c.message ? h('p', { class: 'msg', text: '« ' + c.message + ' »' }) : null,
        h('dl', { class: 'kv' },
          h('dt', { text: 'Valable jusqu\'au' }), h('dd', { text: frDate(c.expires_at) }),
          h('dt', { text: 'Acheteur' }), h('dd', { text: c.buyer_name }),
          h('dt', { text: 'E-mail' }), h('dd', { text: c.buyer_email || '—' }),
          h('dt', { text: 'Émise le' }), h('dd', { text: frDateTime(c.created_at) }),
          h('dt', { text: 'Paiement' }), h('dd', { text: c.source === 'stripe' ? 'En ligne (Stripe)' : (PAYMENTS[c.payment_ref] || c.payment_ref) }),
          h('dt', { text: 'E-mail envoyé' }), h('dd', { text: c.email_sent_at ? frDateTime(c.email_sent_at) : 'non' }))),
      h('h2', { text: 'Historique' }), history,
      h('h2', { text: 'Autres actions' }),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost', href: c.card_url, target: '_blank', rel: 'noopener', text: 'Voir / télécharger la carte' }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Envoyer par e-mail', onclick: function () {
          var to = prompt('Envoyer la carte à quelle adresse ?', c.buyer_email || '');
          if (to) post('/email', { to: to.trim() }, 'Carte envoyée à ' + to.trim() + '.');
        } }),
        c.status === 'bloquee'
          ? (c.replaced_by ? null : h('button', { class: 'btn ghost', type: 'button', text: 'Débloquer', onclick: function () { post('/unblock', {}, 'Carte débloquée.'); } }))
          : h('button', { class: 'btn danger', type: 'button', text: 'Bloquer', onclick: function () {
            var reason = prompt('Pourquoi bloquer cette carte ? (ex. perdue, remboursée)');
            if (reason !== null) post('/block', { reason: reason }, 'Carte bloquée.');
          } }),
        c.replaced_by || c.status === 'utilisee' ? null : h('button', { class: 'btn danger', type: 'button', text: 'Réémettre (perte / vol)', onclick: function () {
          confirmBox('Réémettre la carte ?', 'Une nouvelle carte avec un nouveau numéro sera créée pour le solde restant, et celle-ci sera bloquée définitivement.', 'Réémettre')
            .then(function (ok) { if (ok) post('/reissue', {}, 'Nouvelle carte créée. Pensez à l\'envoyer au client.').then(function (d) { if (d && d.card) location.hash = '#/carte/' + d.card.code; }); });
        } })));
  }

  // ── Création manuelle (vente au cabinet) ──
  function newCard() {
    var f = {};
    function field(label, el) { return h('div', { class: 'field' }, h('label', { text: label }), el); }
    f.kind = h('select', null, h('option', { value: 'prestation', text: 'Prestation' }), h('option', { value: 'montant', text: 'Montant libre' }));
    f.offer = h('select', null, Object.keys(ALL_OFFERS).map(function (k) { return h('option', { value: k, text: ALL_OFFERS[k] }); }));
    f.amount = h('input', { type: 'number', min: '20', max: '500', step: '1', value: '90', inputmode: 'numeric' });
    f.recipient = h('input', { type: 'text', maxlength: '60', required: true });
    f.buyer = h('input', { type: 'text', maxlength: '60', required: true });
    f.email = h('input', { type: 'email', maxlength: '254', placeholder: 'facultatif' });
    f.message = h('textarea', { maxlength: '180' });
    f.payment = h('select', null, Object.keys(PAYMENTS).map(function (k) { return h('option', { value: k, text: PAYMENTS[k] }); }));
    f.send = h('input', { type: 'checkbox', checked: true });
    var offerField = field('Prestation', f.offer), amountField = field('Montant (€)', f.amount);
    function sync() { offerField.hidden = f.kind.value !== 'prestation'; amountField.hidden = f.kind.value !== 'montant'; }
    f.kind.addEventListener('change', sync);
    var err = h('div');
    var submit = h('button', { class: 'btn big', type: 'submit', text: 'Créer la carte' });
    show(
      h('a', { href: '#/', text: '← Toutes les cartes', class: 'muted' }),
      h('h1', { style: 'margin:10px 0 16px' }, 'Nouvelle ', h('em', { text: 'carte' })),
      h('p', { class: 'muted', style: 'margin-bottom:16px', text: 'Pour une carte vendue au cabinet. Elle aura le même numéro sécurisé et le même PDF qu\'une carte achetée en ligne.' }),
      h('form', { onsubmit: function (e) {
        e.preventDefault(); err.replaceChildren(); submit.disabled = true;
        api('/cards', { method: 'POST', body: {
          kind: f.kind.value, offer: f.offer.value, amount_euros: Number(f.amount.value),
          recipient_name: f.recipient.value, buyer_name: f.buyer.value, buyer_email: f.email.value,
          message: f.message.value, payment_ref: f.payment.value, send_email: f.send.checked && !!f.email.value,
        } }).then(function (d) { location.hash = '#/carte/' + d.card.code; toast('Carte créée.'); })
          .catch(function (x) { err.replaceChildren(errorView(x)); submit.disabled = false; });
      } },
        field('Type de carte', f.kind), offerField, amountField,
        field('Pour (bénéficiaire)', f.recipient), field('De la part de (acheteur)', f.buyer),
        field('E-mail de l\'acheteur', f.email), field('Petit mot', f.message), field('Paiement reçu', f.payment),
        h('label', { class: 'field', style: 'display:flex;gap:10px;align-items:center' }, f.send, 'Envoyer la carte par e-mail à l\'acheteur'),
        err, submit));
    sync();
  }

  // ── Routeur ──
  function route() {
    if (stopScan) stopScan();
    var hash = location.hash || '#/';
    var m = /^#\/carte\/([A-Za-z0-9-]+)/.exec(hash);
    if (m) return cardPage(m[1].toUpperCase());
    if (hash === '#/scan') return scan();
    if (hash === '#/nouvelle') return newCard();
    home();
  }
  window.addEventListener('hashchange', route);
  api('/me').then(function (d) { document.getElementById('who').textContent = d.email; }).catch(function () {});
  route();
})();

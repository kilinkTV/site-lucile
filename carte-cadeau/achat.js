// ── Page d'achat : aperçu en direct de la carte + envoi vers le paiement Stripe ──
(function () {
  var OFFERS = {
    'corps': { label: 'Drainage lymphatique corps entier', detail: "Séance d'environ 1h", cents: 9000 },
    'zone': { label: 'Drainage lymphatique zone au choix', detail: "Séance d'environ 40 min", cents: 5000 },
    'cure-corps': { label: 'Cure drainage corps entier', detail: '5 séances', cents: 36000 },
    'cure-zone': { label: 'Cure drainage zone au choix', detail: '5 séances', cents: 20000 },
  };
  var G = window.GiftCard;
  var form = document.getElementById('gc-form');
  var $ = function (id) { return document.getElementById(id); };
  var amountBox = $('gc-amount'), amountInput = $('amount'), errorBox = $('gc-error'), submit = $('gc-submit');
  var dates = G.previewDates();

  if (new URLSearchParams(location.search).get('annule')) $('notice-annule').hidden = false;

  function selectedOffer() { return form.querySelector('input[name="offer"]:checked').value; }

  function amountEuros() {
    var v = Number(amountInput.value);
    return Number.isInteger(v) ? v : NaN;
  }

  function currentCard() {
    var offer = selectedOffer();
    var card = {
      recipient_name: $('recipient_name').value.trim(),
      buyer_name: $('buyer_name').value.trim(),
      message: $('message').value.trim(),
      created_at: dates.created_at,
      expires_at: dates.expires_at,
    };
    if (offer === 'montant') {
      var e = amountEuros();
      card.kind = 'montant';
      card.amount_cents = (e >= 20 && e <= 500 ? e : 90) * 100;
    } else {
      card.kind = 'prestation';
      card.label = OFFERS[offer].label; card.detail = OFFERS[offer].detail; card.amount_cents = OFFERS[offer].cents;
    }
    return card;
  }

  var pending = false;
  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var card = currentCard();
      amountBox.hidden = card.kind !== 'montant';
      $('gc-total').textContent = G.euros(card.amount_cents);
      submit.textContent = 'Payer ' + G.euros(card.amount_cents) + ' et recevoir la carte';
      $('msg-count').textContent = $('message').value.length;
      $('preview-recto').replaceChildren(G.renderRecto(card));
      $('preview-verso').replaceChildren(G.renderVerso(card));
    });
  }

  form.addEventListener('input', render);
  form.addEventListener('change', render);

  $('gc-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.gc-chip');
    if (!chip) return;
    amountInput.value = chip.dataset.amount;
    syncChips();
    render();
  });
  function syncChips() {
    document.querySelectorAll('.gc-chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.amount === amountInput.value)); });
  }
  amountInput.addEventListener('input', syncChips);

  function showError(msg, field) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    if (field) field.focus(); else errorBox.scrollIntoView({ block: 'center' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    var offer = selectedOffer();
    var body = {
      kind: offer === 'montant' ? 'montant' : 'prestation',
      offer: offer === 'montant' ? null : offer,
      amount_euros: offer === 'montant' ? amountEuros() : null,
      recipient_name: $('recipient_name').value.trim(),
      buyer_name: $('buyer_name').value.trim(),
      message: $('message').value.trim(),
      buyer_email: $('buyer_email').value.trim(),
      accept_cgv: $('accept_cgv').checked,
    };
    if (body.kind === 'montant' && !(body.amount_euros >= 20 && body.amount_euros <= 500)) return showError("Choisissez un montant entier entre 20 et 500 €.", amountInput);
    if (!body.recipient_name) return showError('Indiquez le nom de la personne qui reçoit la carte.', $('recipient_name'));
    if (!body.buyer_name) return showError('Indiquez votre nom.', $('buyer_name'));
    if (!$('buyer_email').checkValidity() || !body.buyer_email) return showError('Indiquez une adresse e-mail valide : la carte y sera envoyée.', $('buyer_email'));
    if (!body.accept_cgv) return showError('Merci d\'accepter les conditions des cartes cadeaux.', $('accept_cgv'));

    submit.disabled = true;
    submit.textContent = 'Redirection vers le paiement…';
    fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.data.url) throw new Error(res.data.error || 'Le paiement n\'a pas pu démarrer.');
        location.href = res.data.url;
      })
      .catch(function (err) {
        submit.disabled = false;
        render();
        showError(err.message && !/Failed to fetch|NetworkError/.test(err.message) ? err.message : 'Connexion impossible, merci de réessayer dans un instant.');
      });
  });

  // Retour arrière depuis Stripe : réactive le bouton (page restaurée depuis le cache).
  window.addEventListener('pageshow', function () { submit.disabled = false; render(); });

  syncChips();
  render();
})();

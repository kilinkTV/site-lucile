// ── Pages « merci » et « carte » (cible du QR code) ──
// merci.html?session_id=…  : après le paiement, attend la création de la carte puis l'affiche.
// carte.html?c=…&s=…        : consultation publique d'une carte (aucune action possible).
(function () {
  var G = window.GiftCard, h = G.h;
  var root = document.getElementById('gc-root');
  var params = new URLSearchParams(location.search);
  var isMerci = !!document.getElementById('gc-merci');

  function fact(label, value) { return h('div', { class: 'gc-fact' }, h('span', { text: label }), h('strong', { text: value })); }

  function remaining(card) {
    if (card.kind === 'montant') return G.euros(card.balance_cents) + ' sur ' + G.euros(card.amount_cents);
    if (card.sessions_total > 1) return card.sessions_left + ' séance' + (card.sessions_left > 1 ? 's' : '') + ' sur ' + card.sessions_total;
    return card.sessions_left ? '1 séance' : 'Aucune';
  }

  function showCard(card, email) {
    var st = G.STATUS[card.status];
    var dl = h('button', { type: 'button', class: 'gc-btn' }, 'Télécharger la carte (PDF)');
    dl.addEventListener('click', function () { G.downloadPdf(card, dl); });

    var head = isMerci
      ? [h('p', { class: 'article-eyebrow', text: 'Paiement confirmé' }),
         h('h1', { class: 'article-title' }, 'Merci ! Votre carte ', h('em', { text: 'est prête' })),
         h('p', null, 'Téléchargez-la dès maintenant pour l\'imprimer ou la transférer à ' + card.recipient_name + '. ' +
           (email ? 'Elle vous a aussi été envoyée par e-mail à ' + email + ' (pensez à vérifier vos courriers indésirables).' : ''))]
      : [h('p', { class: 'article-eyebrow', text: 'Vérification de carte cadeau' }),
         h('p', { class: 'gc-status gc-status--' + card.status }, st.icon + ' ' + st.label),
         h('h1', { class: 'article-title' }, 'Carte cadeau ', h('em', { text: 'pour ' + card.recipient_name }))];

    var facts = h('div', { class: 'gc-facts' },
      fact('Numéro', card.code),
      fact(card.kind === 'montant' ? 'Solde' : 'Séances restantes', remaining(card)),
      fact(card.status === 'expiree' ? 'Expirée le' : "Valable jusqu'au", G.frDateLong(card.expires_at)));

    var nodes = head.concat([facts]);
    if (card.status === 'bloquee') nodes.push(h('p', { class: 'gc-notice', text: 'Cette carte a été bloquée par le cabinet' + (card.replaced ? ' et remplacée par une nouvelle carte.' : '.') + ' Pour toute question : 07 67 95 57 09.' }));
    if (card.status === 'valide') nodes.push(h('div', { class: 'gc-actions' }, dl));
    if (card.status === 'valide' && !isMerci) nodes.push(h('p', { text: 'Pour utiliser la carte, réservez sur Doctolib ou au 07 67 95 57 09 en indiquant son numéro, puis présentez-la le jour du soin.' }));
    nodes.push(h('div', { class: 'gc-cards' }, G.renderRecto(card), G.renderVerso(card)));
    if (!isMerci) nodes.push(h('p', { class: 'gc-pro' }, h('a', { href: 'https://admin.lucile-diet.fr/#/carte/' + encodeURIComponent(card.code), rel: 'nofollow', text: 'Espace praticienne' })));
    root.replaceChildren.apply(root, nodes);
  }

  function showError(title, msg) {
    root.replaceChildren(
      h('p', { class: 'gc-status gc-status--invalide', text: '✕ ' + title }),
      h('p', { text: msg }),
      h('p', null, 'Besoin d\'aide ? Appelez le 07 67 95 57 09 ou écrivez à ', h('a', { href: 'mailto:lepocreau.lucile@gmail.com', text: 'lepocreau.lucile@gmail.com' }), '.'));
  }

  function waiting(text) {
    root.replaceChildren(h('p', null, h('span', { class: 'gc-spinner', 'aria-hidden': 'true' }), text));
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); });
  }

  if (isMerci) {
    var sid = params.get('session_id');
    if (!sid) return showError('Commande introuvable', 'Le lien de cette page est incomplet.');
    var tries = 0;
    waiting('Finalisation de votre carte…');
    (function poll() {
      getJson('/api/order?session_id=' + encodeURIComponent(sid)).then(function (res) {
        if (res.status === 200) return showCard(res.data.card, res.data.email);
        if (res.status === 202 && ++tries < 20) { waiting('Paiement en cours de confirmation…'); return setTimeout(poll, 3000); }
        if (res.status === 202) return showError('Paiement en attente', 'Votre paiement n\'est pas encore confirmé. Dès qu\'il le sera, vous recevrez la carte par e-mail.');
        showError('Commande introuvable', res.data.error || 'Cette commande n\'existe pas.');
      }).catch(function () {
        if (++tries < 20) return setTimeout(poll, 3000);
        showError('Connexion impossible', 'Rechargez la page dans un instant. Si le paiement a été fait, la carte vous est aussi envoyée par e-mail.');
      });
    })();
  } else {
    waiting('Vérification de la carte…');
    getJson('/api/card?c=' + encodeURIComponent(params.get('c') || '') + '&s=' + encodeURIComponent(params.get('s') || ''))
      .then(function (res) {
        if (res.status === 200) return showCard(res.data.card);
        showError('Carte non reconnue', res.data.error || 'Ce QR code ne correspond à aucune carte émise par le cabinet.');
      })
      .catch(function () { showError('Connexion impossible', 'Vérifiez votre connexion internet puis rechargez la page.'); });
  }
})();

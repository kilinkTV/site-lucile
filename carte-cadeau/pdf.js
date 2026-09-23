// ── Génération du PDF de la carte cadeau (21 × 10 cm, recto + verso) ──
// Exécuté dans le navigateur avec pdf-lib + fontkit (chargés à la demande par rendu.js).
// Reprend la mise en page HTML : toutes les cotes sont en « cqw » (1 % de la largeur).
(function () {
  var MM = 72 / 25.4;
  var W = 210 * MM, H = 100 * MM, U = W / 100; // U = 1 cqw en points

  function hex(c) {
    var n = parseInt(c.slice(1), 16);
    return window.PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  }
  var C = {
    creme: hex('#FDFAF6'), fond: hex('#F5EFE6'), beige: hex('#C4A882'), beigePlus: hex('#D7C5A8'),
    brun: hex('#8B6343'), profond: hex('#5C3D2E'), texte: hex('#3A2A1E'), gris: hex('#6B5646'), msg: hex('#5A4636'), blanc: hex('#FFFFFF'),
  };

  function fetchBytes(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' : ' + r.status); return r.arrayBuffer(); });
  }

  // y exprimé depuis le haut de la page (comme en CSS) ; pdf-lib compte depuis le bas.
  function Y(top) { return H - top; }

  function textW(font, size, text, spacing) { return font.widthOfTextAtSize(text, size) + (spacing || 0) * text.length; }

  function drawText(page, text, o) {
    if (!o.spacing) { page.drawText(text, { x: o.x, y: o.y, size: o.size, font: o.font, color: o.color, opacity: o.opacity }); return; }
    var x = o.x;
    for (var i = 0; i < text.length; i++) {
      page.drawText(text[i], { x: x, y: o.y, size: o.size, font: o.font, color: o.color, opacity: o.opacity });
      x += o.font.widthOfTextAtSize(text[i], o.size) + o.spacing;
    }
  }

  // Suite de morceaux de texte sur une même ligne (ex. « Pour » + nom en italique).
  function drawRuns(page, runs, x, y) {
    runs.forEach(function (r) { drawText(page, r.text, { x: x, y: y, size: r.size, font: r.font, color: r.color, spacing: r.spacing }); x += textW(r.font, r.size, r.text, r.spacing); });
  }

  function fitSize(runs, maxWidth, minSize) {
    var total = runs.reduce(function (s, r) { return s + textW(r.font, r.size, r.text, r.spacing); }, 0);
    if (total <= maxWidth) return runs;
    var k = Math.max(maxWidth / total, minSize / runs[0].size);
    return runs.map(function (r) { return Object.assign({}, r, { size: r.size * k }); });
  }

  function truncate(font, size, text, maxWidth) {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > maxWidth) text = text.slice(0, -1);
    return text + '…';
  }

  function wrap(font, size, text, maxWidth) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var line = '';
      para.split(/\s+/).forEach(function (word) {
        var test = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
        else { if (line) lines.push(line); line = word; }
      });
      lines.push(line);
    });
    return lines;
  }

  function background(page) {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.creme });
    window.GiftCard.guillochePaths().forEach(function (p) {
      page.drawSvgPath(p.d, { x: 0, y: H, scale: W / 1414, borderColor: C.beige, borderWidth: 0.8, borderOpacity: p.opacity * 0.55 });
    });
  }

  function bandRect(page, x0, stripeOnRight) {
    page.drawRectangle({ x: x0, y: 0, width: 24 * U, height: H, color: C.profond });
    page.drawRectangle({ x: stripeOnRight ? x0 + 24 * U - 0.45 * U : x0, y: 0, width: 0.45 * U, height: H, color: C.beige });
  }

  function logo(page, img, cx, cyTop, d) {
    page.drawCircle({ x: cx, y: Y(cyTop + d / 2), size: d / 2 + 0.35 * U, color: C.beigePlus, opacity: 0.55 });
    page.drawImage(img, { x: cx - d / 2, y: Y(cyTop + d), width: d, height: d });
  }

  function recto(pdf, f, img, card) {
    var page = pdf.addPage([W, H]);
    background(page);
    bandRect(page, 0, true);

    // Bandeau : logo, « Carte cadeau », signature.
    logo(page, img, 2.4 * U + 8.5 * U, 3.2 * U, 17 * U);
    var whoLines = [['LUCILE LE POCREAU', f.lato, C.beigePlus, 0.16], ['DRAINAGE LYMPHATIQUE', f.latoBold, C.creme, 0.06], ['GRENOBLE', f.lato, C.beigePlus, 0.16]];
    var whoLh = 0.95 * U * 1.7, whoTop = H - 2.8 * U - whoLh * 3;
    whoLines.forEach(function (l, i) { drawText(page, l[0], { x: 2.4 * U, y: Y(whoTop + whoLh * i + 0.95 * U * 1.15), size: 0.95 * U, font: l[1], color: l[2], spacing: l[3] * 0.95 * U }); });
    var titleTop = (3.2 * U + 17 * U + whoTop) / 2 - 3.6 * U * 1.05;
    drawText(page, 'Carte', { x: 2.4 * U, y: Y(titleTop + 3.6 * U * 0.9), size: 3.6 * U, font: f.playfair, color: C.creme });
    drawText(page, 'cadeau', { x: 2.4 * U, y: Y(titleTop + 3.6 * U * 1.95), size: 3.6 * U, font: f.playfairItalic, color: C.beigePlus });

    // Zone principale.
    var x = 28 * U, right = 96 * U, width = right - x, top = 3.4 * U;
    drawText(page, 'UN MOMENT RIEN QUE POUR VOUS', { x: x, y: Y(top + 1 * U), size: 1 * U, font: f.latoBold, color: C.brun, spacing: 0.22 * U });
    top += 1.35 * U + 0.5 * U;
    drawRuns(page, fitSize([
      { text: 'Pour ', font: f.playfair, size: 3.4 * U, color: C.profond },
      { text: card.recipient_name, font: f.playfairItalic, size: 3.4 * U, color: C.brun },
    ], width, 2 * U), x, Y(top + 3.4 * U * 0.85));
    top += 3.4 * U * 1.1 + 0.5 * U;
    drawRuns(page, fitSize([
      { text: 'De la part de ', font: f.lato, size: 1.3 * U, color: C.gris },
      { text: card.buyer_name, font: f.latoBold, size: 1.3 * U, color: C.texte },
    ], width, 1 * U), x, Y(top + 1.3 * U));
    top += 1.3 * U * 1.35 + 1.8 * U;

    // Valeur de la carte, entre deux filets.
    page.drawLine({ start: { x: x, y: Y(top) }, end: { x: right, y: Y(top) }, thickness: 0.6, color: C.beigePlus });
    var valueH;
    if (card.kind === 'montant') {
      var amt = window.GiftCard.euros(card.amount_cents);
      drawText(page, amt, { x: x, y: Y(top + 1.5 * U + 5.4 * U * 0.8), size: 5.4 * U, font: f.playfair, color: C.profond });
      var ax = x + f.playfair.widthOfTextAtSize(amt, 5.4 * U) + 1.8 * U;
      drawText(page, 'à valoir sur un soin', { x: ax, y: Y(top + 1.5 * U + 1.9 * U), size: 1.15 * U, font: f.lato, color: C.gris });
      drawText(page, 'de drainage lymphatique', { x: ax, y: Y(top + 1.5 * U + 3.6 * U), size: 1.15 * U, font: f.lato, color: C.gris });
      valueH = 5.4 * U + 3 * U;
    } else {
      var small = card.detail === "Séance d'environ 1h" ? 'environ 1h · au cabinet' : card.detail === "Séance d'environ 40 min" ? 'environ 40 min · au cabinet' : card.detail;
      var runs = fitSize([
        { text: card.label, font: f.playfair, size: 2.5 * U, color: C.profond },
        { text: '   ' + small, font: f.lato, size: 1.15 * U, color: C.brun, spacing: 0.06 * 1.15 * U },
      ], width, 1 * U);
      drawRuns(page, runs, x, Y(top + 1.5 * U + 2.5 * U * 0.85));
      valueH = 2.5 * U * 1.15 + 3 * U;
    }
    top += valueH;
    page.drawLine({ start: { x: x, y: Y(top) }, end: { x: right, y: Y(top) }, thickness: 0.6, color: C.beigePlus });
    top += 1.6 * U;

    // Message (3 lignes au plus).
    var qrSize = 8.6 * U, msgWidth = width - qrSize - 3 * U;
    if (card.message) {
      var lines = wrap(f.playfairItalic, 1.4 * U, '« ' + card.message + ' »', msgWidth).slice(0, 3);
      lines.forEach(function (l, i) { drawText(page, l, { x: x, y: Y(top + 1.4 * U * (1.15 + 1.5 * i)), size: 1.4 * U, font: f.playfairItalic, color: C.msg }); });
    }

    // Bas de carte : validité, numéro, QR code, micro-texte.
    var bottom = H - 2.6 * U;
    var codeY = bottom - 0.4 * U;
    drawText(page, card.code, { x: x, y: Y(codeY), size: 1.6 * U, font: f.courier, color: C.profond, spacing: 0.14 * 1.6 * U });
    var metaY = codeY - 1.6 * U * 1.3;
    drawRuns(page, [
      { text: "Valable 6 mois, jusqu'au ", font: f.lato, size: 1 * U, color: C.gris },
      { text: window.GiftCard.frDateLong(card.expires_at), font: f.latoBold, size: 1 * U, color: C.texte },
      { text: ' · émise le ' + window.GiftCard.frDate(card.created_at), font: f.lato, size: 1 * U, color: C.gris },
    ], x, Y(metaY));

    var qx = right - qrSize, labelY = bottom - 0.2 * U, qTop = labelY - 0.8 * U * 1.2 - 0.4 * U - qrSize;
    page.drawRectangle({ x: qx, y: Y(qTop + qrSize), width: qrSize, height: qrSize, color: C.blanc, borderColor: C.beigePlus, borderWidth: 0.6 });
    var m = window.GiftCard.qrMatrix(window.GiftCard.cardUrl(card)), n = m.length, pad = 0.5 * U, cell = (qrSize - 2 * pad) / n;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) {
      page.drawRectangle({ x: qx + pad + c * cell, y: Y(qTop + pad + (r + 1) * cell), width: cell + 0.05, height: cell + 0.05, color: C.texte });
    }
    var label = 'Scannez pour vérifier', lw = textW(f.lato, 0.8 * U, label, 0.06 * 0.8 * U);
    drawText(page, label, { x: qx + (qrSize - lw) / 2, y: Y(labelY), size: 0.8 * U, font: f.lato, color: C.brun, spacing: 0.06 * 0.8 * U });

    var micro = Array(9).join('LUCILE LE POCREAU · ' + card.code + ' · CARTE CADEAU AUTHENTIQUE · ');
    drawText(page, truncate(f.lato, 0.5 * U, micro, right - x - 2 * U), { x: x, y: Y(H - 0.9 * U), size: 0.5 * U, font: f.lato, color: C.beige });
  }

  function verso(pdf, f, img, card) {
    var page = pdf.addPage([W, H]);
    background(page);
    bandRect(page, 76 * U, false);

    // Bandeau droit : logo + adresse, centrés.
    var cx = 88 * U, d = 17 * U, blockH = d + 1.6 * U + 1.7 * U * 1.3 + 1.05 * U * 1.7 * 5;
    var t = (H - blockH) / 2;
    logo(page, img, cx, t, d);
    t += d + 1.6 * U;
    var cab = 'Le cabinet';
    drawText(page, cab, { x: cx - f.playfair.widthOfTextAtSize(cab, 1.7 * U) / 2, y: Y(t + 1.7 * U), size: 1.7 * U, font: f.playfair, color: C.creme });
    t += 1.7 * U * 1.3 + 0.4 * U;
    ['16 place Sainte-Claire', '38000 Grenoble', '', 'lucile-diet.fr', '@lucile.diet'].forEach(function (l, i) {
      if (!l) return;
      drawText(page, l, { x: cx - f.lato.widthOfTextAtSize(l, 1.05 * U) / 2, y: Y(t + 1.05 * U * (1.2 + 1.7 * i)), size: 1.05 * U, font: f.lato, color: C.beigePlus });
    });

    // Zone principale : mode d'emploi + conditions.
    var x = 4 * U, right = 72 * U, top = 3.4 * U;
    drawText(page, 'Comment utiliser votre carte', { x: x, y: Y(top + 2.5 * U * 0.9), size: 2.5 * U, font: f.playfair, color: C.profond });
    top += 2.5 * U * 1.3 + 1.6 * U;
    var steps = [
      [{ t: 'Réservez sur ' }, { t: 'Doctolib', b: 1 }, { t: ' ou au ' }, { t: '07 67 95 57 09', b: 1 }, { t: '.' }],
      [{ t: 'Indiquez que vous avez une carte cadeau et donnez son numéro ' }, { t: card.code, b: 1 }, { t: '.' }],
      [{ t: 'Présentez la carte (imprimée ou sur téléphone) le jour du soin : elle est validée par QR code.' }],
    ];
    steps.forEach(function (s, i) {
      var cy = top + 1.4 * U;
      page.drawCircle({ x: x + 1.4 * U, y: Y(cy), size: 1.4 * U, color: C.fond, borderColor: C.beige, borderWidth: 0.6 });
      var num = String(i + 1);
      drawText(page, num, { x: x + 1.4 * U - f.playfair.widthOfTextAtSize(num, 1.3 * U) / 2, y: Y(cy + 0.45 * U), size: 1.3 * U, font: f.playfair, color: C.brun });
      drawRuns(page, fitSize(s.map(function (p) { return { text: p.t, font: p.b ? f.latoBold : f.lato, size: 1.25 * U, color: C.texte }; }), right - x - 4 * U, 0.9 * U), x + 4 * U, Y(cy + 0.45 * U));
      top += 2.8 * U + 1.1 * U;
    });

    var conds = "Valable uniquement sur les soins de drainage lymphatique, pendant 6 mois à compter de la date d'émission. Hors droit de rétractation, carte non remboursable et non échangeable contre des espèces. Chaque numéro n'est valable qu'une fois : toute copie est inutilisable. Conditions sur lucile-diet.fr/carte-cadeau.html.";
    var lines = wrap(f.lato, 0.95 * U, conds, right - x), lh = 0.95 * U * 1.6;
    var ctop = H - 2.6 * U - lines.length * lh;
    page.drawLine({ start: { x: x, y: Y(ctop - 1.2 * U) }, end: { x: right, y: Y(ctop - 1.2 * U) }, thickness: 0.6, color: C.beigePlus });
    lines.forEach(function (l, i) { drawText(page, l, { x: x, y: Y(ctop + lh * i + 0.95 * U), size: 0.95 * U, font: f.lato, color: C.gris }); });
  }

  function build(card) {
    var L = window.PDFLib;
    return Promise.all([
      L.PDFDocument.create(),
      fetchBytes('/carte-cadeau/fonts/PlayfairDisplay_400Regular.ttf'),
      fetchBytes('/carte-cadeau/fonts/PlayfairDisplay_400Regular_Italic.ttf'),
      fetchBytes('/carte-cadeau/fonts/Lato_400Regular.ttf'),
      fetchBytes('/carte-cadeau/fonts/Lato_700Bold.ttf'),
      fetchBytes('/carte-cadeau/logo-rond.png'),
    ]).then(function (res) {
      var pdf = res[0];
      pdf.registerFontkit(window.fontkit);
      pdf.setTitle('Carte cadeau ' + card.code);
      pdf.setAuthor('Lucile Le Pocreau – Drainage lymphatique, Grenoble');
      pdf.setSubject('Carte cadeau pour ' + card.recipient_name);
      pdf.setCreator('lucile-diet.fr');
      return Promise.all([
        pdf.embedFont(res[1]), pdf.embedFont(res[2]), pdf.embedFont(res[3]), pdf.embedFont(res[4]),
        pdf.embedFont(L.StandardFonts.CourierBold), pdf.embedPng(res[5]),
      ]).then(function (e) {
        var f = { playfair: e[0], playfairItalic: e[1], lato: e[2], latoBold: e[3], courier: e[4] };
        recto(pdf, f, e[5], card);
        verso(pdf, f, e[5], card);
        return pdf.save();
      });
    });
  }

  window.GiftCardPdf = { build: build };
})();

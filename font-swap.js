// ── CHARGEMENT NON BLOQUANT DES GOOGLE FONTS ──
// Le lien vers fonts.googleapis.com est chargé avec media="print" dans le HTML :
// le navigateur le télécharge sans qu'il bloque le premier rendu (contrairement à
// un <link rel="stylesheet"> classique). Une fois ce script exécuté (defer, donc
// après le parsing du HTML), on bascule le lien en media="all" pour appliquer la
// police. Évite ~700-800ms de rendu bloqué par la feuille de style Google Fonts
// (audit PageSpeed Insights).
(function () {
  var link = document.getElementById('gfonts-link');
  if (link) link.media = 'all';
})();

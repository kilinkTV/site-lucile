// Règles métier partagées : offres, codes, signatures, dates, statut.

// Seules les prestations de drainage lymphatique sont vendues en carte cadeau.
// Les prix font foi ici (le navigateur ne fait qu'afficher) : ne jamais faire
// confiance à un montant envoyé par le client pour une prestation.
export const OFFERS = {
  'corps': { label: 'Drainage lymphatique corps entier', detail: "Séance d'environ 1h", cents: 9000, sessions: 1 },
  'zone': { label: 'Drainage lymphatique zone au choix', detail: "Séance d'environ 40 min", cents: 5000, sessions: 1 },
  'cure-zone': { label: 'Cure drainage zone au choix', detail: '5 séances', cents: 20000, sessions: 5 },
  'cure-corps': { label: 'Cure drainage corps entier', detail: '5 séances', cents: 36000, sessions: 5 },
};
export const AMOUNT_MIN_CENTS = 2000;
export const AMOUNT_MAX_CENTS = 50000;
export const VALIDITY_MONTHS = 6;
export const MONTANT_LABEL = 'Carte montant libre';
export const MONTANT_DETAIL = 'À valoir sur un soin de drainage lymphatique';

// Alphabet sans 0/O/1/I pour éviter les confusions à la lecture.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomChars(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return s;
}

export function newCode() {
  const r = randomChars(8);
  return `LD-${r.slice(0, 4)}-${r.slice(4)}`;
}

export function normalizeCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^LD([2-9A-HJ-NP-Z]{4})([2-9A-HJ-NP-Z]{4})$/.exec(c);
  return m ? `LD-${m[1]}-${m[2]}` : null;
}

let keyCache;
async function signingKey(env) {
  if (!keyCache || keyCache.raw !== env.CARD_SIGNING_KEY) {
    if (!env.CARD_SIGNING_KEY) throw new Error('CARD_SIGNING_KEY manquant');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CARD_SIGNING_KEY),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache = { raw: env.CARD_SIGNING_KEY, key };
  }
  return keyCache.key;
}

// Signature courte (40 bits) du numéro : empêche de fabriquer un QR valide
// sans la clé secrète. Le registre reste la vraie source de vérité.
export async function signCode(env, code) {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), new TextEncoder().encode(code)));
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[mac[i] & 31];
  return s;
}

export async function verifySig(env, code, sig) {
  if (!code || typeof sig !== 'string' || sig.length !== 8) return false;
  const expected = await signCode(env, code);
  let diff = 0;
  for (let i = 0; i < 8; i++) diff |= expected.charCodeAt(i) ^ sig.toUpperCase().charCodeAt(i);
  return diff === 0;
}

export async function cardUrl(env, code) {
  return `${env.SITE_URL}/carte-cadeau/carte.html?c=${encodeURIComponent(code)}&s=${await signCode(env, code)}`;
}

// Date du jour à Paris (AAAA-MM-JJ), pour que l'expiration tombe à minuit heure française.
export function todayParis(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function cardStatus(card, today = todayParis()) {
  if (card.blocked) return 'bloquee';
  if (card.kind === 'prestation' ? card.sessions_left <= 0 : card.balance_cents <= 0) return 'utilisee';
  if (today > card.expires_at) return 'expiree';
  return 'valide';
}

export function euros(cents) {
  const v = cents / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')) + ' €';
}

export function frDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function frDateLong(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nettoie une saisie texte : pas de caractères de contrôle, longueur bornée.
export function cleanText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max);
}

export function isEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Construit la carte (ligne du registre) à partir d'une commande validée.
export function buildCard({ kind, offer, amount_cents, buyer_name, buyer_email, recipient_name, message, source, payment_ref, stripe_session_id }, now = new Date()) {
  const created_at = now.toISOString();
  const base = {
    code: newCode(), kind, buyer_name, buyer_email: buyer_email || null, recipient_name, message: message || null,
    created_at, expires_at: addMonths(todayParis(now), VALIDITY_MONTHS),
    source, payment_ref: payment_ref || null, stripe_session_id: stripe_session_id || null,
    blocked: 0, balance_cents: null, sessions_total: null, sessions_left: null, offer: null,
  };
  if (kind === 'prestation') {
    const o = OFFERS[offer];
    if (!o) throw new Error('Offre inconnue');
    return { ...base, offer, label: o.label, detail: o.detail, amount_cents: o.cents, sessions_total: o.sessions, sessions_left: o.sessions };
  }
  return { ...base, label: MONTANT_LABEL, detail: MONTANT_DETAIL, amount_cents, balance_cents: amount_cents };
}

// Valide une commande (formulaire du site ou création manuelle par Lucile).
export function validateOrder(body) {
  const errors = [];
  const kind = body.kind === 'montant' ? 'montant' : body.kind === 'prestation' ? 'prestation' : null;
  if (!kind) errors.push('Type de carte invalide.');
  let offer = null, amount_cents = null;
  if (kind === 'prestation') {
    offer = String(body.offer || '');
    if (!OFFERS[offer]) errors.push('Prestation inconnue.');
    else amount_cents = OFFERS[offer].cents;
  } else if (kind === 'montant') {
    amount_cents = Math.round(Number(body.amount_euros) * 100);
    if (!Number.isInteger(Number(body.amount_euros)) || amount_cents < AMOUNT_MIN_CENTS || amount_cents > AMOUNT_MAX_CENTS) {
      errors.push(`Le montant doit être un nombre entier d'euros entre ${AMOUNT_MIN_CENTS / 100} et ${AMOUNT_MAX_CENTS / 100} €.`);
    }
  }
  const buyer_name = cleanText(body.buyer_name, 80);
  const recipient_name = cleanText(body.recipient_name, 80);
  const buyer_email = cleanText(body.buyer_email, 254).toLowerCase();
  const message = cleanText(body.message, 220);
  if (!buyer_name) errors.push('Votre nom est obligatoire.');
  if (!recipient_name) errors.push('Le nom du bénéficiaire est obligatoire.');
  return { errors, order: { kind, offer, amount_cents, buyer_name, buyer_email, recipient_name, message } };
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

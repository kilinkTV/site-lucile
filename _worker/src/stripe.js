// Appels à l'API Stripe (sans SDK : fetch + formulaire encodé).

function encodeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encodeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquant');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, // trim : un copier-coller peut ajouter un espace ou un retour à la ligne
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params ? encodeForm(params) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* réponse non JSON, traitée ci-dessous */ }
  if (!res.ok || !data) throw new Error(`Stripe ${res.status} : ${(data && data.error && data.error.message) || text.slice(0, 200) || 'réponse vide'}`);
  return data;
}

// Crée la page de paiement Stripe. Toutes les données de la carte voyagent dans
// les metadata de la session, et reviennent au webhook une fois le paiement fait.
// returnBase : adresse de retour après paiement. Seul le mode test Stripe accepte le site local
// (tests de bout en bout avant publication) ; en production c'est toujours SITE_URL.
const LOCAL_TEST_SITE = 'http://localhost:8080';

export function createCheckoutSession(env, order, { label, detail }, returnBase) {
  const testKey = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY.trim());
  const base = testKey && returnBase === LOCAL_TEST_SITE ? LOCAL_TEST_SITE : env.SITE_URL;
  const productName = order.kind === 'prestation' ? `Carte cadeau – ${label}` : 'Carte cadeau – drainage lymphatique';
  return stripe(env, 'POST', '/checkout/sessions', {
    mode: 'payment',
    locale: 'fr',
    customer_email: order.buyer_email,
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: order.amount_cents,
          product_data: { name: productName, description: `${detail} · Pour ${order.recipient_name} · Valable 6 mois` },
        },
      },
    },
    metadata: {
      kind: order.kind,
      offer: order.offer || '',
      amount_cents: order.amount_cents,
      buyer_name: order.buyer_name,
      recipient_name: order.recipient_name,
      message: order.message || '',
    },
    payment_intent_data: { description: `Carte cadeau pour ${order.recipient_name}` },
    success_url: `${base}/carte-cadeau/merci.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/carte-cadeau.html?annule=1`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // la page de paiement expire après 1 h
  });
}

export function retrieveSession(env, id) {
  return stripe(env, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

// Transforme une session Stripe payée en commande prête à enregistrer.
export function orderFromSession(session) {
  const m = session.metadata || {};
  return {
    kind: m.kind,
    offer: m.offer || null,
    amount_cents: Number(m.amount_cents),
    buyer_name: m.buyer_name,
    buyer_email: (session.customer_details && session.customer_details.email) || session.customer_email,
    recipient_name: m.recipient_name,
    message: m.message || '',
    source: 'stripe',
    payment_ref: session.payment_intent || session.id,
    stripe_session_id: session.id,
  };
}

// Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de "timestamp.corps").
export async function verifyWebhook(env, rawBody, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, v]));
  const signatures = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false; // rejeu > 5 min
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET.trim()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  const expected = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return signatures.some(sig => {
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

// Worker « cartes cadeaux » de lucile-diet.fr
//  - lucile-diet.fr/api/*      : API publique (achat, suivi de commande, vérification d'une carte)
//  - admin.lucile-diet.fr      : app web de Lucile (fichiers de ./admin) + API admin, derrière Cloudflare Access
import { adminIdentity } from './access.js';
import { adminCard, getCard, getCardBySession, insertCard, publicCard } from './db.js';
import { OFFERS, cardStatus, frDate, json, normalizeCode, validateOrder, verifySig, isEmail, cleanText, MONTANT_LABEL, MONTANT_DETAIL } from './lib.js';
import { notifyAdmin, sendCardToBuyer } from './mail.js';
import { createCheckoutSession, orderFromSession, retrieveSession, verifyWebhook } from './stripe.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      // En local, le serveur de dev du site ajoute « x-dev-site » ; le reste est l'app admin.
      if (url.hostname === env.ADMIN_HOST || (env.DEV === '1' && !request.headers.get('x-dev-site'))) {
        return withHeaders(await handleAdmin(request, env, url));
      }
      if (url.pathname.startsWith('/api/')) return withHeaders(await handlePublic(request, env, ctx, url));
      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error(e.stack || e);
      return withHeaders(json({ error: 'Erreur interne, merci de réessayer.' }, 500));
    }
  },
};

// ───────────────────────── API publique ─────────────────────────

function sameOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (env.DEV === '1') return true;
  return origin === env.SITE_URL;
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  try { return await request.json(); } catch { return null; }
}

// Crée la carte (une seule fois par paiement) et envoie les e-mails à la création.
async function fulfill(env, ctx, order) {
  const { card, created } = await insertCard(env, order);
  if (created) {
    const task = (async () => {
      try {
        const r = await sendCardToBuyer(env, card);
        if (!r.skipped) await env.DB.prepare('UPDATE cards SET email_sent_at = ? WHERE code = ?').bind(new Date().toISOString(), card.code).run();
      } catch (e) { console.error('Mail acheteur :', e.message); }
      try { await notifyAdmin(env, card); } catch (e) { console.error('Mail Lucile :', e.message); }
    })();
    ctx.waitUntil(task);
  }
  return card;
}

async function handlePublic(request, env, ctx, url) {
  const path = url.pathname;

  // Démarre un paiement : valide la commande, crée la session Stripe, renvoie son URL.
  if (path === '/api/checkout' && request.method === 'POST') {
    if (!sameOrigin(request, env)) return json({ error: 'Origine refusée.' }, 403);
    const body = await readJson(request);
    if (!body) return json({ error: 'Requête invalide.' }, 400);
    const { errors, order } = validateOrder(body);
    if (!isEmail(order.buyer_email)) errors.push('Adresse e-mail invalide.');
    if (body.accept_cgv !== true) errors.push('Merci d\'accepter les conditions des cartes cadeaux.');
    if (errors.length) return json({ error: errors.join(' ') }, 400);
    // Tant que la clé Stripe est une clé de test, les achats restent fermés sur le site public
    // (sinon la carte de test 4242 donnerait de vraies cartes cadeaux) ; seul le site local de test passe.
    const testKey = env.STRIPE_SECRET_KEY && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY.trim());
    const token = request.headers.get('x-test-token');
    const localTest = !!env.TEST_CHECKOUT_TOKEN && token === env.TEST_CHECKOUT_TOKEN && request.headers.get('x-return-base') === 'http://localhost:8080';
    if (!env.STRIPE_SECRET_KEY || (testKey && !localTest)) {
      return json({ error: 'Le paiement en ligne ouvre très bientôt. En attendant, les cartes cadeaux sont disponibles au cabinet.' }, 503);
    }
    const offer = order.kind === 'prestation' ? OFFERS[order.offer] : { label: MONTANT_LABEL, detail: MONTANT_DETAIL };
    const session = await createCheckoutSession(env, order, offer, request.headers.get('x-return-base'));
    return json({ url: session.url });
  }

  // Webhook Stripe : paiement confirmé → création de la carte.
  if (path === '/api/stripe/webhook' && request.method === 'POST') {
    const raw = await request.text();
    if (!(await verifyWebhook(env, raw, request.headers.get('stripe-signature')))) return json({ error: 'Signature invalide' }, 400);
    const event = JSON.parse(raw);
    const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
    if (types.includes(event.type) && event.data.object.payment_status === 'paid') {
      await fulfill(env, ctx, orderFromSession(event.data.object));
    }
    return json({ received: true });
  }

  // Page « merci » : récupère la carte d'une session payée (la crée si le webhook n'est pas encore passé).
  if (path === '/api/order' && request.method === 'GET') {
    const id = url.searchParams.get('session_id') || '';
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Commande introuvable.' }, 404);
    let card = await getCardBySession(env, id);
    if (!card) {
      const session = await retrieveSession(env, id).catch(() => null);
      if (!session) return json({ error: 'Commande introuvable.' }, 404);
      if (session.payment_status !== 'paid') return json({ pending: true }, 202);
      card = await fulfill(env, ctx, orderFromSession(session));
    }
    return json({ card: await publicCard(env, card), email: card.buyer_email });
  }

  // Page publique du QR code : consultation seule, aucune action possible.
  if (path === '/api/card' && request.method === 'GET') {
    const code = normalizeCode(url.searchParams.get('c'));
    const sig = url.searchParams.get('s');
    if (!code || !(await verifySig(env, code, sig))) return json({ error: 'Carte invalide : ce QR code n\'a pas été émis par le cabinet.' }, 404);
    const card = await getCard(env, code);
    if (!card) return json({ error: 'Carte introuvable.' }, 404);
    return json({ card: await publicCard(env, card) });
  }

  // Développement local uniquement : simule un paiement réussi.
  if (path === '/api/dev/fake-order' && request.method === 'POST' && env.DEV === '1') {
    const body = await readJson(request);
    const { errors, order } = validateOrder(body || {});
    if (errors.length) return json({ error: errors.join(' ') }, 400);
    const card = await fulfill(env, ctx, { ...order, source: 'stripe', payment_ref: 'dev', stripe_session_id: `cs_test_dev${Date.now()}` });
    return json({ card: await publicCard(env, card), session_id: card.stripe_session_id });
  }

  return json({ error: 'Introuvable.' }, 404);
}

// ───────────────────────── Espace de Lucile ─────────────────────────

async function handleAdmin(request, env, url) {
  const who = await adminIdentity(request, env);
  if (!who) return new Response('Accès réservé.', { status: 403 });

  if (!url.pathname.startsWith('/api/')) {
    const res = await env.ASSETS.fetch(request);
    return withHeaders(res, {
      'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
  }

  // Toute écriture doit venir de l'app elle-même (protection CSRF).
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (env.DEV !== '1' && origin !== `https://${env.ADMIN_HOST}`) return json({ error: 'Origine refusée.' }, 403);
  }

  const path = url.pathname;
  const m = (re) => re.exec(path);
  let r;

  if (path === '/api/me') return json({ email: who });

  if (path === '/api/cards' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const status = url.searchParams.get('status') || '';
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM cards WHERE (? = '' OR code LIKE ? OR buyer_name LIKE ? OR recipient_name LIKE ? OR buyer_email LIKE ?)
       ORDER BY created_at DESC LIMIT 300`
    ).bind(q, like, like, like, like).all();
    const cards = results.map(c => ({ ...c, status: cardStatus(c) })).filter(c => !status || c.status === status);
    return json({ cards });
  }

  if (path === '/api/cards' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body) return json({ error: 'Requête invalide.' }, 400);
    const { errors, order } = validateOrder(body);
    if (order.buyer_email && !isEmail(order.buyer_email)) errors.push('Adresse e-mail invalide.');
    const payment_ref = ['especes', 'virement', 'cb-cabinet', 'offert'].includes(body.payment_ref) ? body.payment_ref : null;
    if (!payment_ref) errors.push('Moyen de paiement invalide.');
    if (errors.length) return json({ error: errors.join(' ') }, 400);
    const { card } = await insertCard(env, { ...order, source: 'manuel', payment_ref });
    if (body.send_email && card.buyer_email) {
      await sendCardToBuyer(env, card);
      await env.DB.prepare('UPDATE cards SET email_sent_at = ? WHERE code = ?').bind(new Date().toISOString(), card.code).run();
    }
    return json({ card: await adminCard(env, await getCard(env, card.code)) });
  }

  if ((r = m(/^\/api\/cards\/([A-Z0-9-]+)$/)) && request.method === 'GET') {
    const card = await getCard(env, normalizeCode(r[1]));
    return card ? json({ card: await adminCard(env, card) }) : json({ error: 'Carte introuvable.' }, 404);
  }

  // Utilisation : une séance (carte prestation) ou un montant (carte montant libre).
  if ((r = m(/^\/api\/cards\/([A-Z0-9-]+)\/use$/)) && request.method === 'POST') {
    const code = normalizeCode(r[1]);
    const card = await getCard(env, code);
    if (!card) return json({ error: 'Carte introuvable.' }, 404);
    const status = cardStatus(card);
    if (status !== 'valide') return json({ error: `Carte ${status === 'utilisee' ? 'déjà entièrement utilisée' : status === 'expiree' ? 'expirée' : 'bloquée'} : impossible de la valider.` }, 409);
    const body = (await readJson(request)) || {};
    const now = new Date().toISOString();
    if (card.kind === 'prestation') {
      const res = await env.DB.prepare('UPDATE cards SET sessions_left = sessions_left - 1 WHERE code = ? AND sessions_left > 0').bind(code).run();
      if (res.meta.changes !== 1) return json({ error: 'Plus aucune séance sur cette carte.' }, 409);
      await env.DB.prepare('INSERT INTO movements (code, created_at, label, sessions) VALUES (?, ?, ?, 1)').bind(code, now, card.label).run();
      return json({ card: await adminCard(env, await getCard(env, code)), charged_cents: 0, due_cents: 0 });
    }
    const amount = Math.round(Number(body.amount_cents));
    const label = cleanText(body.label, 120) || 'Soin de drainage lymphatique';
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return json({ error: 'Montant invalide.' }, 400);
    const charged = Math.min(amount, card.balance_cents);
    const due = amount - charged;
    const res = await env.DB.prepare('UPDATE cards SET balance_cents = balance_cents - ? WHERE code = ? AND balance_cents >= ?').bind(charged, code, charged).run();
    if (res.meta.changes !== 1) return json({ error: 'Le solde a changé entre-temps, rechargez la fiche.' }, 409);
    await env.DB.prepare('INSERT INTO movements (code, created_at, label, amount_cents, due_cents) VALUES (?, ?, ?, ?, ?)').bind(code, now, label, charged, due).run();
    return json({ card: await adminCard(env, await getCard(env, code)), charged_cents: charged, due_cents: due });
  }

  // Annule une utilisation (erreur de manipulation) : rend la séance ou le montant.
  if ((r = m(/^\/api\/movements\/(\d+)\/cancel$/)) && request.method === 'POST') {
    const mv = await env.DB.prepare('SELECT * FROM movements WHERE id = ?').bind(Number(r[1])).first();
    if (!mv) return json({ error: 'Opération introuvable.' }, 404);
    if (mv.cancelled_at) return json({ error: 'Opération déjà annulée.' }, 409);
    await env.DB.batch([
      env.DB.prepare('UPDATE movements SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL').bind(new Date().toISOString(), mv.id),
      mv.sessions
        ? env.DB.prepare('UPDATE cards SET sessions_left = sessions_left + ? WHERE code = ?').bind(mv.sessions, mv.code)
        : env.DB.prepare('UPDATE cards SET balance_cents = balance_cents + ? WHERE code = ?').bind(mv.amount_cents, mv.code),
    ]);
    return json({ card: await adminCard(env, await getCard(env, mv.code)) });
  }

  if ((r = m(/^\/api\/cards\/([A-Z0-9-]+)\/(block|unblock)$/)) && request.method === 'POST') {
    const code = normalizeCode(r[1]);
    const body = (await readJson(request)) || {};
    const card = await getCard(env, code);
    if (!card) return json({ error: 'Carte introuvable.' }, 404);
    if (r[2] === 'unblock' && card.replaced_by) return json({ error: `Cette carte a été remplacée par ${card.replaced_by}.` }, 409);
    await env.DB.prepare('UPDATE cards SET blocked = ?, blocked_reason = ? WHERE code = ?')
      .bind(r[2] === 'block' ? 1 : 0, r[2] === 'block' ? (cleanText(body.reason, 200) || 'Bloquée par Lucile') : null, code).run();
    return json({ card: await adminCard(env, await getCard(env, code)) });
  }

  // Réémission (carte perdue ou volée) : nouveau numéro, même solde, l'ancienne est bloquée.
  if ((r = m(/^\/api\/cards\/([A-Z0-9-]+)\/reissue$/)) && request.method === 'POST') {
    const code = normalizeCode(r[1]);
    const old = await getCard(env, code);
    if (!old) return json({ error: 'Carte introuvable.' }, 404);
    if (old.replaced_by) return json({ error: `Déjà remplacée par ${old.replaced_by}.` }, 409);
    const { card } = await insertCard(env, {
      kind: old.kind, offer: old.offer, amount_cents: old.amount_cents, buyer_name: old.buyer_name, buyer_email: old.buyer_email,
      recipient_name: old.recipient_name, message: old.message, source: old.source, payment_ref: old.payment_ref,
    });
    // Conserve le solde, les séances restantes et la date d'expiration d'origine.
    await env.DB.batch([
      env.DB.prepare('UPDATE cards SET balance_cents = ?, sessions_left = ?, expires_at = ?, created_at = ? WHERE code = ?')
        .bind(old.balance_cents, old.sessions_left, old.expires_at, old.created_at, card.code),
      env.DB.prepare('UPDATE cards SET blocked = 1, blocked_reason = ?, replaced_by = ? WHERE code = ?')
        .bind(`Remplacée par ${card.code}`, card.code, code),
    ]);
    return json({ card: await adminCard(env, await getCard(env, card.code)) });
  }

  if ((r = m(/^\/api\/cards\/([A-Z0-9-]+)\/email$/)) && request.method === 'POST') {
    const code = normalizeCode(r[1]);
    const card = await getCard(env, code);
    if (!card) return json({ error: 'Carte introuvable.' }, 404);
    const body = (await readJson(request)) || {};
    const to = cleanText(body.to, 254).toLowerCase() || card.buyer_email;
    if (!isEmail(to)) return json({ error: 'Adresse e-mail invalide.' }, 400);
    if (!env.RESEND_API_KEY) return json({ error: 'Envoi d\'e-mails pas encore configuré.' }, 503);
    await sendCardToBuyer(env, card, to);
    await env.DB.prepare('UPDATE cards SET email_sent_at = ? WHERE code = ?').bind(new Date().toISOString(), code).run();
    return json({ ok: true, to });
  }

  if (path === '/api/export.csv' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM cards ORDER BY created_at').all();
    const { results: mvs } = await env.DB.prepare('SELECT * FROM movements WHERE cancelled_at IS NULL ORDER BY id').all();
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Carte', 'Opération', 'Détail', 'Montant (€)', 'Séances', 'Reste à payer (€)', 'Paiement', 'Acheteur', 'E-mail', 'Bénéficiaire', 'Expiration', 'Statut actuel'].join(';')];
    for (const c of results) {
      lines.push([frDate(c.created_at), c.code, 'Vente', c.label, (c.amount_cents / 100).toFixed(2).replace('.', ','), c.sessions_total ?? '', '',
        c.payment_ref, c.buyer_name, c.buyer_email, c.recipient_name, frDate(c.expires_at), cardStatus(c)].map(esc).join(';'));
    }
    for (const mv of mvs) {
      lines.push([frDate(mv.created_at), mv.code, 'Utilisation', mv.label, mv.amount_cents ? (-mv.amount_cents / 100).toFixed(2).replace('.', ',') : '',
        mv.sessions ? -mv.sessions : '', mv.due_cents ? (mv.due_cents / 100).toFixed(2).replace('.', ',') : '', '', '', '', '', '', ''].map(esc).join(';'));
    }
    return new Response('﻿' + lines.join('\r\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="cartes-cadeaux-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  return json({ error: 'Introuvable.' }, 404);
}

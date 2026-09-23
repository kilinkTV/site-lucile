// Accès au registre D1.
import { buildCard, cardStatus, cardUrl, signCode } from './lib.js';

const CARD_COLUMNS = ['code', 'kind', 'offer', 'label', 'detail', 'amount_cents', 'balance_cents', 'sessions_total',
  'sessions_left', 'buyer_name', 'buyer_email', 'recipient_name', 'message', 'created_at', 'expires_at', 'blocked',
  'blocked_reason', 'replaced_by', 'source', 'payment_ref', 'stripe_session_id', 'email_sent_at'];

// Insère une carte. Réessaie avec un nouveau code dans le cas (improbable) d'une collision.
// Retourne { card, created } ; created = false si la session Stripe avait déjà sa carte.
export async function insertCard(env, order) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const card = buildCard(order);
    const cols = CARD_COLUMNS.filter(c => c in card);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO cards (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
      ).bind(...cols.map(c => card[c])).run();
      if (res.meta.changes === 1) return { card: await getCard(env, card.code), created: true };
    } catch (e) {
      const msg = String(e && e.message);
      if (order.stripe_session_id && msg.includes('stripe_session_id')) {
        return { card: await getCardBySession(env, order.stripe_session_id), created: false };
      }
      if (!msg.includes('UNIQUE') && !msg.includes('PRIMARY')) throw e;
      if (order.stripe_session_id) {
        const existing = await getCardBySession(env, order.stripe_session_id);
        if (existing) return { card: existing, created: false };
      }
    }
  }
  throw new Error('Impossible de générer un numéro de carte unique');
}

export function getCard(env, code) {
  return env.DB.prepare('SELECT * FROM cards WHERE code = ?').bind(code).first();
}

export function getCardBySession(env, sessionId) {
  return env.DB.prepare('SELECT * FROM cards WHERE stripe_session_id = ?').bind(sessionId).first();
}

export async function getMovements(env, code) {
  const { results } = await env.DB.prepare('SELECT * FROM movements WHERE code = ? ORDER BY id DESC').bind(code).all();
  return results;
}

// Ce que voit n'importe qui possédant le QR code : pas d'e-mail, pas de référence de paiement.
export async function publicCard(env, card) {
  const movements = await getMovements(env, card.code);
  const lastUse = movements.find(m => !m.cancelled_at);
  return {
    code: card.code,
    sig: await signCode(env, card.code),
    status: cardStatus(card),
    kind: card.kind,
    label: card.label,
    detail: card.detail,
    amount_cents: card.amount_cents,
    balance_cents: card.balance_cents,
    sessions_total: card.sessions_total,
    sessions_left: card.sessions_left,
    buyer_name: card.buyer_name,
    recipient_name: card.recipient_name,
    message: card.message,
    created_at: card.created_at,
    expires_at: card.expires_at,
    last_use_at: lastUse ? lastUse.created_at : null,
    replaced: !!card.replaced_by,
  };
}

// Vue complète pour l'espace de Lucile.
export async function adminCard(env, card) {
  return {
    ...card,
    status: cardStatus(card),
    card_url: await cardUrl(env, card.code),
    movements: await getMovements(env, card.code),
  };
}

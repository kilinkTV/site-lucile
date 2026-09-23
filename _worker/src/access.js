// Vérifie que la requête vient bien de Lucile, connectée via Cloudflare Access.
// Cloudflare Access bloque déjà les inconnus en amont ; cette vérification côté
// Worker garantit qu'aucune requête ne passe si Access était mal configuré ou contourné.

let certsCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function accessKeys(env) {
  if (certsCache.keys && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Certificats Access indisponibles (${res.status})`);
  const { keys } = await res.json();
  const imported = {};
  for (const jwk of keys) {
    imported[jwk.kid] = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  certsCache = { at: Date.now(), keys: imported };
  return imported;
}

// Retourne l'e-mail de la personne connectée, ou null si la requête n'est pas autorisée.
export async function adminIdentity(request, env) {
  if (env.DEV === '1') return env.ADMIN_EMAIL; // développement local uniquement (.dev.vars)
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    let keys = await accessKeys(env);
    if (!keys[header.kid]) { certsCache.at = 0; keys = await accessKeys(env); } // rotation des clés
    const key = keys[header.kid];
    if (!key || header.alg !== 'RS256') return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const now = Date.now() / 1000;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp < now) return null;
    const email = String(payload.email || '').toLowerCase();
    if (email !== env.ADMIN_EMAIL.toLowerCase()) return null;
    return email;
  } catch (e) {
    console.log('JWT Access invalide :', e.message);
    return null;
  }
}

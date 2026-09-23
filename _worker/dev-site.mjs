// Serveur local pour tester le site avec le Worker (npm run dev) :
// sert les fichiers du site sur http://localhost:8080 et relaie /api/* vers wrangler dev (port 8787).
// node dev-site.mjs --prod : relaie vers le Worker de production (tests de bout en bout).
const PROD = process.argv.includes('--prod') ? 'https://lucile-diet.fr' : '';
const TARGET = process.env.API_TARGET || PROD || 'http://127.0.0.1:8787';
// Jeton qui autorise les achats de test depuis ce site local (mode test Stripe uniquement), lu dans .dev.vars.
const TEST_TOKEN = (readFileSync(new URL('.dev.vars', import.meta.url), 'utf8').match(/^TEST_CHECKOUT_TOKEN=(.*)$/m) || [])[1];
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ttf': 'font/ttf', '.xml': 'application/xml', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
    const headers = { ...req.headers, 'x-dev-site': '1' };
    if (TARGET.startsWith('https://')) headers.origin = TARGET; // le Worker de prod n'accepte que l'origine du site
    if (TARGET.startsWith('https://')) headers['x-return-base'] = 'http://localhost:8080'; // retour Stripe vers ce site local (mode test uniquement)
    if (TARGET.startsWith('https://') && TEST_TOKEN) headers['x-test-token'] = TEST_TOKEN.trim();
    delete headers.host;
    const up = await fetch(TARGET + url.pathname + url.search, { method: req.method, headers, body }).catch(e => null);
    if (!up) { res.writeHead(502); return res.end('wrangler dev injoignable'); }
    const out = Object.fromEntries(up.headers);
    delete out['content-encoding']; delete out['content-length']; delete out['transfer-encoding']; // corps déjà décompressé par fetch
    res.writeHead(up.status, out);
    return res.end(Buffer.from(await up.arrayBuffer()));
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(normalize(ROOT)) || /[\/](_worker|\.git)[\/]/.test(file)) { res.writeHead(404); return res.end(); }
  try {
    let data = await readFile(file);
    // En local (http), la directive CSP upgrade-insecure-requests casserait les appels à /api.
    if (extname(file) === '.html') data = data.toString('utf8').replace('; upgrade-insecure-requests', '');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(8080, () => console.log('Site local : http://localhost:8080'));

# Cartes cadeaux – Worker Cloudflare

Ce dossier commence par `_` : GitHub Pages (Jekyll) ne le publie pas sur le site.

## Ce que fait le Worker

| Adresse | Rôle |
|---|---|
| `lucile-diet.fr/api/checkout` | Valide la commande et crée la page de paiement Stripe |
| `lucile-diet.fr/api/stripe/webhook` | Paiement confirmé par Stripe : crée la carte et envoie les e-mails |
| `lucile-diet.fr/api/order` | Page « merci » : récupère la carte d'un paiement |
| `lucile-diet.fr/api/card` | Page publique du QR code (consultation seule) |
| `admin.lucile-diet.fr` | App de Lucile (dossier `admin/`), protégée par Cloudflare Access |

Registre : base D1 `lucile-cartes-cadeaux` (`schema.sql`). E-mails : Resend.
Les pages du site sont dans `../carte-cadeau.html` et `../carte-cadeau/`.

## Développement local

```bash
npm install
npm run db:local        # crée la base locale
npm run dev             # Worker sur http://127.0.0.1:8787 (= app admin, sans connexion en local)
npm run dev:site        # site sur http://localhost:8080, /api relayé vers le Worker
```

`.dev.vars` (non versionné) : `DEV=1`, `CARD_SIGNING_KEY=...`, éventuellement `STRIPE_WEBHOOK_SECRET=...`.
`POST /api/dev/fake-order` simule un paiement (uniquement avec `DEV=1`).

## Mise en production (une seule fois)

1. `npx wrangler login`
2. `npx wrangler d1 create lucile-cartes-cadeaux` → reporter l'id dans `wrangler.jsonc`, puis `npm run db:remote`
3. Secrets (chacun demandé au clavier, jamais écrit dans un fichier) :
   - `npx wrangler secret put CARD_SIGNING_KEY` (longue chaîne aléatoire ; ne jamais la changer ensuite, sinon les QR déjà émis deviennent invalides)
   - `npx wrangler secret put STRIPE_SECRET_KEY` (clé secrète Stripe, `sk_live_...` ou `sk_test_...`)
   - `npx wrangler secret put STRIPE_WEBHOOK_SECRET` (`whsec_...` du webhook créé à l'étape 5)
   - `npx wrangler secret put RESEND_API_KEY`
4. `npm run deploy`
5. Stripe → Développeurs → Webhooks : point de terminaison `https://lucile-diet.fr/api/stripe/webhook`,
   événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
6. Resend : ajouter le domaine `lucile-diet.fr` (enregistrements DNS dans Cloudflare).
7. Cloudflare Zero Trust → Access → Applications : application « self-hosted » sur `admin.lucile-diet.fr`,
   politique « Allow » limitée à `lepocreau.lucile@gmail.com` (connexion par code e-mail).
   Reporter le domaine d'équipe (`xxx.cloudflareaccess.com`) et l'« Application Audience (AUD) » dans `wrangler.jsonc`, puis `npm run deploy`.

## Cache Cloudflare (important)

Une règle de cache garde les `.css`, `.js`, images et polices **1 mois** chez Cloudflare.
Après toute modification d'un de ces fichiers, changer le numéro de version dans son URL
(ex. `carte-cadeau.css?v=2` → `?v=3` dans les pages HTML) ou purger le cache Cloudflare.

## Achats de test

Tant que `STRIPE_SECRET_KEY` est une clé de test, le site public refuse les achats
(la carte 4242 donnerait sinon de vraies cartes cadeaux). Pour tester de bout en bout :
`node dev-site.mjs --prod` puis http://localhost:8080 (jeton `TEST_CHECKOUT_TOKEN` lu dans `.dev.vars`).

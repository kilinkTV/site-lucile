// Envoi des e-mails via Resend (https://resend.com).
import { cardUrl, escapeHtml, euros, frDateLong } from './lib.js';

async function send(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail non envoyé : RESEND_API_KEY absente] à ${to} — ${subject}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, reply_to: env.ADMIN_EMAIL, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`);
  return res.json();
}

function valueLine(card) {
  return card.kind === 'prestation' ? `${card.label} (${card.detail})` : `${euros(card.amount_cents)} à valoir sur un soin de drainage lymphatique`;
}

function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F5EFE6;font-family:Georgia,'Times New Roman',serif;color:#3A2A1E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE6;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FDFAF6;border-radius:14px;overflow:hidden;border:1px solid #D7C5A8">
<tr><td style="background:#5C3D2E;color:#FDFAF6;padding:22px 28px;font-size:20px;font-style:italic">Lucile Le Pocreau <span style="font-style:normal;font-size:13px;color:#D7C5A8">· Drainage lymphatique · Grenoble</span></td></tr>
<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #D7C5A8;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8B6343">16 place Sainte-Claire, 38000 Grenoble · <a href="https://lucile-diet.fr" style="color:#8B6343">lucile-diet.fr</a></td></tr>
</table></td></tr></table></body></html>`;
}

function button(href, label) {
  return `<p style="margin:26px 0;text-align:center"><a href="${escapeHtml(href)}" style="display:inline-block;background:#5C3D2E;color:#FDFAF6;text-decoration:none;padding:13px 28px;border-radius:40px;font-size:14px;letter-spacing:.06em">${escapeHtml(label)}</a></p>`;
}

// E-mail à l'acheteur, avec le lien pour voir et télécharger la carte.
export async function sendCardToBuyer(env, card, to = card.buyer_email) {
  if (!to) return { skipped: true };
  const url = await cardUrl(env, card.code);
  const subject = `Votre carte cadeau pour ${card.recipient_name}`;
  const html = layout(subject, `
<p>Bonjour ${escapeHtml(card.buyer_name)},</p>
<p>Merci pour votre achat ! Voici la carte cadeau pour <strong>${escapeHtml(card.recipient_name)}</strong> :</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F5EFE6;border-radius:10px;margin:8px 0"><tr><td style="padding:16px 18px">
<div style="font-family:Georgia,serif;font-size:18px;color:#5C3D2E">${escapeHtml(valueLine(card))}</div>
<div style="font-size:13px;color:#6b5646;margin-top:6px">Carte n° <strong style="font-family:'Courier New',monospace;letter-spacing:.08em">${card.code}</strong> · valable jusqu'au ${frDateLong(card.expires_at)}</div>
</td></tr></table>
${button(url, 'Voir et télécharger la carte (PDF)')}
<p style="font-size:13px;color:#6b5646">Vous pouvez l'imprimer ou la transférer telle quelle au bénéficiaire. Pour l'utiliser, il suffit de réserver sur Doctolib ou au 07 67 95 57 09 en indiquant le numéro de la carte, puis de la présenter le jour du soin.</p>
<p style="font-size:13px;color:#6b5646">Une question ? Répondez simplement à ce message.</p>
<p>À très bientôt,<br>Lucile</p>`);
  const text = `Bonjour ${card.buyer_name},

Merci pour votre achat ! Voici la carte cadeau pour ${card.recipient_name} :
${valueLine(card)}
Carte n° ${card.code} — valable jusqu'au ${frDateLong(card.expires_at)}

Voir et télécharger la carte (PDF) : ${url}

Pour l'utiliser : réserver sur Doctolib ou au 07 67 95 57 09 en indiquant le numéro de la carte, puis la présenter le jour du soin.

À très bientôt,
Lucile`;
  return send(env, { to, subject, html, text });
}

// Notification à Lucile pour chaque vente en ligne.
export async function notifyAdmin(env, card) {
  const subject = `Nouvelle carte cadeau : ${card.kind === 'prestation' ? card.label : euros(card.amount_cents)}`;
  const admin = `https://${env.ADMIN_HOST}/#/carte/${card.code}`;
  const html = layout(subject, `
<p><strong>Nouvelle carte cadeau vendue sur le site.</strong></p>
<p>${escapeHtml(valueLine(card))} — ${euros(card.amount_cents)}<br>
Pour : <strong>${escapeHtml(card.recipient_name)}</strong><br>
De la part de : ${escapeHtml(card.buyer_name)} (${escapeHtml(card.buyer_email || '')})<br>
Carte n° ${card.code} · valable jusqu'au ${frDateLong(card.expires_at)}</p>
${button(admin, 'Ouvrir dans mon espace')}`);
  const text = `Nouvelle carte cadeau vendue : ${valueLine(card)} — ${euros(card.amount_cents)}
Pour : ${card.recipient_name}
De la part de : ${card.buyer_name} (${card.buyer_email || ''})
Carte n° ${card.code}, valable jusqu'au ${frDateLong(card.expires_at)}
${admin}`;
  return send(env, { to: env.ADMIN_EMAIL, subject, html, text });
}

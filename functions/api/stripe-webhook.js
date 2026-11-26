// Stripe calls this after a studio pays. It makes the studio's unlock code and emails it to the buyer,
// so nobody has to run scripts/make-unlock-code.mjs by hand.
//
// Set up (Cloudflare Pages > Settings > Variables and secrets, and Bindings):
//   STRIPE_WEBHOOK_SECRET  the endpoint's signing secret (whsec_...)
//   UNLOCK_PRIVATE_KEY     the whole contents of keys/private.pem
//   RESEND_API_KEY, MAIL_FROM  for sending (MAIL_FROM on a domain verified in Resend)
//   CONTACT_EMAIL          optional reply-to address for the buyer
//   OWNER_EMAIL            optional: gets a note for every sale, and for any sale it couldn't handle
//   SITE_URL               optional, e.g. https://studiorecap.com (defaults to this site)
//   UNLOCK_SENT            optional KV binding, so Stripe's retries don't send a second email
// On the Stripe payment link, add two custom fields: a text field with key "studioname"
// and a dropdown with key "recapyear" (one option per year you sell).
import { verifyStripeSignature } from '../../server/stripe.js';
import { makeUnlockCode } from '../../server/sign-code.js';
import { sendMail } from '../../server/mail.js';
import { normalizeStudioName } from '../../public/js/lib/unlock.js';

const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

function field(session, key) {
  const f = (session.custom_fields || []).find((x) => x && x.key === key);
  if (!f) return '';
  const v = (f.text && f.text.value) ?? (f.dropdown && f.dropdown.value) ?? (f.numeric && f.numeric.value) ?? '';
  return String(v || '').trim();
}

// The year the studio is buying a recap for. Without the dropdown, January and February sales
// are for the year just ended.
export function recapYear(session, now = new Date()) {
  const y = Number(field(session, 'recapyear'));
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) return y;
  const created = session.created ? new Date(session.created * 1000) : now;
  return created.getUTCMonth() <= 1 ? created.getUTCFullYear() - 1 : created.getUTCFullYear();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function tellOwner(env, subject, text, fetchImpl) {
  if (!env.OWNER_EMAIL) return;
  try { await sendMail(env, { to: env.OWNER_EMAIL, subject, text }, fetchImpl); } catch (e) { console.error('owner note failed', e.message); }
}

export async function handleStripeWebhook(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, { now });
  if (!ok) return json({ error: 'bad signature' }, 400);

  let event;
  try { event = JSON.parse(body); } catch { return json({ error: 'bad body' }, 400); }
  if (!HANDLED.has(event.type)) return json({ ignored: event.type });
  const session = (event.data && event.data.object) || {};
  if (session.payment_status !== 'paid') return json({ ignored: 'not paid yet' });

  const product = env.PRODUCT_NAME || 'Studio Recap';
  const name = field(session, 'studioname').slice(0, 120);
  const year = recapYear(session, new Date(now));
  const email = session.customer_details && session.customer_details.email;
  if (!normalizeStudioName(name) || !email) {
    console.error('sale needs a hand', session.id, { hasName: !!name, hasEmail: !!email });
    await tellOwner(env, `${product}: a sale needs a code by hand`,
      `Stripe checkout ${session.id} was paid, but it had no ${email ? 'studio name' : 'buyer email'}, so no code was sent.\nMake one with: node scripts/make-unlock-code.mjs "Studio Name" ${year}`, fetchImpl);
    return json({ handled: false });
  }

  const doneKey = `sent:${session.id}`;
  if (env.UNLOCK_SENT && (await env.UNLOCK_SENT.get(doneKey))) return json({ duplicate: true });

  if (!env.UNLOCK_PRIVATE_KEY) {
    console.error('UNLOCK_PRIVATE_KEY is not set');
    return json({ error: 'not set up' }, 500); // Stripe retries for up to three days
  }
  const code = await makeUnlockCode(env.UNLOCK_PRIVATE_KEY, name, year);
  const site = (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
  const text = [
    `Thanks for buying ${product} for ${name} (${year}).`,
    '',
    'Your unlock code:',
    code,
    '',
    `To use it, open ${site}/create.html and load your export. In step 3, type your studio name as "${name}" and pick ${year} (spacing, capitals and punctuation don't matter). Then paste the code in step 5. Your links and images will stop saying PREVIEW.`,
    '',
    'Questions? Just reply to this email.',
  ].join('\n');
  try {
    await sendMail(env, { to: email, subject: `Your ${product} unlock code`, text, replyTo: env.CONTACT_EMAIL }, fetchImpl);
  } catch (e) {
    console.error('code email failed', session.id, e.message);
    return json({ error: 'mail failed' }, 502); // Stripe retries
  }
  if (env.UNLOCK_SENT) await env.UNLOCK_SENT.put(doneKey, '1', { expirationTtl: 60 * 60 * 24 * 90 });
  await tellOwner(env, `${product} sale: ${name} (${year})`, `Code sent to ${email} for checkout ${session.id}.`, fetchImpl);
  return json({ handled: true });
}

export async function onRequestPost({ request, env }) {
  return handleStripeWebhook(request, env);
}

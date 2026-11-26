// Stripe calls this after a studio pays. It makes the studio's unlock code and emails it to the buyer,
// so nobody has to run scripts/make-unlock-code.mjs by hand.
//
// Set up (Cloudflare Pages > Settings > Variables and secrets, and Bindings):
//   STRIPE_WEBHOOK_SECRET  the endpoint's signing secret (whsec_...)
//   UNLOCK_PRIVATE_KEY     the whole contents of keys/private.pem
//   RESEND_API_KEY, MAIL_FROM  for sending (MAIL_FROM on a domain verified in Resend)
//   CONTACT_EMAIL          optional reply-to address for the buyer
//   SITE_URL               optional, e.g. https://studiorecap.com (defaults to this site)
//   OWNER_EMAIL            your own address: a note for every sale, and for any sale it couldn't handle
//   UNLOCK_SENT            optional KV binding, so Stripe's retries don't send a second email
//   PAYMENT_LINK_ID        optional (plink_...): only checkouts from this payment link get codes,
//                          so sales of other products on the same Stripe account are left alone
// On the Stripe payment link, add two custom fields: a required text field with key "studioname"
// and a required dropdown with key "recapyear" (one option per year you sell, such as 2026).
import { verifyStripeSignature } from '../../server/stripe.js';
import { makeUnlockCode } from '../../server/sign-code.js';
import { sendMail } from '../../server/mail.js';
import { normalizeStudioName } from '../../public/js/lib/unlock.js';

const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
// 'no_payment_required' is a checkout made free by a 100% promo code.
const PAID = new Set(['paid', 'no_payment_required']);
const MAX_NAME = 120;

function findField(session, key) {
  return (session.custom_fields || []).find((x) => x && x.key === key) || null;
}

function field(session, key) {
  const f = findField(session, key);
  if (!f) return '';
  const v = (f.text && f.text.value) ?? (f.dropdown && f.dropdown.value) ?? (f.numeric && f.numeric.value) ?? '';
  return String(v || '').trim();
}

// Control characters out, runs of spaces collapsed: the name goes into an email.
function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function yearIn(v) {
  const m = String(v || '').match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

// The year the studio is buying a recap for. Without the dropdown, January and February sales
// are for the year just ended.
// Returns { year, guessed }. The dropdown's value is used, or the year in its option label.
export function recapYear(session, now = new Date()) {
  const f = findField(session, 'recapyear');
  let y = yearIn(field(session, 'recapyear'));
  if (!y && f && f.dropdown) {
    const picked = (f.dropdown.options || []).find((o) => o && o.value === f.dropdown.value);
    y = yearIn(picked && picked.label);
  }
  if (y) return { year: y, guessed: false };
  const created = session.created ? new Date(session.created * 1000) : now;
  return { year: created.getUTCMonth() <= 1 ? created.getUTCFullYear() - 1 : created.getUTCFullYear(), guessed: true };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// Best effort: the email has already gone, so a KV failure must not make Stripe retry and resend it.
async function markSent(env, key) {
  if (!env.UNLOCK_SENT) return;
  try { await env.UNLOCK_SENT.put(key, '1', { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) { console.error('could not record sent', key, e.message); }
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
  if (!PAID.has(session.payment_status)) return json({ ignored: 'not paid yet' });
  if (env.PAYMENT_LINK_ID && session.payment_link !== env.PAYMENT_LINK_ID) {
    // Logged so a test-mode id left in PAYMENT_LINK_ID after going live shows up in the logs.
    console.log('checkout from another payment link', session.id, session.payment_link || 'none');
    return json({ ignored: 'another product' });
  }

  const product = env.PRODUCT_NAME || 'Studio Recap';
  const rawName = cleanName(field(session, 'studioname'));
  const { year, guessed } = recapYear(session, new Date(now));
  const email = session.customer_details && session.customer_details.email;
  const problem = !email ? 'no buyer email'
    : !normalizeStudioName(rawName) ? 'no studio name'
      : rawName.length > MAX_NAME ? `a studio name over ${MAX_NAME} characters` : '';
  const doneKey = `sent:${session.id}`;
  if (env.UNLOCK_SENT && (await env.UNLOCK_SENT.get(doneKey))) return json({ duplicate: true });

  if (problem) {
    console.error('sale needs a hand', session.id, problem);
    await tellOwner(env, `${product}: a sale needs a code by hand`,
      `Stripe checkout ${session.id} was paid, but it had ${problem}, so no code was sent.${email ? `\nThe buyer is ${email}; they've been told a code is coming.` : ''}\nMake one with: node scripts/make-unlock-code.mjs "Studio Name" ${year}`, fetchImpl);
    if (email) {
      try {
        await sendMail(env, { to: email, subject: `Your ${product} unlock code is on its way`, replyTo: env.CONTACT_EMAIL,
          text: `Thanks for buying ${product}. ${rawName.length > MAX_NAME ? 'The studio name on your order is too long for a code' : "We couldn't read the studio name from your order"}, so we'll send your unlock code by hand shortly. If you like, reply with your studio name exactly as you'll type it in the tool.` }, fetchImpl);
      } catch (e) { console.error('buyer note failed', e.message); }
    }
    await markSent(env, doneKey);
    return json({ handled: false });
  }
  const name = rawName;

  let code;
  try {
    if (!env.UNLOCK_PRIVATE_KEY) throw new Error('UNLOCK_PRIVATE_KEY is not set');
    code = await makeUnlockCode(env.UNLOCK_PRIVATE_KEY, name, year);
  } catch (e) {
    console.error('could not make code', session.id, e.message);
    await tellOwner(env, `${product}: unlock codes are failing`,
      `Checkout ${session.id} for ${name} (${year}) is paid, but the site couldn't make a code: ${e.message}\nCheck the UNLOCK_PRIVATE_KEY secret. Stripe will retry; or send one by hand with make-unlock-code.mjs.`, fetchImpl);
    return json({ error: 'not set up' }, 500); // Stripe retries for up to three days
  }
  const site = (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
  const text = [
    `Thanks for buying ${product} for ${name} (${year}).`,
    '',
    'Your unlock code:',
    code,
    '',
    `To use it, open ${site}/create.html and load your export. In step 3, type your studio name as "${name}" and pick ${year} (spacing, capitals and punctuation don't matter). Then paste the code in step 5. Your links and images will stop saying PREVIEW.`,
    '',
    `If the studio name is spelled wrong, reply with the right spelling and we'll send a new code, since members see the name on their recaps.`,
    '',
    'Questions? Just reply to this email.',
  ].join('\n');
  try {
    await sendMail(env, { to: email, subject: `Your ${product} unlock code`, text, replyTo: env.CONTACT_EMAIL }, fetchImpl);
  } catch (e) {
    console.error('code email failed', session.id, e.message);
    return json({ error: 'mail failed' }, 502); // Stripe retries
  }
  await markSent(env, doneKey);
  await tellOwner(env, `${product} sale: ${name} (${year})`,
    `Code sent to ${email} for checkout ${session.id}.${guessed ? `\nThe order had no year, so ${year} was assumed. Check with the buyer.` : ''}`, fetchImpl);
  return json({ handled: true });
}

export async function onRequestPost({ request, env }) {
  return handleStripeWebhook(request, env);
}

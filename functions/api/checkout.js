// Starts a Stripe Checkout for one studio-year. The owner has already given a studio name,
// a year and an email; Stripe hosts the card form. The webhook emails the unlock code.
//
// STRIPE_SECRET_KEY   secret key (sk_test_... or sk_live_...). Never sent to the browser or written to logs.
// STRIPE_PRICE_ID     price_... for the $149 one-time price
// SITE_URL            optional, e.g. https://studiorecap.com (defaults to this request's origin)
import { normalizeStudioName } from '../../public/js/lib/unlock.js';

const MAX_BODY = 8192; // 8kb
const MAX_NAME = 120;
const MAX_EMAIL = 200;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// Same characters the webhook strips: the name is stored on the Checkout Session and later emailed.
function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Reads at most `max` bytes, so a huge body is refused without being read whole.
async function readCapped(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

function siteBase(env, request) {
  const configured = typeof env.SITE_URL === 'string' ? env.SITE_URL.trim() : '';
  return (configured || new URL(request.url).origin).replace(/\/+$/, '');
}

// Integer 2000 through 2100. A numeric string is accepted so a form field can send "2026".
function parseYear(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

function validEmail(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_EMAIL && !/\s/.test(v) && v.split('@').length === 2;
}

export async function handleCheckout(request, env, { fetchImpl = fetch } = {}) {
  const declared = request.headers.get('content-length');
  if (declared != null && declared !== '' && Number(declared) > MAX_BODY) return json({ error: 'too big' }, 400);
  const raw = await readCapped(request, MAX_BODY);
  if (raw === null) return json({ error: 'too big' }, 400);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad body' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad body' }, 400);

  const name = typeof body.studioName === 'string' ? cleanName(body.studioName) : '';
  if (!name || name.length > MAX_NAME || !normalizeStudioName(name)) return json({ error: 'bad studio name' }, 400);
  const year = parseYear(body.year);
  if (year == null || year < 2000 || year > 2100) return json({ error: 'bad year' }, 400);
  if (!validEmail(body.email)) return json({ error: 'bad email' }, 400);
  // Checked after the body is valid, and never sent anywhere but Stripe's Authorization header.
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) return json({ error: 'not set up' }, 500);

  const studioKey = normalizeStudioName(name);
  const site = siteBase(env, request);
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('customer_email', body.email);
  params.set('client_reference_id', `${studioKey}:${year}`);
  params.set('metadata[studio_name]', name);
  params.set('metadata[year]', String(year));
  params.set('metadata[studio_key]', studioKey);
  params.set('success_url', `${site}/create.html?checkout=success`);
  params.set('cancel_url', `${site}/create.html?checkout=cancel`);
  params.set('allow_promotion_codes', 'true');

  let res;
  try {
    res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch {
    console.error('checkout failed');
    return json({ error: 'checkout failed' }, 502);
  }
  if (!res.ok) {
    console.error('checkout failed', res.status);
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return json({ error: 'checkout failed' }, 502);
  }
  let data;
  try { data = await res.json(); } catch { return json({ error: 'checkout failed' }, 502); }
  if (!data || typeof data.url !== 'string' || !data.url) return json({ error: 'checkout failed' }, 502);
  return json({ url: data.url });
}

export async function onRequestPost({ request, env }) {
  return handleCheckout(request, env);
}

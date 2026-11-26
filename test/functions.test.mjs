import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handleStripeWebhook, recapYear } from '../functions/api/stripe-webhook.js';
import { handleCheckout } from '../functions/api/checkout.js';
import { handleClientError } from '../functions/api/client-error.js';
import { signPayload, verifyStripeSignature } from '../server/stripe.js';
import { makeUnlockCode } from '../server/sign-code.js';
import { normalizeStudioName, verifyUnlock } from '../public/js/lib/unlock.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'jwk' }).x;
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SECRET = 'whsec_test';
const NOW = Date.UTC(2026, 11, 3, 18, 0, 0);

function kv() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, m };
}

function env(extra = {}) {
  return { STRIPE_WEBHOOK_SECRET: SECRET, UNLOCK_PRIVATE_KEY: PEM, RESEND_API_KEY: 're_test', MAIL_FROM: 'Studio Recap <codes@example.com>', CONTACT_EMAIL: 'help@example.com', SITE_URL: 'https://recap.example.com/', ...extra };
}

function session(over = {}) {
  return {
    id: 'cs_test_1', payment_status: 'paid', created: NOW / 1000,
    customer_details: { email: 'owner@studio.example' },
    custom_fields: [
      { key: 'studioname', type: 'text', text: { value: '  Juniper Yoga + Pilates ' } },
      { key: 'recapyear', type: 'dropdown', dropdown: { value: '2026' } },
    ],
    ...over,
  };
}

async function signedRequest(event, { secret = SECRET, t = Math.floor(NOW / 1000) } = {}) {
  const body = JSON.stringify(event);
  const sig = await signPayload(secret, t, body);
  return new Request('https://recap.example.com/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
}

function mailer(status = 200) {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response('{}', { status }); };
  return { sent, fetchImpl };
}

const paid = (s = session()) => ({ type: 'checkout.session.completed', data: { object: s } });

test('stripe signature: right secret and fresh time pass, anything else fails', async () => {
  const t = Math.floor(NOW / 1000);
  const sig = await signPayload(SECRET, t, 'body');
  assert.equal(await verifyStripeSignature('body', `t=${t},v1=${sig}`, SECRET, { now: NOW }), true);
  assert.equal(await verifyStripeSignature('body2', `t=${t},v1=${sig}`, SECRET, { now: NOW }), false);
  assert.equal(await verifyStripeSignature('body', `t=${t},v1=${sig}`, 'other', { now: NOW }), false);
  assert.equal(await verifyStripeSignature('body', `t=${t},v1=${sig}`, SECRET, { now: NOW + 600_000 }), false);
  assert.equal(await verifyStripeSignature('body', `t=${t},v0=${sig}`, SECRET, { now: NOW }), false);
  assert.equal(await verifyStripeSignature('body', '', SECRET, { now: NOW }), false);
  assert.equal(await verifyStripeSignature('body', `t=${t},v1=${sig}`, '', { now: NOW }), false);
});

test('webhook: a paid checkout emails a code that unlocks that studio and year', async () => {
  const { sent, fetchImpl } = mailer();
  const store = kv();
  const res = await handleStripeWebhook(await signedRequest(paid()), env({ UNLOCK_SENT: store }), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.url, 'https://api.resend.com/emails');
  assert.equal(mail.auth, 'Bearer re_test');
  assert.deepEqual(mail.body.to, ['owner@studio.example']);
  assert.equal(mail.body.reply_to, 'help@example.com');
  assert.match(mail.body.text, /https:\/\/recap\.example\.com\/create\.html/);
  const code = mail.body.text.split('\n')[3];
  assert.equal(await verifyUnlock(code, 'juniper yoga pilates', 2026, PUB), true);
  assert.equal(await verifyUnlock(code, 'juniper yoga pilates', 2025, PUB), false);
  // Stripe's retry of the same checkout sends nothing new.
  const again = await handleStripeWebhook(await signedRequest(paid()), env({ UNLOCK_SENT: store }), { fetchImpl, now: NOW });
  assert.equal(again.status, 200);
  assert.equal(sent.length, 1);
});

test('webhook: the server-made code matches the command-line one', async () => {
  const { sign } = await import('node:crypto');
  const { unlockMessage } = await import('../public/js/lib/unlock.js');
  const cli = sign(null, Buffer.from(unlockMessage('Any Studio', 2026)), privateKey).toString('base64url');
  assert.equal(await makeUnlockCode(PEM, 'any studio', 2026), cli);
});

test('webhook: bad signatures, other events and unpaid checkouts send nothing', async () => {
  const { sent, fetchImpl } = mailer();
  const bad = await handleStripeWebhook(await signedRequest(paid(), { secret: 'wrong' }), env(), { fetchImpl, now: NOW });
  assert.equal(bad.status, 400);
  const other = await handleStripeWebhook(await signedRequest({ type: 'charge.refunded', data: { object: {} } }), env(), { fetchImpl, now: NOW });
  assert.equal(other.status, 200);
  const unpaid = await handleStripeWebhook(await signedRequest(paid(session({ payment_status: 'unpaid' }))), env(), { fetchImpl, now: NOW });
  assert.equal(unpaid.status, 200);
  assert.equal(sent.length, 0);
});

test('webhook: a sale with no studio name goes to the owner instead', async () => {
  const { sent, fetchImpl } = mailer();
  const s = session({ custom_fields: [] });
  const res = await handleStripeWebhook(await signedRequest(paid(s)), env({ OWNER_EMAIL: 'me@example.com' }), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body.to, ['me@example.com']);
  assert.match(sent[0].body.text, /make-unlock-code/);
  assert.deepEqual(sent[1].body.to, ['owner@studio.example']);
  assert.match(sent[1].body.text, /by hand/);
  assert.doesNotMatch(sent[1].body.text, /[A-Za-z0-9_-]{86}/);
});

test('webhook: free checkouts and delayed payments get codes too', async () => {
  for (const ev of [paid(session({ payment_status: 'no_payment_required' })), { type: 'checkout.session.async_payment_succeeded', data: { object: session() } }]) {
    const { sent, fetchImpl } = mailer();
    const res = await handleStripeWebhook(await signedRequest(ev), env(), { fetchImpl, now: NOW });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.subject, /unlock code/);
  }
});

test('webhook: only the configured payment link gets codes', async () => {
  const { sent, fetchImpl } = mailer();
  const other = await handleStripeWebhook(await signedRequest(paid(session({ payment_link: 'plink_other' }))), env({ PAYMENT_LINK_ID: 'plink_recap' }), { fetchImpl, now: NOW });
  assert.equal(other.status, 200);
  assert.equal(sent.length, 0);
  await handleStripeWebhook(await signedRequest(paid(session({ payment_link: 'plink_recap' }))), env({ PAYMENT_LINK_ID: 'plink_recap' }), { fetchImpl, now: NOW });
  assert.equal(sent.length, 1);
});

test('webhook: a missing or broken key tells the owner and asks Stripe to retry', async () => {
  for (const key of ['', 'not a key']) {
    const { sent, fetchImpl } = mailer();
    const res = await handleStripeWebhook(await signedRequest(paid()), env({ UNLOCK_PRIVATE_KEY: key, OWNER_EMAIL: 'me@example.com' }), { fetchImpl, now: NOW });
    assert.equal(res.status, 500);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.to, ['me@example.com']);
  }
});

test('webhook: a key pasted with literal \\n still works', async () => {
  const oneLine = PEM.trim().replace(/\n/g, '\\n');
  assert.equal(await makeUnlockCode(oneLine, 'Any Studio', 2026), await makeUnlockCode(PEM, 'Any Studio', 2026));
});

test('webhook: overlong names go to the owner, control characters are dropped', async () => {
  const long = mailer();
  await handleStripeWebhook(await signedRequest(paid(session({ custom_fields: [{ key: 'studioname', type: 'text', text: { value: 'x'.repeat(130) } }] }))), env({ OWNER_EMAIL: 'me@example.com' }), { fetchImpl: long.fetchImpl, now: NOW });
  assert.match(long.sent[0].body.text, /over 120/);
  const ctrl = mailer();
  await handleStripeWebhook(await signedRequest(paid(session({ custom_fields: [{ key: 'studioname', type: 'text', text: { value: 'Core\r\nStudio' } }, { key: 'recapyear', type: 'dropdown', dropdown: { value: '2026' } }] }))), env(), { fetchImpl: ctrl.fetchImpl, now: NOW });
  assert.match(ctrl.sent[0].body.text, /for Core Studio \(2026\)/);
});

test('webhook: mail failure asks Stripe to retry and is not marked sent', async () => {
  const { fetchImpl } = mailer(500);
  const store = kv();
  const res = await handleStripeWebhook(await signedRequest(paid()), env({ UNLOCK_SENT: store }), { fetchImpl, now: NOW });
  assert.equal(res.status, 502);
  assert.equal(store.m.size, 0);
});

test('webhook: year comes from the dropdown, its label, or the sale date', () => {
  const noYear = (iso) => recapYear({ custom_fields: [], created: Date.parse(iso) / 1000 });
  assert.deepEqual(noYear('2027-01-15T00:00:00Z'), { year: 2026, guessed: true });
  assert.equal(noYear('2027-02-28T00:00:00Z').year, 2026);
  assert.equal(noYear('2026-12-01T00:00:00Z').year, 2026);
  assert.deepEqual(recapYear(session()), { year: 2026, guessed: false });
  const byLabel = { custom_fields: [{ key: 'recapyear', type: 'dropdown', dropdown: { value: 'thisyear', options: [{ value: 'thisyear', label: 'Recap for 2026' }] } }] };
  assert.deepEqual(recapYear(byLabel), { year: 2026, guessed: false });
});

test('client errors: logged without extra fields, oversize refused', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const ok = await handleClientError(new Request('https://x/api/client-error', { method: 'POST', body: JSON.stringify({ page: '/r.html', message: 'boom\nline', line: 3, hash: '#secret' }) }));
    assert.equal(ok.status, 204);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /boom line/);
    assert.doesNotMatch(logged[0], /secret/);
    const store = kv();
    await handleClientError(new Request('https://x/api/client-error', { method: 'POST', body: JSON.stringify({ page: '/', message: 'kept' }) }), { CLIENT_ERRORS: store, KEEP_ALL_ERRORS: '1' });
    assert.equal(store.m.size, 1);
    assert.match([...store.m.values()][0], /kept/);
    const big = await handleClientError(new Request('https://x/api/client-error', { method: 'POST', body: 'x'.repeat(5000) }));
    assert.equal(big.status, 413);
    const junk = await handleClientError(new Request('https://x/api/client-error', { method: 'POST', body: 'not json' }));
    assert.equal(junk.status, 400);
  } finally {
    console.error = orig;
  }
});

test('webhook: a redelivered needs-a-hand event sends no second notes, and a KV failure after sending is not retried', async () => {
  const { sent, fetchImpl } = mailer();
  const store = kv();
  const ev = paid(session({ custom_fields: [] }));
  await handleStripeWebhook(await signedRequest(ev), env({ UNLOCK_SENT: store, OWNER_EMAIL: 'me@example.com' }), { fetchImpl, now: NOW });
  const n = sent.length;
  await handleStripeWebhook(await signedRequest(ev), env({ UNLOCK_SENT: store, OWNER_EMAIL: 'me@example.com' }), { fetchImpl, now: NOW });
  assert.equal(sent.length, n);
  const broken = { get: async () => null, put: async () => { throw new Error('quota'); } };
  const m2 = mailer();
  const res = await handleStripeWebhook(await signedRequest(paid()), env({ UNLOCK_SENT: broken }), { fetchImpl: m2.fetchImpl, now: NOW });
  assert.equal(res.status, 200);
});

const PRICE = 'price_test_example';
const STRIPE_KEY = 'sk_test_example';

function checkoutEnv(extra = {}) {
  return { STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_PRICE_ID: PRICE, SITE_URL: 'https://recap.example.com/', ...extra };
}

function checkoutRequest(body, url = 'https://recap.example.com/api/checkout') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
}

function purchaseDb() {
  const rows = [];
  const calls = [];
  return {
    rows,
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              calls.push({ sql, args });
              const id = args[0];
              if (/on conflict\s*\(\s*id\s*\)\s*do nothing/i.test(sql) && rows.some((r) => r.id === id)) return { meta: { changes: 0 } };
              rows.push({ id: args[0], user_email: args[1], studio_name: args[2], studio_key: args[3], year: args[4], created_at: args[5] });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

test('checkout: a bad email, a bad year, or a missing secret never calls Stripe', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return new Response('{}', { status: 200 }); };
  const good = { studioName: 'Juniper Yoga', year: 2026, email: 'owner@studio.example' };
  const cases = [
    [{ ...good, email: 'not-an-email' }, 400],
    [{ ...good, email: 'owner studio@example.com' }, 400],
    [{ ...good, email: 'a@b@c.com' }, 400],
    [{ ...good, email: `${'a'.repeat(190)}@example.com` }, 400],
    [{ ...good, year: 1999 }, 400],
    [{ ...good, year: 2101 }, 400],
    [{ ...good, year: 2026.5 }, 400],
    [{ ...good, year: 'nope' }, 400],
    [{ ...good, studioName: '!!!' }, 400],
    [{ ...good, studioName: 'x'.repeat(121) }, 400],
  ];
  for (const [body, status] of cases) {
    const res = await handleCheckout(checkoutRequest(body), checkoutEnv(), { fetchImpl });
    assert.equal(res.status, status);
    const payload = await res.json();
    assert.equal(typeof payload.error, 'string');
    assert.ok(payload.error);
  }
  const noKey = await handleCheckout(checkoutRequest(good), checkoutEnv({ STRIPE_SECRET_KEY: '' }), { fetchImpl });
  assert.equal(noKey.status, 500);
  assert.deepEqual(await noKey.json(), { error: 'not set up' });
  const noPrice = await handleCheckout(checkoutRequest(good), checkoutEnv({ STRIPE_PRICE_ID: undefined }), { fetchImpl });
  assert.equal(noPrice.status, 500);
  assert.deepEqual(await noPrice.json(), { error: 'not set up' });
  const junk = await handleCheckout(checkoutRequest('not json'), checkoutEnv(), { fetchImpl });
  assert.equal(junk.status, 400);
  const big = await handleCheckout(checkoutRequest({ ...good, pad: 'x'.repeat(9000) }), checkoutEnv(), { fetchImpl });
  assert.equal(big.status, 400);
  assert.equal(calls.length, 0);
});

test('checkout: posts a urlencoded session and returns the url', async () => {
  const logged = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = (...a) => logged.push(a.join(' '));
  console.log = (...a) => logged.push(a.join(' '));
  try {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: 'cs_123', url: 'https://checkout.stripe.com/c/pay/cs_123', client_secret: STRIPE_KEY }), { status: 200 });
    };
    const res = await handleCheckout(checkoutRequest({ studioName: '  Juniper Yoga + Pilates\n', year: 2026, email: 'owner@studio.example' }), checkoutEnv(), { fetchImpl });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.deepEqual(payload, { url: 'https://checkout.stripe.com/c/pay/cs_123' });
    assert.doesNotMatch(JSON.stringify(payload), /sk_test/);
    assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.Authorization, `Bearer ${STRIPE_KEY}`);
    assert.equal(captured.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(captured.init.body);
    assert.equal(params.get('mode'), 'payment');
    assert.equal(params.get('line_items[0][price]'), PRICE);
    assert.equal(params.get('line_items[0][quantity]'), '1');
    assert.equal(params.get('customer_email'), 'owner@studio.example');
    assert.equal(params.get('client_reference_id'), `${normalizeStudioName('Juniper Yoga + Pilates')}:2026`);
    assert.equal(params.get('metadata[studio_name]'), 'Juniper Yoga + Pilates');
    assert.equal(params.get('metadata[year]'), '2026');
    assert.equal(params.get('metadata[studio_key]'), normalizeStudioName('Juniper Yoga + Pilates'));
    assert.equal(params.get('success_url'), 'https://recap.example.com/create.html?checkout=success');
    assert.equal(params.get('cancel_url'), 'https://recap.example.com/create.html?checkout=cancel');
    assert.equal(params.get('allow_promotion_codes'), 'true');
    assert.match(captured.init.body, /%5B|mode=payment/);

    const originFetch = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_origin' }), { status: 200 });
    };
    const fromOrigin = await handleCheckout(
      checkoutRequest({ studioName: 'Core\r\nStudio', year: 2100, email: 'a@b.co' }, 'https://studio.example/api/checkout'),
      checkoutEnv({ SITE_URL: '' }),
      { fetchImpl: originFetch },
    );
    assert.equal(fromOrigin.status, 200);
    const originParams = new URLSearchParams(captured.init.body);
    assert.equal(originParams.get('metadata[studio_name]'), 'Core Studio');
    assert.equal(originParams.get('success_url'), 'https://studio.example/create.html?checkout=success');
    assert.equal(originParams.get('cancel_url'), 'https://studio.example/create.html?checkout=cancel');
    assert.equal(originParams.get('client_reference_id'), 'corestudio:2100');

    const failed = await handleCheckout(checkoutRequest({ studioName: 'Juniper', year: 2000, email: 'a@b.co' }), checkoutEnv(), {
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'no such price', key: STRIPE_KEY, email: 'a@b.co' } }), { status: 400 }),
    });
    assert.equal(failed.status, 502);
    const failedBody = await failed.text();
    assert.deepEqual(JSON.parse(failedBody), { error: 'checkout failed' });
    assert.doesNotMatch(failedBody, /sk_test|a@b\.co|no such price/);
    const thrown = await handleCheckout(checkoutRequest({ studioName: 'Juniper', year: 2000, email: 'a@b.co' }), checkoutEnv(), {
      fetchImpl: async () => { throw new Error(`network ${STRIPE_KEY} a@b.co`); },
    });
    assert.equal(thrown.status, 502);
    assert.deepEqual(await thrown.json(), { error: 'checkout failed' });
    const notes = logged.join('\n');
    assert.doesNotMatch(notes, /sk_test_example/);
    assert.doesNotMatch(notes, /a@b\.co/);
    assert.match(notes, /checkout failed/);
  } finally {
    console.error = origError;
    console.log = origLog;
  }
});

test('webhook: a paid checkout records one purchase, and a second delivery does not add another', async () => {
  const db = purchaseDb();
  const { fetchImpl } = mailer();
  const res = await handleStripeWebhook(await signedRequest(paid()), env({ DB: db }), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { handled: true });
  assert.equal(db.rows.length, 1);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql, `INSERT INTO purchases (id, user_email, studio_name, studio_key, year, status, created_at)
VALUES (?, ?, ?, ?, ?, 'paid', ?)
ON CONFLICT(id) DO NOTHING`);
  assert.deepEqual(db.rows[0], {
    id: 'cs_test_1',
    user_email: 'owner@studio.example',
    studio_name: 'Juniper Yoga + Pilates',
    studio_key: 'juniperyogapilates',
    year: 2026,
    created_at: '2026-12-03T18:00:00.000Z',
  });
  const again = await handleStripeWebhook(await signedRequest(paid()), env({ DB: db }), { fetchImpl, now: NOW });
  assert.equal(again.status, 200);
  assert.equal(db.calls.length, 2);
  assert.equal(db.rows.length, 1);

  const quiet = purchaseDb();
  const notes = mailer();
  await handleStripeWebhook(await signedRequest(paid(session({ custom_fields: [] }))), env({ DB: quiet, OWNER_EMAIL: 'me@example.com' }), { fetchImpl: notes.fetchImpl, now: NOW });
  await handleStripeWebhook(await signedRequest(paid(session({ customer_details: {} }))), env({ DB: quiet, OWNER_EMAIL: 'me@example.com' }), { fetchImpl: notes.fetchImpl, now: NOW });
  assert.equal(quiet.calls.length, 0);

  const down = { prepare() { return { bind() { return { async run() { throw new Error('d1 down'); } }; } }; } };
  const mailed = mailer();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const kept = await handleStripeWebhook(await signedRequest(paid()), env({ DB: down }), { fetchImpl: mailed.fetchImpl, now: NOW });
    assert.equal(kept.status, 200);
    assert.deepEqual(await kept.json(), { handled: true });
    assert.equal(mailed.sent.length, 1);
    assert.match(logged.join('\n'), /could not record purchase/);
    assert.doesNotMatch(logged.join('\n'), /owner@studio\.example/);
  } finally {
    console.error = orig;
  }

  const unsent = purchaseDb();
  const bounced = mailer(500);
  const retry = await handleStripeWebhook(await signedRequest(paid()), env({ DB: unsent }), { fetchImpl: bounced.fetchImpl, now: NOW });
  assert.equal(retry.status, 502);
  assert.equal(unsent.calls.length, 0);
});

test('webhook: metadata studio name, year and key win over payment-link fields', async () => {
  const db = purchaseDb();
  const { sent, fetchImpl } = mailer();
  const s = session({
    id: 'cs_meta',
    metadata: { studio_name: '  North\nStudio ', year: '2025', studio_key: 'northstudio' },
  });
  const res = await handleStripeWebhook(await signedRequest(paid(s)), env({ DB: db, PAYMENT_LINK_ID: 'plink_recap' }), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.match(sent[0].body.text, /for North Studio \(2025\)/);
  assert.doesNotMatch(sent[0].body.text, /Juniper/);
  const code = sent[0].body.text.split('\n')[3];
  assert.equal(await verifyUnlock(code, 'north studio', 2025, PUB), true);
  assert.equal(await verifyUnlock(code, 'juniper yoga pilates', 2026, PUB), false);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].studio_name, 'North Studio');
  assert.equal(db.rows[0].studio_key, 'northstudio');
  assert.equal(db.rows[0].year, 2025);
  assert.deepEqual(recapYear(s), { year: 2025, guessed: false });

  const onlyMeta = session({
    id: 'cs_meta_only',
    custom_fields: [],
    metadata: { studio_name: 'Only Meta', year: 2100, studio_key: 'onlymeta' },
  });
  const second = mailer();
  await handleStripeWebhook(await signedRequest(paid(onlyMeta)), env({ DB: db }), { fetchImpl: second.fetchImpl, now: NOW });
  assert.match(second.sent[0].body.text, /for Only Meta \(2100\)/);
  assert.equal(db.rows[1].studio_key, 'onlymeta');
  assert.equal(db.rows[1].year, 2100);
});

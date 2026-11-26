import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLogin, handleLoginVerify, onRequestGet, onRequestPost } from '../functions/api/login.js';
import { handleMe, onRequestGet as onRequestMe } from '../functions/api/me.js';

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);

function memoryDb() {
  const tables = { users: [], login_tokens: [], sessions: [], purchases: [] };

  function query(sql, args) {
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (q === 'insert into login_tokens (token_hash, email, expires_at) values (?, ?, ?)') {
      tables.login_tokens.push({ token_hash: args[0], email: args[1], expires_at: args[2], used_at: null });
      return { changes: 1 };
    }
    if (q === 'delete from login_tokens where token_hash = ?') {
      const before = tables.login_tokens.length;
      tables.login_tokens = tables.login_tokens.filter((r) => r.token_hash !== args[0]);
      return { changes: before - tables.login_tokens.length };
    }
    if (q === 'select token_hash from login_tokens where email = ? and used_at is null and expires_at > ?') {
      return tables.login_tokens.filter((r) => r.email === args[0] && r.used_at == null && r.expires_at > args[1]);
    }
    if (q === 'select email from login_tokens where token_hash = ? and used_at is null and expires_at > ?') {
      return tables.login_tokens.filter((r) => r.token_hash === args[0] && r.used_at == null && r.expires_at > args[1]);
    }
    if (q === 'update login_tokens set used_at = ? where token_hash = ? and used_at is null') {
      const row = tables.login_tokens.find((r) => r.token_hash === args[1] && r.used_at == null);
      if (!row) return { changes: 0 };
      row.used_at = args[0];
      return { changes: 1 };
    }
    if (q === 'select id from users where email = ?') {
      return tables.users.filter((r) => r.email === args[0]);
    }
    if (q === 'insert into users (id, email, created_at) values (?, ?, ?)') {
      tables.users.push({ id: args[0], email: args[1], created_at: args[2] });
      return { changes: 1 };
    }
    if (q === 'insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)') {
      tables.sessions.push({ token_hash: args[0], user_id: args[1], expires_at: args[2] });
      return { changes: 1 };
    }
    if (q === 'select user_id from sessions where token_hash = ? and expires_at > ?') {
      return tables.sessions.filter((r) => r.token_hash === args[0] && r.expires_at > args[1]);
    }
    if (q === 'select email from users where id = ?') {
      return tables.users.filter((r) => r.id === args[0]);
    }
    if (q === 'select studio_name, studio_key, year, status from purchases where lower(user_email) = ?') {
      const want = String(args[0]).toLowerCase();
      return tables.purchases
        .filter((r) => String(r.user_email).toLowerCase() === want)
        .map((r) => ({ studio_name: r.studio_name, studio_key: r.studio_key, year: r.year, status: r.status }));
    }
    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    tables,
    prepare(sql) {
      return {
        bind(...args) {
          const exec = (mode) => {
            const result = query(sql, args);
            if (mode === 'run') return { success: true, meta: { changes: result.changes || 0 } };
            if (mode === 'first') return Array.isArray(result) ? (result[0] || null) : null;
            return { success: true, results: Array.isArray(result) ? result : [] };
          };
          return {
            run: async () => exec('run'),
            first: async () => exec('first'),
            all: async () => exec('all'),
          };
        },
      };
    },
  };
}

function env(db, extra = {}) {
  return {
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'Studio Recap <codes@example.com>',
    SITE_URL: 'https://recap.example.com/',
    DB: db,
    ...extra,
  };
}

function mailer(status = 200) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status });
  };
  return { sent, fetchImpl };
}

function post(email) {
  return new Request('https://recap.example.com/api/login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function linkFrom(sent) {
  const match = sent[0].body.text.match(/https?:\/\/\S+/);
  assert.ok(match, 'mail includes a link');
  return match[0];
}

test('login: a bad email does not send', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  const bad = ['', 'owner', 'a b@studio.com', 'a@b@c.com', 'a@', '@studio.com', `${'a'.repeat(199)}@b.com`, 12, null];
  for (const email of bad) {
    const res = await handleLogin(post(email), env(db), { fetchImpl, now: NOW });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'bad email' });
  }
  const junk = await handleLogin(new Request('https://recap.example.com/api/login', { method: 'POST', body: 'not json' }), env(db), { fetchImpl, now: NOW });
  assert.equal(junk.status, 400);
  const big = await handleLogin(new Request('https://recap.example.com/api/login', { method: 'POST', body: 'x'.repeat(5000) }), env(db), { fetchImpl, now: NOW });
  assert.equal(big.status, 413);
  assert.equal(sent.length, 0);
  assert.equal(db.tables.login_tokens.length, 0);
});

test('login: a valid email stores a hash and the link carries the raw token', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  const res = await handleLogin(post('  Owner@Studio.Example '), env(db), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['owner@studio.example']);
  assert.match(sent[0].body.subject, /Sign in to Studio Recap/);
  assert.match(sent[0].body.text, /sign in to Studio Recap/i);
  assert.match(sent[0].body.text, /15 minutes/);
  const link = linkFrom(sent);
  const token = new URL(link).searchParams.get('token');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(link, `https://recap.example.com/api/login?token=${token}`);
  assert.equal(db.tables.login_tokens.length, 1);
  const row = db.tables.login_tokens[0];
  assert.equal(row.email, 'owner@studio.example');
  assert.equal(row.used_at, null);
  assert.equal(Date.parse(row.expires_at) - NOW, 15 * 60 * 1000);
  assert.equal(row.token_hash, await sha256Hex(token));
  assert.notEqual(row.token_hash, token);
  assert.equal(JSON.stringify(db.tables).includes(token), false);
});

test('login: a second request inside the quiet window does not send again', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  const opts = { fetchImpl, now: NOW };
  const first = await handleLogin(post('owner@studio.example'), env(db), opts);
  assert.equal(first.status, 200);
  const again = await handleLogin(post(' OWNER@studio.example '), env(db), { fetchImpl, now: NOW + 30_000 });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(db.tables.login_tokens.length, 1);
  // At 60 seconds the first token no longer has more than 14 minutes left, so a new mail goes out.
  const later = await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW + 60_000 });
  assert.equal(later.status, 200);
  assert.equal(sent.length, 2);
});

test('login: missing mail or database does not send', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  for (const extra of [{ RESEND_API_KEY: '' }, { MAIL_FROM: '' }, { DB: null }]) {
    const res = await handleLogin(post('owner@studio.example'), env(db, extra), { fetchImpl, now: NOW });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'not set up' });
  }
  assert.equal(sent.length, 0);
  assert.equal(db.tables.login_tokens.length, 0);
});

test('login: a mail failure returns 502 and drops the unused token', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer(500);
  const logs = [];
  const orig = console.error;
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const res = await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'mail failed' });
  } finally {
    console.error = orig;
  }
  assert.equal(sent.length, 1);
  const token = new URL(linkFrom(sent)).searchParams.get('token');
  assert.equal(db.tables.login_tokens.length, 0);
  assert.equal(logs.some((line) => line.includes(token)), false);
  const { sent: retrySent, fetchImpl: retryFetch } = mailer();
  const retry = await handleLogin(post('owner@studio.example'), env(db), { fetchImpl: retryFetch, now: NOW });
  assert.equal(retry.status, 200);
  assert.equal(retrySent.length, 1);
});

test('verify: a good token sets the cookie and a second use fails', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW });
  const token = new URL(linkFrom(sent)).searchParams.get('token');
  const res = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${token}`), env(db), { now: NOW });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/create.html');
  const cookie = res.headers.get('Set-Cookie');
  const match = cookie.match(/^sr_session=([^;]+); HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  assert.ok(match, cookie);
  const session = match[1];
  assert.match(session, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.tables.users.length, 1);
  assert.equal(db.tables.users[0].email, 'owner@studio.example');
  assert.match(db.tables.users[0].id, /^[0-9a-f-]{36}$/i);
  assert.equal(db.tables.sessions.length, 1);
  assert.equal(db.tables.sessions[0].user_id, db.tables.users[0].id);
  assert.equal(db.tables.sessions[0].token_hash, await sha256Hex(session));
  assert.notEqual(db.tables.sessions[0].token_hash, session);
  assert.equal(Date.parse(db.tables.sessions[0].expires_at) - NOW, 30 * 24 * 60 * 60 * 1000);
  assert.ok(db.tables.login_tokens[0].used_at);

  const again = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${token}`), env(db), { now: NOW + 1000 });
  assert.equal(again.status, 400);
  assert.equal(await again.text(), 'This sign-in link has expired.');
  assert.equal(again.headers.get('Set-Cookie'), null);
  assert.equal(db.tables.sessions.length, 1);
  assert.equal(db.tables.users.length, 1);

  const stale = await handleLoginVerify(new Request('https://recap.example.com/api/login?token=not-a-real-token'), env(db), { now: NOW });
  assert.equal(stale.status, 400);
  assert.equal(stale.headers.get('Set-Cookie'), null);
});

test('me: returns the email and that email\'s purchases, and 401 without a cookie', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW });
  const token = new URL(linkFrom(sent)).searchParams.get('token');
  const verified = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${token}`), env(db), { now: NOW });
  const session = verified.headers.get('Set-Cookie').match(/^sr_session=([^;]+)/)[1];
  db.tables.purchases.push(
    { id: 'pur_1', user_email: 'Owner@Studio.Example', studio_name: 'Juniper Yoga', studio_key: 'juniper yoga', year: 2026, status: 'paid', created_at: new Date(NOW).toISOString() },
    { id: 'pur_2', user_email: 'other@studio.example', studio_name: 'Other', studio_key: 'other', year: 2025, status: 'paid', created_at: new Date(NOW).toISOString() },
  );
  const res = await handleMe(new Request('https://recap.example.com/api/me', { headers: { cookie: `theme=light; sr_session=${session}` } }), env(db), { now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    email: 'owner@studio.example',
    purchases: [{ studio_name: 'Juniper Yoga', studio_key: 'juniper yoga', year: 2026, status: 'paid' }],
  });
  const anon = await handleMe(new Request('https://recap.example.com/api/me'), env(db), { now: NOW });
  assert.equal(anon.status, 401);
  assert.deepEqual(await anon.json(), { error: 'signed out' });
  const wrong = await handleMe(new Request('https://recap.example.com/api/me', { headers: { cookie: 'sr_session=nope' } }), env(db), { now: NOW });
  assert.equal(wrong.status, 401);

  db.tables.sessions[0].expires_at = new Date(NOW - 1000).toISOString();
  const expired = await handleMe(new Request('https://recap.example.com/api/me', { headers: { cookie: `sr_session=${session}` } }), env(db), { now: NOW });
  assert.equal(expired.status, 401);
});

test('verify: an expired link sets no cookie and does not create a user', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW });
  const token = new URL(linkFrom(sent)).searchParams.get('token');
  const res = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${token}`), env(db), { now: NOW + 15 * 60 * 1000 });
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'This sign-in link has expired.');
  assert.equal(res.headers.get('Set-Cookie'), null);
  assert.equal(db.tables.users.length, 0);
  assert.equal(db.tables.sessions.length, 0);
  assert.equal(db.tables.login_tokens[0].used_at, null);
});

test('verify: the same email signs in again on the same user', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW });
  const first = new URL(linkFrom(sent)).searchParams.get('token');
  const a = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${first}`), env(db), { now: NOW });
  assert.equal(a.status, 302);
  await handleLogin(post('owner@studio.example'), env(db), { fetchImpl, now: NOW + 60_000 });
  const second = new URL(sent[1].body.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  const b = await handleLoginVerify(new Request(`https://recap.example.com/api/login?token=${second}`), env(db), { now: NOW + 60_000 });
  assert.equal(b.status, 302);
  assert.equal(db.tables.users.length, 1);
  assert.equal(db.tables.sessions.length, 2);
  assert.equal(db.tables.sessions[1].user_id, db.tables.users[0].id);
});

test('login: with no SITE_URL the link uses the request origin, and the pages handlers are wired', async () => {
  const db = memoryDb();
  const { sent, fetchImpl } = mailer();
  const res = await handleLogin(post('owner@studio.example'), env(db, { SITE_URL: '' }), { fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(new URL(linkFrom(sent)).origin, 'https://recap.example.com');
  const posted = await onRequestPost({ request: post('nope'), env: env(db) });
  assert.equal(posted.status, 400);
  const opened = await onRequestGet({ request: new Request('https://recap.example.com/api/login'), env: env(db) });
  assert.equal(opened.status, 400);
  assert.equal(await opened.text(), 'This sign-in link has expired.');
  const who = await onRequestMe({ request: new Request('https://recap.example.com/api/me'), env: env(db) });
  assert.equal(who.status, 401);
});

// Magic-link sign-in for the studio owner. Members never get an account.
// POST { email } mails a link that lasts 15 minutes. GET ?token= sets the sr_session cookie.
import { sendMail } from '../../server/mail.js';
import {
  LOGIN_TTL_MS,
  consumeLoginToken,
  createSession,
  deleteLoginToken,
  ensureUser,
  hasFreshLoginToken,
  iso,
  newToken,
  normalizeEmail,
  saveLoginToken,
  sessionCookie,
  sha256Hex,
} from '../../server/accounts.js';

const MAX_BODY = 4 * 1024;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function expiredLink() {
  return new Response('This sign-in link has expired.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Reads at most `max` bytes, so a huge body is refused without being stored whole.
async function readCapped(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

function siteBase(env, request) {
  return String((env && env.SITE_URL) || new URL(request.url).origin).trim().replace(/\/+$/, '');
}

export async function handleLogin(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const raw = await readCapped(request, MAX_BODY);
  if (raw === null) return json({ error: 'too large' }, 413);
  let body;
  try { body = JSON.parse(raw || ''); } catch { return json({ error: 'bad request' }, 400); }
  const email = normalizeEmail(body && body.email);
  if (!email) return json({ error: 'bad email' }, 400);
  if (!env || !env.RESEND_API_KEY || !env.MAIL_FROM || !env.DB) return json({ error: 'not set up' }, 500);

  // A second click inside a minute gets the same answer and no second email.
  if (await hasFreshLoginToken(env.DB, email, now)) return json({ ok: true });

  const token = newToken();
  const tokenHash = await sha256Hex(token);
  await saveLoginToken(env.DB, { tokenHash, email, expiresAt: iso(now + LOGIN_TTL_MS) });
  const link = `${siteBase(env, request)}/api/login?token=${token}`;
  try {
    await sendMail(env, {
      to: email,
      subject: 'Sign in to Studio Recap',
      text: `Use this link to sign in to Studio Recap. It expires in 15 minutes.\n\n${link}\n`,
    }, fetchImpl);
  } catch (e) {
    // The message from sendMail has no token in it. The link itself is never logged.
    console.error('login email failed', e && e.message);
    try { await deleteLoginToken(env.DB, tokenHash); } catch (drop) {
      console.error('could not drop unused login token', drop && drop.message);
    }
    return json({ error: 'mail failed' }, 502);
  }
  return json({ ok: true });
}

export async function handleLoginVerify(request, env, { now = Date.now() } = {}) {
  let token = '';
  try { token = new URL(request.url).searchParams.get('token') || ''; } catch { token = ''; }
  if (!token || !env || !env.DB) return expiredLink();
  const email = await consumeLoginToken(env.DB, await sha256Hex(token), iso(now));
  if (!email) return expiredLink();
  const userId = await ensureUser(env.DB, email, iso(now));
  const session = await createSession(env.DB, userId, now);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/create.html',
      'Set-Cookie': sessionCookie(session),
    },
  });
}

export async function onRequestPost({ request, env }) {
  return handleLogin(request, env);
}

export async function onRequestGet({ request, env }) {
  return handleLoginVerify(request, env);
}

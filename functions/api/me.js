// Who is signed in, and the studios they have paid for.
// The Stripe webhook writes purchases; this only reads that shared table.
import { SESSION_COOKIE, emailForSession, iso, purchasesForEmail, readCookie, sha256Hex } from '../../server/accounts.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function signedOut() {
  return json({ error: 'signed out' }, 401);
}

export async function handleMe(request, env, { now = Date.now() } = {}) {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (!token || !env || !env.DB) return signedOut();
  const email = await emailForSession(env.DB, await sha256Hex(token), iso(now));
  if (!email) return signedOut();
  const purchases = await purchasesForEmail(env.DB, email);
  return json({ email, purchases });
}

export async function onRequestGet({ request, env }) {
  return handleMe(request, env);
}

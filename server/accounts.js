// Token hashing, the session cookie, and the D1 calls behind owner sign-in.
// The raw token is only ever put in the email or the cookie. The database stores SHA-256 hex.

const MINUTE = 60 * 1000;
export const LOGIN_TTL_MS = 15 * MINUTE;
// A token that still has more than 14 minutes left was created in the last minute.
export const LOGIN_QUIET_MS = 14 * MINUTE;
export const SESSION_TTL_MS = 30 * 24 * 60 * MINUTE;
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = 'sr_session';

export function iso(ms) {
  return new Date(ms).toISOString();
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// 32 random bytes, url-safe base64 with the padding stripped.
export function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export function readCookie(header, name) {
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return '';
}

// One @, nothing on either side empty, no whitespace, at most 200 characters after trim.
export function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (!email || email.length > 200) return '';
  if (/\s/.test(email)) return '';
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return '';
  return email;
}

export async function hasFreshLoginToken(db, email, nowMs) {
  const row = await db.prepare(
    'SELECT token_hash FROM login_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ?'
  ).bind(email, iso(nowMs + LOGIN_QUIET_MS)).first();
  return Boolean(row);
}

export async function saveLoginToken(db, { tokenHash, email, expiresAt }) {
  await db.prepare(
    'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)'
  ).bind(tokenHash, email, expiresAt).run();
}

export async function deleteLoginToken(db, tokenHash) {
  await db.prepare('DELETE FROM login_tokens WHERE token_hash = ?').bind(tokenHash).run();
}

// Marks a still-valid single-use token as used and returns the email it was for.
export async function consumeLoginToken(db, tokenHash, nowIso) {
  const row = await db.prepare(
    'SELECT email FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'
  ).bind(tokenHash, nowIso).first();
  if (!row || !row.email) return '';
  const updated = await db.prepare(
    'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'
  ).bind(nowIso, tokenHash).run();
  if (updated && updated.meta && updated.meta.changes === 0) return '';
  return row.email;
}

export async function ensureUser(db, email, nowIso) {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing && existing.id) return existing.id;
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
  ).bind(id, email, nowIso).run();
  return id;
}

// Returns the raw session token. Only its hash is stored.
export async function createSession(db, userId, nowMs) {
  const token = newToken();
  const tokenHash = await sha256Hex(token);
  await db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(tokenHash, userId, iso(nowMs + SESSION_TTL_MS)).run();
  return token;
}

export async function emailForSession(db, tokenHash, nowIso) {
  const session = await db.prepare(
    'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?'
  ).bind(tokenHash, nowIso).first();
  if (!session || !session.user_id) return '';
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(session.user_id).first();
  return (user && user.email) || '';
}

export async function purchasesForEmail(db, email) {
  const out = await db.prepare(
    'SELECT studio_name, studio_key, year, status FROM purchases WHERE lower(user_email) = ?'
  ).bind(String(email).toLowerCase()).all();
  return (out && out.results) || [];
}

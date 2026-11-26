// Stripe webhook signature check with Web Crypto (works in Cloudflare Pages Functions and Node 20+).
// See https://docs.stripe.com/webhooks#verify-manually

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') out.t = v;
    else if (k === 'v1') out.v1.push(v);
  }
  return out;
}

export async function signPayload(secret, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`)));
}

// Returns true only for a correctly signed body no older than `toleranceSec`.
export async function verifyStripeSignature(body, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret) return false;
  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !/^\d+$/.test(t) || !v1.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = await signPayload(secret, t, body);
  return v1.some((sig) => safeEqual(sig, expected));
}

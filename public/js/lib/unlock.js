// Unlock codes are Ed25519 signatures over the studio name and year, made with
// scripts/make-unlock-code.mjs or by the Stripe webhook (functions/api/stripe-webhook.js).
// Pages only hold the public key. Unlocked member links carry the code, and the recap page
// checks it, so deleting the preview flag from a link doesn't remove the PREVIEW mark.

// Letters and digits in any script; case, spaces and punctuation don't matter.
export function normalizeStudioName(studioName) {
  return String(studioName || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function unlockMessage(studioName, year) {
  const name = normalizeStudioName(studioName);
  if (!name) throw new Error('Studio name needs at least one letter or digit');
  return `studio-recap:v1:${name}:${year}`;
}

// RFC 8032 test vector 1 public key: a valid point, so engines that check points on import accept it.
const PROBE_KEY = Uint8Array.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'.match(/../g), (h) => parseInt(h, 16));

export async function ed25519Supported() {
  try {
    await crypto.subtle.importKey('raw', PROBE_KEY, { name: 'Ed25519' }, false, ['verify']);
    return true;
  } catch {
    return false;
  }
}

function fromB64Url(s) {
  s = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyUnlock(code, studioName, year, publicKeyB64) {
  if (!code || !publicKeyB64 || !normalizeStudioName(studioName)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', fromB64Url(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
    const sig = fromB64Url(cleanCode(code));
    if (sig.length !== 64) return false;
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(unlockMessage(studioName, year)));
  } catch {
    return false;
  }
}

export function cleanCode(code) {
  return String(code || '').replace(/\s+/g, '');
}

// Whether a member link's studio block (`s`) is unlocked: it must carry a code that matches
// its own studio name and year. A browser that can't check Ed25519 gets the benefit of the doubt
// for a link that carries a code, so members on older phones don't see PREVIEW on a paid recap;
// the owner's tool already refused to make unlocked links without a valid code.
// Before the site has keys (no public key), nothing can be unlocked, so the old preview flag decides.
export async function linkUnlocked(s, publicKeyB64, { supported } = {}) {
  if (!s) return false;
  if (!publicKeyB64) return !s.p;
  if (!s.u || s.p) return false;
  if (!(supported ?? (await ed25519Supported()))) {
    // Can't check here: at least require something shaped like a real code.
    try { return fromB64Url(cleanCode(s.u)).length === 64; } catch { return false; }
  }
  return verifyUnlock(s.u, s.n, s.y, publicKeyB64);
}

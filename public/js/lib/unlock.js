// Unlock codes are Ed25519 signatures over the studio name and year,
// made offline with scripts/make-unlock-code.mjs. The page only holds the public key.

// Letters and digits in any script; case, spaces and punctuation don't matter.
export function normalizeStudioName(studioName) {
  return String(studioName || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function unlockMessage(studioName, year) {
  const name = normalizeStudioName(studioName);
  if (!name) throw new Error('Studio name needs at least one letter or digit');
  return `studio-recap:v1:${name}:${year}`;
}

export async function ed25519Supported() {
  try {
    await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'Ed25519' }, false, ['verify']);
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
    const sig = fromB64Url(code.replace(/\s+/g, ''));
    if (sig.length !== 64) return false;
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(unlockMessage(studioName, year)));
  } catch {
    return false;
  }
}

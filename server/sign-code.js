// Makes an unlock code in a Pages Function, the same code scripts/make-unlock-code.mjs makes.
import { unlockMessage } from '../public/js/lib/unlock.js';

function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toB64Url(buf) {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// privatePem: the contents of keys/private.pem (PKCS#8), stored as the UNLOCK_PRIVATE_KEY secret.
export async function makeUnlockCode(privatePem, studioName, year) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privatePem), { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(unlockMessage(studioName, year)));
  return toB64Url(sig);
}

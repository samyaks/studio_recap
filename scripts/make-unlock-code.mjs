// Makes the unlock code you send a studio after it pays.
// Usage: node scripts/make-unlock-code.mjs "Studio Name" 2026
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unlockMessage, normalizeStudioName } from '../public/js/lib/unlock.js';

const [name, yearArg] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node scripts/make-unlock-code.mjs "Studio Name" [year]');
  process.exit(2);
}
const year = Number(yearArg || new Date().getFullYear());
if (!normalizeStudioName(name)) {
  console.error('The studio name needs at least one letter or digit.');
  process.exit(2);
}
const keyPath = process.env.UNLOCK_PRIVATE_KEY || fileURLToPath(new URL('../keys/private.pem', import.meta.url));
const key = createPrivateKey(readFileSync(keyPath));
const sig = sign(null, Buffer.from(unlockMessage(name, year)), key);
console.log(`Unlock code for "${name}" (${year}):`);
console.log(sig.toString('base64url'));
console.log('The studio must type its name the same way in the tool (spacing, case and punctuation don\'t matter).');

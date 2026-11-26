// One-time setup: makes the key pair for unlock codes.
// Writes keys/private.pem (keep it secret, never commit it) and puts the public key in public/js/config.js.
import { generateKeyPairSync, sign } from 'node:crypto';
import { unlockMessage } from '../public/js/lib/unlock.js';
import { SAMPLE_STUDIO } from '../public/js/lib/sample.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keysDir = fileURLToPath(new URL('../keys/', import.meta.url));
const privPath = keysDir + 'private.pem';
if (existsSync(privPath)) {
  console.error('keys/private.pem already exists. Delete it first if you really want new keys (old unlock codes will stop working).');
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(keysDir, { recursive: true });
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ format: 'jwk' }).x; // base64url raw key

const configPath = fileURLToPath(new URL('../public/js/config.js', import.meta.url));
// The landing page's sample studio (public/js/landing.js) gets its own code so it shows unlocked.
const demoCode = sign(null, Buffer.from(unlockMessage(SAMPLE_STUDIO.name, SAMPLE_STUDIO.year)), privateKey).toString('base64url');
const config = readFileSync(configPath, 'utf8')
  .replace(/unlockPublicKey:\s*'[^']*'/, `unlockPublicKey: '${pub}'`)
  .replace(/demoUnlockCode:\s*'[^']*'/, `demoUnlockCode: '${demoCode}'`);
writeFileSync(configPath, config);
console.log('Private key saved to keys/private.pem. Keep it safe.');
console.log('Public key written to public/js/config.js:', pub);

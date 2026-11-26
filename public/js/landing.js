import { CONFIG } from './config.js';
import { encodePayload } from './lib/codec.js';
import { safeUrl } from './lib/cards.js';
import { SAMPLE_STUDIO } from './lib/sample.js';

document.querySelectorAll('[data-product-name]').forEach((e) => { e.textContent = CONFIG.productName; });
document.querySelectorAll('[data-price]').forEach((e) => { e.textContent = CONFIG.price; });

const buy = document.getElementById('buy');
if (safeUrl(CONFIG.paymentLink)) buy.href = CONFIG.paymentLink;
else buy.remove();

const contact = document.getElementById('contact');
if (CONFIG.contactEmail) {
  contact.href = 'mailto:' + CONFIG.contactEmail;
  contact.textContent = CONFIG.contactEmail;
} else contact.parentElement.remove();

// A made-up member at a made-up studio, for the phone on this page.
const sample = {
  s: { n: SAMPLE_STUDIO.name, y: SAMPLE_STUDIO.year, h: 'juniperyoga', c: '#1f4d3a', a: '#f2c14e', b: 'https://example.com/book',
    t: 'Thank you for showing up for yourself this year. We loved every class with you.', o: 'Bring a friend free to any class in January' },
  k: 'r', f: 'Maya',
  m: { n: 142, mn: 7380, fc: ['Sunrise Vinyasa', 51], fi: ['Marisol', 38], st: 19, bm: [3, 18], dw: 5, et: 360, pc: 94 },
};
// The sample carries a real code for the made-up studio, so it shows unlocked once the site has keys.
if (CONFIG.demoUnlockCode) sample.s.u = CONFIG.demoUnlockCode;
const welcome = { s: sample.s, k: 'w', f: 'Leo' };

const frame = document.getElementById('demoPhone');
encodePayload(sample).then((p) => { frame.src = 'r.html#' + p; });
document.getElementById('showWelcome').addEventListener('click', async () => { frame.src = 'r.html#' + (await encodePayload(welcome)); });
document.getElementById('showRecap').addEventListener('click', async () => { frame.src = 'r.html#' + (await encodePayload(sample)); });

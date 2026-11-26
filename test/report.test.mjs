import { test } from 'node:test';
import assert from 'node:assert/strict';

test('error reports never include the part of the link after #', async () => {
  const listeners = {};
  const beacons = [];
  globalThis.window = { addEventListener: (t, f) => { listeners[t] = f; } };
  globalThis.location = { pathname: '/r.html', href: 'https://recap.example.com/r.html#1.secretmemberdata' };
  Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } }, configurable: true });
  await import('../public/js/lib/report.js');
  listeners.error({ message: 'boom', filename: 'https://recap.example.com/js/recap.js?v=1#frag', lineno: 3, colno: 9 });
  listeners.unhandledrejection({ reason: new Error('nope') });
  assert.equal(beacons.length, 2);
  for (const b of beacons) {
    assert.equal(b.url, '/api/client-error');
    const text = await b.blob.text();
    assert.doesNotMatch(text, /secretmemberdata|#/);
  }
  const first = JSON.parse(await beacons[0].blob.text());
  assert.deepEqual(first, { page: '/r.html', message: 'boom', source: '/js/recap.js', line: 3, col: 9 });
  for (let i = 0; i < 10; i++) listeners.error({ message: 'again' });
  assert.equal(beacons.length, 5); // capped per page
});

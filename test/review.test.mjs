import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { parseCSV } from '../public/js/lib/csv.js';
import { parseDate } from '../public/js/lib/dates.js';
import { guessMapping, findHeaderRow, applyMapping } from '../public/js/lib/mapping.js';
import { computeRecaps, planType, parseDuration } from '../public/js/lib/stats.js';
import { verifyUnlock, unlockMessage } from '../public/js/lib/unlock.js';

const TODAY = new Date(2026, 10, 25);
function visit(key, date, extra = {}) {
  return { key, firstName: key, lastName: '', email: '', date, time: '', className: 'Flow', instructor: 'Ann', duration: '', plan: 'Unlimited Membership', status: '', ...extra };
}

test('Monday visits and midnight-free times count', () => {
  const visits = [];
  for (const d of [5, 12, 19, 26]) visits.push(visit('mon', `1/${d}/2026`, { time: '9:00 AM' })); // Mondays
  visits.push(visit('mon', '1/7/2026', { time: '9:00 AM' }));
  const { members } = computeRecaps(visits, { today: TODAY });
  assert.equal(members[0].favoriteDay[0], 0); // Monday is index 0
});

test('no-shows in many spellings are skipped', () => {
  const statuses = ['No_Show', 'no-show', 'Late Cancel', 'Cancelled', 'Absent', 'Waitlist', 'Not Checked In', 'Did not attend', 'Reserved'];
  const visits = statuses.map((s, i) => visit('a', `2/${i + 1}/2026`, { status: s }));
  visits.push(visit('a', '3/1/2026', { status: 'Checked In' }));
  const { summary } = computeRecaps(visits, { today: TODAY });
  assert.equal(summary.problems.skippedStatus, statuses.length);
  assert.equal(summary.totalClasses, 1);
});

test('yes/no attendance columns', () => {
  const header = ['Email', 'Class Date', 'Attended'];
  const rows = [['a@x.com', '1/5/2026', 'Yes'], ['a@x.com', '1/6/2026', 'No']];
  const m = guessMapping(header);
  const v = applyMapping(rows, m, header);
  const { summary } = computeRecaps(v, { today: TODAY });
  assert.equal(summary.totalClasses, 1);
  const header2 = ['Email', 'Class Date', 'No Show'];
  const v2 = applyMapping([['a@x.com', '1/5/2026', 'TRUE'], ['a@x.com', '1/6/2026', 'FALSE']], guessMapping(header2), header2);
  assert.equal(computeRecaps(v2, { today: TODAY }).summary.totalClasses, 1);
});

test('mapping: visit type is not status, booking and birth dates are not class dates', () => {
  const m = guessMapping(['Client Name', 'Email', 'Date of Birth', 'Booking Date', 'Class Date', 'Visit Type', 'Status']);
  assert.equal(m.date, 4);
  assert.equal(m.status, 6);
  const m2 = guessMapping(['Room Name', 'Client Name', 'Email', 'Date']);
  assert.equal(m2.fullName, 1);
});

test('mapping: a bare ID column is dropped when email exists', () => {
  const m = guessMapping(['ID', 'Email', 'Date']);
  assert.equal(m.memberId, undefined);
  assert.equal(m.email, 1);
  const m2 = guessMapping(['Client ID', 'Email', 'Date']);
  assert.equal(m2.memberId, 0);
});

test('plans and durations', () => {
  assert.equal(planType('Non-Member Drop In'), 'pack');
  assert.equal(planType('Non Member'), 'pack');
  assert.equal(parseDuration('1:15'), 75);
  assert.equal(parseDuration('45 min'), 45);
  assert.equal(parseDuration('1 hour'), 60);
  assert.equal(parseDuration('60'), 60);
});

test('dates: more export formats and time zones', () => {
  assert.deepEqual(parseDate('2026/03/14'), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  assert.deepEqual(parseDate('14-Mar-26'), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  assert.deepEqual(parseDate('Mar-14-2026'), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  assert.deepEqual(parseDate('14.03.2026', { dayFirst: true }), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  const z = parseDate('2026-03-14T18:00:00Z');
  assert.equal(z.y, 2026);
  assert.ok(z.h != null);
});

test('future bookings are dropped and default year is the busiest', () => {
  const visits = [visit('a', '12/20/2026'), visit('a', '3/1/2026'), visit('a', '3/2/2026'), visit('a', '12/1/2025')];
  const { summary } = computeRecaps(visits, { today: TODAY });
  assert.equal(summary.problems.future, 1);
  assert.equal(summary.year, 2026);
  assert.equal(summary.problems.otherYear, 1);
});

test('csv: stray quote mid-field and semicolon file with a title row', () => {
  assert.deepEqual(parseCSV('a,b\n5" mat,2'), [['a', 'b'], ['5" mat', '2']]);
  const rows = parseCSV('Visit report\nEmail;Class Date;Class\na@x.com;1/5/2026;Flow, slow\n');
  const hi = findHeaderRow(rows);
  assert.deepEqual(rows[hi], ['Email', 'Class Date', 'Class']);
  assert.equal(rows[hi + 1][2], 'Flow, slow');
});

test('unlock: unicode names normalize and empty names are refused', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const code = sign(null, Buffer.from(unlockMessage('Café Pilates', 2026)), privateKey).toString('base64url');
  assert.equal(await verifyUnlock(code, 'CAFÉ  pilates!', 2026, pub), true);
  assert.equal(await verifyUnlock(code, 'Cafe Pilates', 2026, pub), false);
  assert.throws(() => unlockMessage('  !!  ', 2026));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseCSV, toCSV } from '../public/js/lib/csv.js';
import { parseDate, parseTime, guessDayFirst, weekday, formatTime } from '../public/js/lib/dates.js';
import { guessMapping, findHeaderRow, applyMapping } from '../public/js/lib/mapping.js';
import { computeRecaps, planType } from '../public/js/lib/stats.js';
import { encodePayload, decodePayload, memberPayload } from '../public/js/lib/codec.js';
import { verifyUnlock, unlockMessage, linkUnlocked } from '../public/js/lib/unlock.js';
import { textOn, safeHex } from '../public/js/lib/color.js';

test('csv: quotes, commas, newlines, BOM, semicolons', () => {
  const rows = parseCSV('﻿a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\n\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line\nbreak']]);
  assert.deepEqual(parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('csv: writer escapes and blocks formulas', () => {
  const out = toCSV([['=SUM(A1)', 'a,b', 'ok']]);
  assert.equal(out, `'=SUM(A1),"a,b",ok\r\n`);
  assert.deepEqual(parseCSV(toCSV([['x "q"', 'line\nbreak']])), [['x "q"', 'line\nbreak']]);
});

test('dates: common export formats', () => {
  assert.deepEqual(parseDate('2026-03-14'), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  assert.deepEqual(parseDate('2026-03-14T06:30:00'), { y: 2026, mo: 3, d: 14, h: 6, mi: 30 });
  assert.deepEqual(parseDate('3/14/2026 6:00 PM'), { y: 2026, mo: 3, d: 14, h: 18, mi: 0 });
  assert.deepEqual(parseDate('03/04/26'), { y: 2026, mo: 3, d: 4, h: null, mi: 0 });
  assert.deepEqual(parseDate('03/04/2026', { dayFirst: true }), { y: 2026, mo: 4, d: 3, h: null, mi: 0 });
  assert.deepEqual(parseDate('Sat, Mar 14, 2026 7:15am'), { y: 2026, mo: 3, d: 14, h: 7, mi: 15 });
  assert.deepEqual(parseDate('September 9 2026'), { y: 2026, mo: 9, d: 9, h: null, mi: 0 });
  assert.deepEqual(parseDate('14 Mar 2026'), { y: 2026, mo: 3, d: 14, h: null, mi: 0 });
  assert.equal(parseDate('2/30/2026'), null);
  assert.equal(parseDate('hello'), null);
  assert.equal(parseDate('46095').y, 2026); // Excel serial
  assert.deepEqual(parseTime('12:00 AM'), { h: 0, mi: 0 });
  assert.deepEqual(parseTime('12:30 pm'), { h: 12, mi: 30 });
  assert.deepEqual(parseTime('18:45'), { h: 18, mi: 45 });
  assert.equal(guessDayFirst(['13/02/2026', '01/02/2026']), true);
  assert.equal(guessDayFirst(['02/13/2026']), false);
  assert.equal(weekday({ y: 2026, mo: 11, d: 25 }), 2); // a Wednesday
  assert.equal(formatTime(360), '6:00 AM');
  assert.equal(formatTime(13 * 60 + 5), '1:05 PM');
});

test('mapping: guesses common headers and skips title rows', () => {
  const rows = [['Visit History Report'], ['Dates: 1/1/2026 - 11/24/2026'], ['Client', 'Email Address', 'Class Date', 'Start Time', 'Class Name', 'Instructor', 'Status']];
  const hi = findHeaderRow(rows);
  assert.equal(hi, 2);
  const m = guessMapping(rows[hi]);
  assert.equal(m.fullName, 0);
  assert.equal(m.email, 1);
  assert.equal(m.date, 2);
  assert.equal(m.time, 3);
  assert.equal(m.className, 4);
  assert.equal(m.instructor, 5);
  assert.equal(m.status, 6);
  const m2 = guessMapping(['First Name', 'Last Name', 'Date', 'Service', 'Staff', 'Pricing Option']);
  assert.deepEqual(m2, { firstName: 0, lastName: 1, date: 2, className: 3, instructor: 4, plan: 5 });
});

test('mapping: names in "Last, First" form and member keys', () => {
  const v = applyMapping([['SMITH, JANE', 'J@X.COM', '1/2/2026']], { fullName: 0, email: 1, date: 2 });
  assert.equal(v[0].firstName, 'Jane');
  assert.equal(v[0].lastName, 'Smith');
  assert.equal(v[0].key, 'em:j@x.com');
});

test('plan types', () => {
  assert.equal(planType('10 Class Pack'), 'pack');
  assert.equal(planType('Drop In'), 'pack');
  assert.equal(planType('Unlimited Monthly Membership'), 'member');
  assert.equal(planType('Intro Month Unlimited'), 'pack');
  assert.equal(planType(''), 'unknown');
});

function visit(key, date, extra = {}) {
  return { key, firstName: key, lastName: '', email: '', date, time: '', className: 'Flow', instructor: 'Ann', duration: '', plan: 'Unlimited Membership', status: '', ...extra };
}

test('stats: recap vs welcome-back, packs, cancels, streaks', () => {
  const visits = [];
  // Regular: weekly Jan to Jun = 26 visits over 6 months.
  for (let w = 0; w < 26; w++) {
    const d = new Date(Date.UTC(2026, 0, 5 + w * 7));
    visits.push(visit('reg', `${d.getUTCMonth() + 1}/${d.getUTCDate()}/2026`, { time: '6:00 AM' }));
  }
  // Rare member: 2 visits.
  visits.push(visit('rare', '1/10/2026'), visit('rare', '3/10/2026'));
  // Pack holder with 2 visits still gets a recap.
  visits.push(visit('pack', '5/1/2026', { plan: '5 Class Pack' }), visit('pack', '6/1/2026', { plan: '5 Class Pack' }));
  // Cancellations and other years are ignored.
  visits.push(visit('rare', '4/1/2026', { status: 'Late Cancel' }), visit('rare', '4/2/2025'));
  const { members, summary } = computeRecaps(visits, { threshold: 2 });
  const by = Object.fromEntries(members.map((m) => [m.key, m]));
  assert.equal(by.reg.total, 26);
  assert.equal(by.reg.streak, 26);
  assert.equal(by.reg.kind, 'recap');
  assert.equal(by.reg.earliest, 360);
  assert.equal(by.rare.kind, 'welcome');
  assert.equal(by.pack.kind, 'recap');
  assert.equal(summary.problems.skippedStatus, 1);
  assert.equal(summary.problems.otherYear, 1);
  assert.equal(summary.year, 2026);
  assert.ok(by.reg.percentile >= 50);
});

test('stats: joining late in the year is judged on months since joining', () => {
  const visits = [visit('a', '1/5/2026'), visit('new', '11/2/2026'), visit('new', '11/9/2026'), visit('new', '11/16/2026')];
  const { members } = computeRecaps(visits, { threshold: 2 });
  assert.equal(members.find((m) => m.key === 'new').kind, 'recap');
});

test('codec: round trip, small links, welcome-back has no stats', async () => {
  const member = { kind: 'recap', firstName: 'Ava', total: 120, minutes: 6000, favoriteClass: ['Flow', 40], favoriteInstructor: ['Ann', 30], streak: 12, busiestMonth: [3, 15], favoriteDay: [5, 30], earliest: 360, percentile: 91 };
  const studio = { name: 'Test Studio', year: 2026, handle: 'test', color: '#123456', note: 'Thanks!', offer: 'Free class' };
  const enc = await encodePayload(memberPayload(member, studio, { preview: true }));
  const dec = await decodePayload(enc);
  assert.equal(dec.f, 'Ava');
  assert.equal(dec.m.n, 120);
  assert.equal(dec.s.p, 1);
  assert.ok(enc.length < 400, `link too long: ${enc.length}`);
  const w = await decodePayload(await encodePayload(memberPayload({ ...member, kind: 'welcome' }, studio, { preview: false, unlockCode: 'abc def' })));
  assert.equal(w.k, 'w');
  assert.equal(w.m, undefined);
  assert.equal(w.s.p, undefined);
  assert.equal(w.s.u, 'abcdef');
  // No code means a preview link, even when preview isn't asked for.
  const noCode = await decodePayload(await encodePayload(memberPayload(member, studio, { preview: false })));
  assert.equal(noCode.s.p, 1);
  assert.equal(noCode.s.u, undefined);
});

test('unlock: member links are checked against their own studio and year', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const code = sign(null, Buffer.from(unlockMessage('Juniper Yoga', 2026)), privateKey).toString('base64url');
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2026, u: code }, pub), true);
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2026 }, pub), false); // flag deleted, no code
  assert.equal(await linkUnlocked({ n: 'Other Studio', y: 2026, u: code }, pub), false); // code copied to another studio
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2027, u: code }, pub), false);
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2026, u: code, p: 1 }, pub), false);
  // Before the site has keys, the preview flag decides (the tool marks every link preview then).
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2026 }, ''), true);
  assert.equal(await linkUnlocked({ n: 'Juniper Yoga', y: 2026, p: 1 }, ''), false);
});

test('unlock: valid code verifies, wrong studio or year fails', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const code = sign(null, Buffer.from(unlockMessage('Juniper Yoga + Pilates', 2026)), privateKey).toString('base64url');
  assert.equal(await verifyUnlock(code, 'juniper yoga pilates', 2026, pub), true);
  assert.equal(await verifyUnlock(code, 'Other Studio', 2026, pub), false);
  assert.equal(await verifyUnlock(code, 'Juniper Yoga + Pilates', 2027, pub), false);
  assert.equal(await verifyUnlock('garbage', 'Juniper Yoga + Pilates', 2026, pub), false);
  assert.equal(await verifyUnlock(code, 'Juniper Yoga + Pilates', 2026, ''), false);
});

test('color: readable text and safe hex', () => {
  assert.equal(textOn('#ffffff'), '#111111');
  assert.equal(textOn('#1f4d3a'), '#ffffff');
  assert.equal(safeHex('abc', '#000000'), '#aabbcc');
  assert.equal(safeHex('red;}', '#000000'), '#000000');
});

test('demo data: end to end', () => {
  const rows = parseCSV(readFileSync(new URL('../public/samples/demo-studio.csv', import.meta.url), 'utf8'));
  const hi = findHeaderRow(rows);
  const visits = applyMapping(rows.slice(hi + 1), guessMapping(rows[hi]));
  const { members, summary } = computeRecaps(visits, { today: new Date(2026, 10, 25) });
  assert.equal(summary.year, 2026);
  assert.ok(summary.recaps > 50 && summary.welcomes > 10, JSON.stringify(summary));
  assert.equal(summary.problems.badDate, 0);
  assert.ok(summary.problems.skippedStatus > 500, 'demo no-shows should be skipped');
  assert.ok(members.every((m) => m.firstName));
});

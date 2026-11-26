// Writes public/samples/demo-studio.csv: a made-up studio's 2026 attendance,
// laid out like a typical booking-system visit export. Every name is invented.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toCSV } from '../public/js/lib/csv.js';

let seed = 20261128;
function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const FIRST = ['Ava', 'Maya', 'Leo', 'Priya', 'Jordan', 'Sam', 'Noah', 'Isla', 'Mateo', 'Zoe', 'Ethan', 'Nina', 'Omar', 'Grace', 'Lucas', 'Aria', 'Kai', 'Elena', 'Ravi', 'Chloe', 'Diego', 'Hana', 'Owen', 'Lena', 'Theo', 'Mia', 'Arjun', 'Sofia', 'Ben', 'Tara', 'Iris', 'Felix', 'Rosa', 'Eli', 'June', 'Nora'];
const LAST = ['Rivera', 'Chen', 'Patel', 'Kim', 'Okafor', 'Silva', 'Nguyen', 'Brooks', 'Haddad', 'Larsen', 'Moreno', 'Singh', 'Ito', 'Walsh', 'Baker', 'Costa', 'Reyes', 'Fischer', 'Adams', 'Novak'];
const SCHEDULE = [
  // [weekday 0=Mon, hour, minute, class, instructor, minutes]
  [0, 6, 0, 'Sunrise Vinyasa', 'Marisol', 60], [0, 12, 0, 'Mat Pilates', 'Dev', 45], [0, 18, 30, 'Power Sculpt', 'Kenji', 50],
  [1, 7, 0, 'Reformer Basics', 'Dev', 50], [1, 17, 30, 'Hot 60', 'Marisol', 60], [1, 19, 0, 'Yin + Restore', 'Lou', 75],
  [2, 6, 0, 'Sunrise Vinyasa', 'Marisol', 60], [2, 12, 0, 'Barre Burn', 'Tess', 45], [2, 18, 30, 'Power Sculpt', 'Kenji', 50],
  [3, 7, 0, 'Reformer Basics', 'Dev', 50], [3, 17, 30, 'Hot 60', 'Lou', 60], [3, 19, 0, 'Mat Pilates', 'Tess', 45],
  [4, 6, 0, 'Sunrise Vinyasa', 'Kenji', 60], [4, 17, 0, 'Barre Burn', 'Tess', 45],
  [5, 8, 0, 'Power Sculpt', 'Kenji', 50], [5, 9, 30, 'Reformer Basics', 'Dev', 50], [5, 11, 0, 'Hot 60', 'Marisol', 60],
  [6, 9, 0, 'Sunrise Vinyasa', 'Lou', 60], [6, 16, 0, 'Yin + Restore', 'Lou', 75],
];
const PLANS = [['Unlimited Monthly Membership', 0.55], ['8 Classes a Month Membership', 0.15], ['10 Class Pack', 0.2], ['Drop In', 0.1]];

function pickPlan() {
  let r = rand();
  for (const [p, w] of PLANS) { if ((r -= w) < 0) return p; }
  return PLANS[0][0];
}

const members = [];
for (let i = 0; i < 180; i++) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length + i * 7) % LAST.length];
  const tier = rand();
  // Visits per week: some regulars, many casual, a tail who stopped coming.
  const perWeek = tier < 0.2 ? 3 + rand() * 2 : tier < 0.55 ? 1 + rand() * 1.5 : tier < 0.8 ? 0.3 + rand() * 0.5 : 0.05 + rand() * 0.15;
  const startDay = Math.floor(rand() * rand() * 300); // most joined early in the year
  const favorites = [pick(SCHEDULE), pick(SCHEDULE), pick(SCHEDULE)];
  members.push({ id: 100200 + i, first, last, email: `${first}.${last}${i}@example.com`.toLowerCase(), perWeek, startDay, favorites, plan: pickPlan() });
}

const start = Date.UTC(2026, 0, 1);
const end = Date.UTC(2026, 10, 24); // export run on Nov 24, 2026
const rows = [['Client ID', 'Client Name', 'Email', 'Visit Date', 'Time', 'Class', 'Teacher', 'Pricing Option', 'Status']];
for (let t = start; t <= end; t += 86400000) {
  const dayIndex = (t - start) / 86400000;
  const dt = new Date(t);
  const wd = (dt.getUTCDay() + 6) % 7;
  const todays = SCHEDULE.filter((s) => s[0] === wd);
  for (const m of members) {
    if (dayIndex < m.startDay) continue;
    if (rand() > m.perWeek / 7) continue;
    const fav = m.favorites.filter((f) => f[0] === wd);
    const s = fav.length && rand() < 0.7 ? pick(fav) : pick(todays);
    const status = rand() < 0.05 ? 'Late Cancel' : rand() < 0.03 ? 'No Show' : 'Signed In';
    const date = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()}`;
    const h12 = s[1] % 12 === 0 ? 12 : s[1] % 12;
    const time = `${h12}:${String(s[2]).padStart(2, '0')} ${s[1] < 12 ? 'AM' : 'PM'}`;
    rows.push([m.id, `${m.last}, ${m.first}`, m.email, date, time, s[3], s[4], m.plan, status]);
  }
}

const out = fileURLToPath(new URL('../public/samples/demo-studio.csv', import.meta.url));
writeFileSync(out, toCSV(rows));
console.log(`Wrote ${rows.length - 1} visits for ${members.length} members to ${out}`);

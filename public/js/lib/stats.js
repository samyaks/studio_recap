import { parseDate, parseTime, weekNumber, weekday, guessDayFirst, dayNumber } from './dates.js';

const SKIP_STATUS = /no[\s_-]?show|cancel|absent|wait[\s_-]*list|not[\s_-]+(checked|signed)[\s_-]*in|did[\s_-]*not[\s_-]*attend|removed|declined|missed|^reserved?$/i;
const PACK_PLAN = /pack|drop[\s-]?in|class\s*card|punch|single|intro|trial|credit|guest|day\s*pass|non[\s-]?member|\b\d+\s*(class|visit)/i;
const MEMBER_PLAN = /member|unlimited|monthly|annual|yearly|auto[\s-]?(pay|renew)|subscription|recurring/i;

function mode(map) {
  let best = null, bestCount = 0;
  for (const [k, v] of map) if (v > bestCount) { best = k; bestCount = v; }
  return best == null ? null : [best, bestCount];
}

function bump(map, k) {
  // 0 is a real key here (Monday, midnight), so only skip missing values.
  if (k == null || k === '') return;
  map.set(k, (map.get(k) || 0) + 1);
}

export function planType(plan) {
  if (!plan) return 'unknown';
  if (/non[\s-]?member/i.test(plan)) return 'pack';
  if (MEMBER_PLAN.test(plan) && !/intro|trial/i.test(plan)) return 'member';
  if (PACK_PLAN.test(plan)) return 'pack';
  return 'unknown';
}

// "50", "50 min", "1 hour", "1.5 hours", "1:00", "1h 15m", "00:45:00" -> minutes.
export function parseDuration(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/))) {
    // h:mm or h:mm:ss
    return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  }
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  const mi = s.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/);
  if (h || mi) return (h ? Number(h[1]) * 60 : 0) + (mi ? Number(mi[1]) : 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return Number(m[1]);
  return null;
}

/**
 * visits: output of applyMapping.
 * opts: { year, threshold (visits per month), defaultMinutes, dayFirst }
 */
export function computeRecaps(visits, opts = {}) {
  const threshold = opts.threshold ?? 2;
  const defaultMinutes = opts.defaultMinutes ?? 50;
  const dayFirst = opts.dayFirst ?? guessDayFirst(visits.map((v) => v.date));
  const now = opts.today || new Date();
  const today = dayNumber({ y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() });

  const problems = { badDate: 0, noMember: 0, skippedStatus: 0, otherYear: 0, future: 0 };
  const parsed = [];
  for (const v of visits) {
    if (!v.key) { problems.noMember++; continue; }
    if (v.status && SKIP_STATUS.test(v.status)) { problems.skippedStatus++; continue; }
    const p = parseDate(v.date, { dayFirst });
    if (!p) { problems.badDate++; continue; }
    if (dayNumber(p) > today) { problems.future++; continue; }
    if (v.time) {
      const full = parseDate(v.time, { dayFirst });
      const t = full && full.h != null ? full : parseTime(v.time);
      if (t) { p.h = t.h; p.mi = t.mi; }
    }
    parsed.push({ v, p });
  }

  // Dates like "3/14/2026 12:00:00 AM" carry a fake midnight. If no visit has a
  // real time of day, treat the times as missing.
  if (!parsed.some(({ p }) => p.h != null && (p.h !== 0 || p.mi !== 0))) {
    for (const { p } of parsed) p.h = null;
  }

  // Default year: the year with the most visits.
  let year = opts.year;
  if (!year) {
    const counts = new Map();
    for (const { p } of parsed) bump(counts, p.y);
    const top = mode(counts);
    year = top ? top[0] : now.getFullYear();
  }
  const inYear = parsed.filter(({ p }) => {
    if (p.y !== year) { problems.otherYear++; return false; }
    return true;
  });

  let endMonth = 1;
  for (const { p } of inYear) if (p.mo > endMonth) endMonth = p.mo;

  const byMember = new Map();
  for (const item of inYear) {
    const k = item.v.key;
    if (!byMember.has(k)) byMember.set(k, []);
    byMember.get(k).push(item);
  }

  const studio = {
    classCounts: new Map(), weekdayCounts: new Map(), hourCounts: new Map(), monthCounts: new Map(),
    totalClasses: 0, totalMinutes: 0, hasTimes: false, hasInstructors: false, hasClassNames: false,
  };

  const members = [];
  for (const [key, items] of byMember) {
    items.sort((a, b) => (a.p.y - b.p.y) || (a.p.mo - b.p.mo) || (a.p.d - b.p.d) || ((a.p.h ?? 0) - (b.p.h ?? 0)) || (a.p.mi - b.p.mi));
    const classes = new Map(), instructors = new Map(), months = new Map(), days = new Map(), plans = new Map();
    const weeks = new Set();
    let minutes = 0, earliest = null;
    let firstName = '', lastName = '', email = '';
    for (const { v, p } of items) {
      if (v.firstName && !firstName) firstName = v.firstName;
      if (v.lastName && !lastName) lastName = v.lastName;
      if (v.email && !email) email = v.email;
      bump(classes, v.className);
      bump(instructors, v.instructor);
      bump(months, p.mo);
      bump(days, weekday(p));
      bump(plans, planType(v.plan));
      weeks.add(weekNumber(p));
      const dur = parseDuration(v.duration);
      const mins = dur > 0 && dur <= 300 ? Math.round(dur) : defaultMinutes;
      minutes += mins;
      if (p.h != null) {
        const mod = p.h * 60 + p.mi;
        if (earliest == null || mod < earliest) earliest = mod;
        bump(studio.hourCounts, p.h);
        studio.hasTimes = true;
      }
      bump(studio.classCounts, v.className);
      bump(studio.weekdayCounts, weekday(p));
      bump(studio.monthCounts, p.mo);
      if (v.instructor) studio.hasInstructors = true;
      if (v.className) studio.hasClassNames = true;
      studio.totalClasses++;
      studio.totalMinutes += mins;
    }

    // Longest run of consecutive weeks with at least one class.
    const sortedWeeks = [...weeks].sort((a, b) => a - b);
    let streak = 0, run = 0, prev = null;
    for (const w of sortedWeeks) {
      run = prev != null && w === prev + 1 ? run + 1 : 1;
      if (run > streak) streak = run;
      prev = w;
    }

    const first = items[0].p;
    const monthsActive = Math.max(1, endMonth - first.mo + 1);
    const total = items.length;
    const perMonth = total / monthsActive;
    const known = [...plans.entries()].filter(([k]) => k !== 'unknown');
    const plan = known.length ? mode(new Map(known))[0] : 'unknown';
    // Pack and drop-in customers have no membership to cancel, so they always get the recap.
    const kind = plan === 'pack' || perMonth >= threshold ? 'recap' : 'welcome';

    members.push({
      key, firstName, lastName, email, plan, kind, total, minutes, perMonth,
      favoriteClass: mode(classes), favoriteInstructor: mode(instructors),
      busiestMonth: mode(months), favoriteDay: mode(days), streak, earliest,
      firstVisit: { y: first.y, mo: first.mo, d: first.d },
    });
  }

  // Percentile: share of members who took fewer classes.
  const totals = members.map((m) => m.total).sort((a, b) => a - b);
  for (const m of members) {
    let lo = 0, hi = totals.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (totals[mid] < m.total) lo = mid + 1; else hi = mid; }
    m.percentile = totals.length > 1 ? Math.floor((lo / totals.length) * 100) : 0;
  }
  members.sort((a, b) => b.total - a.total);

  const topClasses = [...studio.classCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const summary = {
    year,
    members: members.length,
    recaps: members.filter((m) => m.kind === 'recap').length,
    welcomes: members.filter((m) => m.kind === 'welcome').length,
    packs: members.filter((m) => m.plan === 'pack').length,
    totalClasses: studio.totalClasses,
    totalHours: Math.round(studio.totalMinutes / 60),
    topClasses: studio.hasClassNames ? topClasses : [],
    busiestDay: mode(studio.weekdayCounts),
    busiestHour: studio.hasTimes ? mode(studio.hourCounts) : null,
    busiestMonth: mode(studio.monthCounts),
    hasTimes: studio.hasTimes,
    hasInstructors: studio.hasInstructors,
    hasClassNames: studio.hasClassNames,
    dayFirst,
    problems,
  };
  return { members, summary };
}

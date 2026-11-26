// Lenient date/time parsing for booking-system exports.
// Returns { y, mo (1-12), d, h (0-23 or null), mi } or null. No time zones:
// exports are in the studio's local time and we keep them that way.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function validDate(y, mo, d) {
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function fixYear(y) {
  y = Number(y);
  if (y < 100) y += 2000;
  return y;
}

export function parseTime(str) {
  if (!str) return null;
  let src = String(str);
  // "2026-03-14T18:00:00" in a time column: keep only the part after the T.
  const iso = src.match(/\d{4}-\d{1,2}-\d{1,2}[T\s](.*)$/);
  if (iso) src = iso[1];
  const m = src.match(/(?:^|\D)(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*([ap])\.?\s*m?\.?(?![a-z])/i)
    || src.match(/(?:^|\D)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?!\d)/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  }
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

// dayFirst: treat 03/04/2026 as 3 April instead of March 4.
export function parseDate(str, { dayFirst = false } = {}) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  let y, mo, d, rest = '';

  let m;
  // ISO timestamps with a zone (Z or +02:00) are converted to this browser's local time,
  // which for an owner using the tool is normally the studio's time zone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt)) return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes() };
  }
  if ((m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(.*)$/))) {
    [, y, mo, d, rest] = m;
  } else if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(.*)$/))) {
    const a = Number(m[1]), b = Number(m[2]);
    y = fixYear(m[3]); rest = m[4];
    if (dayFirst) { d = a; mo = b; } else { mo = a; d = b; }
  } else if ((m = s.match(/^(?:[a-z]+,?\s+)?([a-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{4}|\d{2}(?!\d))(.*)$/i))) {
    mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    d = m[2]; y = fixYear(m[3]); rest = m[4];
  } else if ((m = s.match(/^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2}(?!\d))(.*)$/i))) {
    mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
    d = m[1]; y = fixYear(m[3]); rest = m[4];
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date (days since 1899-12-30), sometimes left in CSV exports.
    const serial = Number(s);
    if (serial < 20000 || serial > 80000) return null;
    const ms = Math.round((serial - 25569) * 86400000);
    const dt = new Date(ms);
    const frac = serial - Math.floor(serial);
    const mins = Math.round(frac * 1440);
    return {
      y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
      h: frac ? Math.floor(mins / 60) % 24 : null, mi: frac ? mins % 60 : 0,
    };
  } else return null;

  if (!mo) return null;
  y = Number(y); mo = Number(mo); d = Number(d);
  if (!validDate(y, mo, d)) return null;
  const t = parseTime(rest.replace(/^T/, ' '));
  return { y, mo, d, h: t ? t.h : null, mi: t ? t.mi : 0 };
}

// Looks at sample values to guess whether dates are day-first.
export function guessDayFirst(values) {
  let dayFirstVotes = 0, monthFirstVotes = 0;
  for (const v of values) {
    const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirstVotes++;
    else if (b > 12 && a <= 12) monthFirstVotes++;
  }
  return dayFirstVotes > monthFirstVotes;
}

// Days since 1970-01-01 for a parsed date (UTC calendar math, no zones).
export function dayNumber(p) {
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86400000);
}

// 0 = Monday ... 6 = Sunday
export function weekday(p) {
  return (dayNumber(p) + 3) % 7; // 1970-01-01 was a Thursday
}

// Monday-based week number since the epoch.
export function weekNumber(p) {
  return Math.floor((dayNumber(p) + 3) / 7);
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function formatTime(minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60), mi = minutesOfDay % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${ap}`;
}

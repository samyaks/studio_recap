// Finds the header row and guesses which column holds which field.

export const FIELDS = [
  { key: 'memberId', label: 'Member ID', required: false },
  { key: 'fullName', label: 'Member name', required: false },
  { key: 'firstName', label: 'First name', required: false },
  { key: 'lastName', label: 'Last name', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'date', label: 'Class date', required: true },
  { key: 'time', label: 'Class time', required: false },
  { key: 'className', label: 'Class name', required: false },
  { key: 'instructor', label: 'Instructor', required: false },
  { key: 'duration', label: 'Class length (minutes)', required: false },
  { key: 'plan', label: 'Membership or pass', required: false },
  { key: 'status', label: 'Attendance status', required: false },
];

const RULES = {
  email: [/^e-?mail( address)?$/, /e-?mail/],
  firstName: [/^first( name)?$/, /first\s*name|given\s*name/],
  lastName: [/^last( name)?$/, /last\s*name|surname|family\s*name/],
  fullName: [/^(client|member|customer|student|attendee|athlete|full|user|contact)\s*name$/, /^(client|member|customer|student|attendee|athlete|name|user|contact)$/, /\bname\b/],
  memberId: [/^(client|member|customer|student|athlete|user|contact)\s*(id|#|number|no\.?)$/, /^(id|barcode)$/],
  date: [/^((class|visit|session|attendance|service|event)\s*(start\s*)?)?date(\s*(\/|and|&)\s*time)?$/, /date|^day$|^start(\s*time)?$|start\s*date/],
  time: [/^(class|start|visit|session)?\s*time$/, /start\s*time|^time\b/],
  className: [/^(class|session|event|service)(\s*name)?$/, /class\s*name|class\b|service\s*name|session\s*name|event\s*name|offering|description/],
  instructor: [/^(instructor|teacher|coach|trainer)(\s*name)?$/, /instructor|teacher|coach|trainer|staff/],
  duration: [/^(duration|length)(\s*\(?(min|minutes|mins)\)?)?$/, /duration|length|minutes|mins/],
  plan: [/^(pricing option|membership|plan|pass|package|series)(\s*(name|type))?$/, /pricing\s*option|membership|plan|pass\b|package|series|payment\s*method/],
  status: [/^(status|attendance|attendance status|visit status|booking status|signed in|checked in|attended|check[\s-]?in status)$/, /status|attend|signed\s*in|checked\s*in|cancel+ed|no[\s_-]?show/],
};

const ORDER = ['email', 'firstName', 'lastName', 'memberId', 'instructor', 'duration', 'plan', 'status', 'time', 'date', 'className', 'fullName'];

function norm(h) {
  return String(h || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function guessMapping(header) {
  const used = new Set();
  const mapping = {};
  for (const tier of [0, 1, 2]) {
    for (const key of ORDER) {
      if (mapping[key] != null) continue;
      const rule = RULES[key][tier];
      if (!rule) continue;
      for (let i = 0; i < header.length; i++) {
        if (used.has(i)) continue;
        const h = norm(header[i]);
        if (!h) continue;
        if (key === 'className' && /date|time|type|id\b/.test(h)) continue;
        if (key === 'date' && /^time$|update|birth|dob|created|purchase|expir|join|since|book|sale|sign\s*up|modified|payment|renew|end/.test(h)) continue;
        if (key === 'fullName' && /class|service|instructor|teacher|staff|pricing|event|studio|location|session|room|program|product|plan|package|membership|pass|series|resource|file|report/.test(h)) continue;
        if (key === 'status' && /visit\s*type|class\s*type|payment/.test(h)) continue;
        if (rule.test(h)) { mapping[key] = i; used.add(i); break; }
      }
    }
  }
  // A bare "ID" is often the booking's ID, not the person's, so trust it only
  // when nothing else identifies members.
  if (mapping.memberId != null && /^(id|barcode)$/.test(norm(header[mapping.memberId]))
      && (mapping.email != null || mapping.fullName != null || mapping.firstName != null)) {
    delete mapping.memberId;
  }
  return mapping;
}

function headerScore(row) {
  const mapping = guessMapping(row);
  return Object.keys(mapping).length;
}

// Some exports put a report title or filters above the real header.
export function findHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const nonEmpty = rows[i].filter((c) => c).length;
    if (nonEmpty < 2) continue;
    const score = headerScore(rows[i]);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

function titleCase(s) {
  if (!s) return s;
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'\-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', '✓', 'checked']);
const NO = new Set(['no', 'n', 'false', '0']);

// A status column that only says yes/no becomes "attended"/"absent". If the
// column is about cancelling ("Cancelled", "No show"), yes means it didn't happen.
function statusNormalizer(rows, mapping, header) {
  const col = mapping.status;
  if (col == null) return (v) => v;
  const values = new Set();
  for (const r of rows.slice(0, 5000)) {
    const v = String(r[col] || '').trim().toLowerCase();
    if (v) values.add(v);
  }
  const boolean = values.size > 0 && [...values].every((v) => YES.has(v) || NO.has(v));
  if (!boolean) return (v) => v;
  const inverted = /cancel|no[\s_-]?show|absent|missed/i.test(String((header || [])[col] || ''));
  return (v) => {
    const k = String(v || '').trim().toLowerCase();
    if (!k) return '';
    const yes = YES.has(k);
    return (inverted ? !yes : yes) ? 'attended' : 'absent';
  };
}

// Turns raw rows into visit records using the mapping.
export function applyMapping(rows, mapping, header) {
  const get = (r, key) => (mapping[key] != null ? (r[mapping[key]] || '').trim() : '');
  const normStatus = statusNormalizer(rows, mapping, header);
  return rows.map((r) => {
    let first = get(r, 'firstName');
    let last = get(r, 'lastName');
    const full = get(r, 'fullName');
    if (!first && full) {
      if (full.includes(',')) {
        const [l, f] = full.split(',');
        first = (f || '').trim().split(/\s+/)[0];
        last = last || l.trim();
      } else {
        const parts = full.split(/\s+/);
        first = parts[0];
        last = last || parts.slice(1).join(' ');
      }
    }
    const email = get(r, 'email').toLowerCase();
    const id = get(r, 'memberId');
    const key = id ? 'id:' + id : email ? 'em:' + email : (first || last) ? 'nm:' + (first + ' ' + last).toLowerCase().trim() : '';
    return {
      key,
      firstName: titleCase(first),
      lastName: titleCase(last),
      email,
      date: get(r, 'date'),
      time: get(r, 'time'),
      className: get(r, 'className'),
      instructor: get(r, 'instructor'),
      duration: get(r, 'duration'),
      plan: get(r, 'plan'),
      status: normStatus(get(r, 'status')),
    };
  });
}

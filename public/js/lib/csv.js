// Small CSV reader/writer. Handles quotes, embedded commas/newlines, BOM,
// and comma, semicolon or tab delimiters.

// Picks the delimiter that splits the first lines most consistently, so a
// title row like "Attendance report, 2026" doesn't fool a semicolon file.
function detectDelimiter(text) {
  const lines = [];
  let cur = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length && i < 20000 && lines.length < 12; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (cur[','] + cur[';'] + cur['\t'] > 0) lines.push(cur);
      cur = { ',': 0, ';': 0, '\t': 0 };
    } else if (!inQuotes && ch in cur) cur[ch]++;
  }
  if (cur[','] + cur[';'] + cur['\t'] > 0) lines.push(cur);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t']) {
    const counts = lines.map((l) => l[d]).filter((c) => c > 0);
    if (!counts.length) continue;
    const freq = new Map();
    for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
    const consistent = Math.max(...freq.values());
    const score = consistent * 1000 + counts.reduce((a, b) => a + b, 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCSV(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      // Quotes only start a quoted field at its beginning; a stray " inside is kept as text.
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

// Guards against spreadsheet formula injection when the owner opens the file.
function safeCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(safeCell).join(',')).join('\r\n') + '\r\n';
}

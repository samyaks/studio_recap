// Two members an unpaid studio can view and send. Most visits first; the other
// is the busiest welcome-back. If the busiest member is already a welcome, the
// other is the next person, so two still show when the file has two or more.

function byVisitsThenKey(a, b) {
  if (a.total !== b.total) return b.total - a.total;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

export function pickSampleMembers(members) {
  if (members.length === 0) return [];
  const sorted = members.slice().sort(byVisitsThenKey);
  const first = sorted[0];
  const second = first.kind === 'welcome'
    ? sorted.find((m) => m.key !== first.key)
    : sorted.find((m) => m.kind === 'welcome' && m.key !== first.key);
  return second ? [first, second] : [first];
}

// Forgiving search shared by the app, the quick search, Stream Deck and phone remote:
// ignores spaces/dashes ("proq" → Pro-Q 3), matches word starts and letters in order ("fbpq"),
// and tolerates one typo per word ("valhala" → Valhalla). Returns a score (0 = no match).
(function (root) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9äöüß]+/i).map(norm).filter(Boolean);

  // Letters of t appear in s in this order.
  function subsequence(t, s) {
    let i = 0;
    for (const c of s) if (c === t[i]) i++;
    return i === t.length;
  }
  // Damerau-Levenshtein distance, stops early above 1.
  function within1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length] <= 1;
  }

  // entry: { name, vendor, category, sub, type, extra } – extra = tags/notes/format text.
  function score(entry, query) {
    const tokens = String(query || '').trim().split(/\s+/).map(norm).filter(Boolean);
    if (!tokens.length) return 1;
    const name = norm(entry.name);
    const nameWords = words(entry.name);
    const other = norm(`${entry.vendor} ${entry.category} ${entry.sub} ${entry.type} ${entry.extra || ''}`);
    const otherWords = words(`${entry.vendor} ${entry.category} ${entry.sub} ${entry.extra || ''}`);
    let total = 0;
    for (const t of tokens) {
      let s = 0;
      if (name.startsWith(t)) s = 100;
      else if (nameWords.some((w) => w.startsWith(t))) s = 80;
      else if (name.includes(t)) s = 60;
      else if (t.length >= 4 && nameWords.some((w) => within1(t, w) || within1(t, w.slice(0, t.length)))) s = 45;
      else if (other.includes(t)) s = 30;
      else if (t.length >= 4 && otherWords.some((w) => within1(t, w))) s = 20;
      else if (t.length >= 3 && subsequence(t, name)) s = 15;
      if (!s) return 0;
      total += s;
    }
    return total;
  }

  const api = { score, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Search = api;
})(typeof window !== 'undefined' ? window : globalThis);

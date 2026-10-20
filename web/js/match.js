/* Serial matching. Pure functions, no DOM, so they can be tested in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Match = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Letters that OCR often swaps with digits. Both sides are mapped the same way.
  var CONFUSE = { O: '0', Q: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };

  function norm(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function canon(s) {
    return norm(s).replace(/[OQILSBZG]/g, function (c) { return CONFUSE[c]; });
  }

  // Edit distance that gives up once it passes max.
  function editDistance(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  // Turn raw OCR text into candidate tokens: single words, runs of up to six words, and runs that
  // continue onto the next line (a label such as "LED Wall 47" over "BOX 1").
  function tokensFromText(text) {
    var seen = {}, out = [], flat = [];
    function add(raw, words) {
      var k = norm(raw);
      if (k.length < 3 || k.length > 40 || seen[k]) return;
      seen[k] = 1;
      out.push({ raw: raw, k: k, c: canon(k), n: words || 1 });
    }
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var words = line.split(/\s+/).map(function (w) {
        return w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      }).filter(Boolean);
      words.forEach(function (w) { add(w, 1); });
      for (var i = 0; i + 1 < words.length; i++) add(words[i] + words[i + 1], 2);
      if (words.length >= 3 && words.length <= 6) add(words.join(''), words.length);
      words.forEach(function (w) { flat.push(w); });
    });
    // Windows over all words in reading order. The cap keeps the count small on busy photos.
    if (flat.length > 60) flat = flat.slice(0, 60);
    for (var i = 0; i < flat.length; i++) {
      var acc = flat[i];
      for (var n = 2; n <= 6 && i + n <= flat.length; n++) {
        acc += flat[i + n - 1];
        if (acc.length > 40) break;
        add(acc, n);
      }
    }
    return out;
  }

  // Build a lookup over serial and alternate id of every item.
  function buildIndex(items) {
    var entries = [];
    items.forEach(function (it) {
      [['serial', it.serial], ['alt', it.alt]].forEach(function (p) {
        var kn = norm(p[1]);
        if (kn.length >= 3) entries.push({ item: it, kn: kn, kc: canon(kn), field: p[0] });
      });
    });
    return { entries: entries };
  }

  // Score every item against the tokens. Highest score per item wins.
  function findMatches(index, tokens) {
    var best = {};
    function offer(entry, score, how, tok) {
      var cur = best[entry.item.id];
      if (!cur || score > cur.score) best[entry.item.id] = { item: entry.item, score: score, how: how, token: tok.raw };
    }
    index.entries.forEach(function (e) {
      var len = e.kc.length;
      var maxd = len >= 9 ? 2 : len >= 6 ? 1 : 0;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.k === e.kn) { offer(e, 100, 'exact', t); continue; }
        if (t.c === e.kc) { offer(e, 96, 'exact', t); continue; }
        if (len >= 6 && t.c.length > len && t.c.indexOf(e.kc) !== -1) { offer(e, 92, 'inside', t); continue; }
        if (maxd > 0 && Math.abs(t.c.length - len) <= maxd) {
          var d = editDistance(t.c, e.kc, maxd);
          if (d <= maxd) offer(e, 90 - 12 * d, 'close', t);
        }
      }
    });
    var list = Object.keys(best).map(function (k) { return best[k]; });
    list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  // sure: mark it. choose: ask. none: nothing found.
  function decide(matches) {
    if (!matches.length) return { type: 'none', list: [] };
    var top = matches[0];
    if (top.score >= 96 && (matches.length === 1 || matches[1].score < top.score - 8)) {
      return { type: 'sure', item: top.item, list: matches.slice(0, 5) };
    }
    return { type: 'choose', list: matches.slice(0, 6) };
  }

  // Typed search: serial, alt id, description, group. Prefix matches rank first.
  function searchItems(items, q, limit) {
    var raw = String(q || '').trim().toLowerCase();
    var key = norm(q);
    if (!raw) return [];
    var res = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i], rank = 9;
      var sn = norm(it.serial), an = norm(it.alt);
      if (key && (sn === key || an === key)) rank = 0;
      else if (key && (sn.indexOf(key) === 0 || an.indexOf(key) === 0)) rank = 1;
      else if (key && (sn.indexOf(key) !== -1 || an.indexOf(key) !== -1)) rank = 2;
      else if (key && canon(sn).indexOf(canon(key)) !== -1 && key.length >= 3) rank = 3;
      else if ((it.desc || '').toLowerCase().indexOf(raw) !== -1) rank = 4;
      else if ((it.group || '').toLowerCase().indexOf(raw) !== -1) rank = 5;
      if (rank < 9) res.push({ item: it, rank: rank });
    }
    res.sort(function (a, b) { return a.rank - b.rank; });
    return res.slice(0, limit || 30).map(function (r) { return r.item; });
  }

  return { norm: norm, canon: canon, editDistance: editDistance, tokensFromText: tokensFromText,
           buildIndex: buildIndex, findMatches: findMatches, decide: decide, searchItems: searchItems };
});

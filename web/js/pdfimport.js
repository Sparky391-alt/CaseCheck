/* Reads equipment PDFs (Bill of Materials and Packing List) into rows.
   Pure logic on text items so it runs in Node tests and in the app.
   An item is { s: string, x: number, y: number, w: number } with y growing upward (PDF space). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // Group items of one page into lines (same baseline), sorted left to right.
  function toLines(items) {
    var its = items.filter(function (i) { return clean(i.s) !== ''; }).sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    its.forEach(function (it) {
      var ln = lines[lines.length - 1];
      if (ln && Math.abs(ln.y - it.y) < 2.2) ln.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }
  function lineText(l) { return clean(l.items.map(function (i) { return i.s; }).join(' ')); }

  // Find the table header on a page and return column starts.
  function findHeader(lines) {
    for (var k = 0; k < lines.length; k++) {
      var l = lines[k], get = {};
      l.items.forEach(function (i) { get[clean(i.s)] = i; });
      if (!(get['Quantity'] && get['Description'] && get['Manufacturer'])) continue;
      // The header spans two baselines. Gather every item within 14 points of the Quantity word.
      var near = {}, all = [];
      lines.forEach(function (ln) { ln.items.forEach(function (i) { if (Math.abs(i.y - l.y) < 14) all.push(i); }); });
      all.forEach(function (i) { var t = clean(i.s); if (!near[t] || i.y > near[t].y) near[t] = i; });
      var eq = near['Equipment label'] || near['Equipment'], pk = near['Packaged'];
      if (!eq || !pk || !near['Width'] || !near['Weight']) continue;
      var top = Math.min.apply(null, all.filter(function (i) { return /^(Quantity|Description|Manufacturer|Packaged|Equipment|Equipment label|label|Width|Length|Height|Weight|\(cm\)|\(kg\))$/.test(clean(i.s)); }).map(function (i) { return i.y; }));
      var colRight = function (name) {
        var i = near[name], r = i.x + i.w;
        all.forEach(function (j) { if (/^\((cm|kg)\)$/.test(clean(j.s)) && j.x > i.x - 14 && j.x < i.x + 30) r = Math.max(r, j.x + j.w); });
        return r;
      };
      return { top: top, desc: get['Description'].x, mfr: get['Manufacturer'].x, label: eq.x, pack: pk.x,
               num: ['Width', 'Length', 'Height', 'Weight'].map(colRight) };
    }
    return null;
  }

  function meta(lines) {
    var m = { kind: '', number: '', place: '', code: '', dates: '', lang: '' };
    var txt = lines.map(lineText);
    var head = txt.slice(0, 3).join(' ');
    if (/Bill of Materials/i.test(head)) m.kind = 'BOM'; else if (/Packing List/i.test(head)) m.kind = 'PL';
    txt.forEach(function (t) {
      var r;
      if ((r = /^Receiving location description:\s*(.+)$/.exec(t))) m.place = r[1];
      else if ((r = /^Receiving location event code:\s*(.+)$/.exec(t))) m.code = r[1];
      else if ((r = /^Event date\(s\):\s*(.+)$/.exec(t))) m.dates = r[1];
      else if ((r = /^Number:\s*(\S+)$/.exec(t)) && !m.number) m.number = r[1];
    });
    if (!m.place) {
      // Packing list: "Receiving location:" is a column. Its name, code and dates sit under it.
      for (var i = 0; i < lines.length; i++) {
        var hit = lines[i].items.filter(function (j) { return /^Receiving location:/.test(clean(j.s)); })[0];
        if (!hit) continue;
        var col = [];
        for (var k = i + 1; k < Math.min(i + 4, lines.length); k++) {
          col.push(clean(lines[k].items.filter(function (j) { return j.x >= hit.x - 3; }).map(function (j) { return j.s; }).join(' ')));
        }
        m.place = col[0] || ''; m.code = col[1] || ''; m.dates = col[2] || '';
        break;
      }
    }
    // Organisation block: the right hand side of the first few lines.
    m.org = [];
    for (var o = 0; o < Math.min(lines.length, 6); o++) {
      if (lines[o].items.some(function (j) { return /^(Number:|Receiving|Sending)/.test(clean(j.s)); })) break;
      var right = clean(lines[o].items.filter(function (j) { return j.x > 250; }).map(function (j) { return j.s; }).join(' '));
      if (right) m.org.push(right);
    }
    m.overseer = '';
    lines.forEach(function (ln) {
      ln.items.forEach(function (j, ix) {
        var r = /Program overseer:\s*(.*)$/.exec(clean(j.s));
        if (r && !m.overseer) m.overseer = r[1] || clean((ln.items[ix + 1] || { s: '' }).s);
      });
    });
    if (!m.overseer) { txt.forEach(function (t) { var r = /Program overseer:\s*(.+)$/.exec(t); if (r && !m.overseer) m.overseer = r[1]; }); }
    var lg = /\(([^()]+)\)\s*$/.exec(m.place);
    m.lang = lg ? lg[1].trim() : '';
    return m;
  }

  // pages: array of arrays of items. Returns { meta, rows }.
  function parse(pages) {
    var rows = [], cur = null, hdr = null, firstLines = null;
    pages.forEach(function (items, p) {
      var lines = toLines(items);
      if (p === 0) firstLines = lines;
      var h = findHeader(lines);
      if (h) hdr = h;
      if (!hdr) return;
      // On pages without a header, no data above the first row is skipped.
      lines.forEach(function (l, li) {
        if (h && l.y > h.top - 4) return;
        var t = lineText(l);
        if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(t) && /Page \d+ of \d+/.test(t)) return;
        if (/Page \d+ of \d+$/.test(t)) return;
        var first = l.items[0], isNew = /^\d+$/.test(clean(first.s)) && first.x + first.w < hdr.desc;
        if (isNew) {
          cur = { qty: parseInt(clean(first.s), 10), desc: [], mfr: [], label: [], pack: [], dim: [[], [], [], []] };
          rows.push(cur);
        }
        if (!cur) return;
        l.items.forEach(function (i) {
          var s = clean(i.s); if (!s) return;
          if (isNew && i === first) return;
          if (i.x < hdr.desc - 3) return;
          if (i.x < hdr.mfr - 3) cur.desc.push(s);
          else if (i.x < hdr.label - 3) cur.mfr.push(s);
          else if (i.x < hdr.pack - 3) cur.label.push(s);
          else if (i.x + i.w < hdr.num[0] - 8 || (i.x < hdr.num[0] - 28)) cur.pack.push(s);
          else {
            var r = i.x + i.w, best = 0, bd = 1e9;
            hdr.num.forEach(function (c, k) { var d = Math.abs(c - r); if (d < bd) { bd = d; best = k; } });
            cur.dim[best].push(s);
          }
        });
      });
    });
    var out = rows.map(function (r) {
      var j = function (a) { return clean(a.join(' ')); };
      var d = r.dim.map(j);
      return { qty: r.qty, desc: j(r.desc), mfr: j(r.mfr), label: j(r.label), pack: j(r.pack),
               w: d[0], l: d[1], h: d[2], kg: d[3] };
    });
    return { meta: meta(firstLines || []), rows: out };
  }

  function nk(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function rowKey(r) { return r.label ? 'L:' + nk(r.label) : 'D:' + nk(r.desc); }
  function tally(rows) {
    var m = {};
    rows.forEach(function (r) { var k = rowKey(r); m[k] = m[k] || { qty: 0, row: r }; m[k].qty += r.qty; });
    return m;
  }

  // docs: [{ name, meta, rows }]. One group for each receiving location, with its BOM and packing list side by side.
  function group(docs) {
    var by = {}, order = [];
    docs.forEach(function (d) {
      var key = d.meta.code || d.meta.place || d.name;
      if (!by[key]) { by[key] = { key: key, lang: d.meta.lang, place: d.meta.place, code: d.meta.code, dates: d.meta.dates, bom: null, pl: null }; order.push(key); }
      var g = by[key];
      if (d.meta.kind === 'PL') g.pl = d; else g.bom = g.bom || d;
      if (!g.lang) g.lang = d.meta.lang;
    });
    return order.map(function (k) {
      var g = by[k], base = g.bom || g.pl;
      g.rows = base.rows;
      g.lines = base.rows.length;
      g.units = base.rows.reduce(function (a, r) { return a + r.qty; }, 0);
      g.diff = [];
      if (g.bom && g.pl) {
        var a = tally(g.bom.rows), b = tally(g.pl.rows);
        Object.keys(a).forEach(function (kk) {
          if (!b[kk]) g.diff.push('Packing list is missing ' + (a[kk].row.label || a[kk].row.desc.slice(0, 40)));
          else if (a[kk].qty !== b[kk].qty) g.diff.push((a[kk].row.label || a[kk].row.desc.slice(0, 40)) + ': list says ' + a[kk].qty + ', packing list says ' + b[kk].qty);
        });
        Object.keys(b).forEach(function (kk) {
          if (!a[kk]) g.diff.push('Bill of materials is missing ' + (b[kk].row.label || b[kk].row.desc.slice(0, 40)));
        });
      }
      return g;
    });
  }

  // First part of a description, for list rows.
  function shortDesc(d) {
    var t = clean(d).split(';')[0];
    return t.length > 70 ? t.slice(0, 68).trim() + '..' : t;
  }

  // Item fields for one parsed row. Rows with a label are one case each.
  function itemFields(r, meta) {
    var size = [r.w, r.l, r.h].filter(Boolean).join(' x ');
    var raw = [['Contents', r.desc], ['Maker', r.mfr], ['Packed in', r.pack === 'None' ? '' : r.pack],
      ['Size cm', size], ['Weight kg', r.kg], ['Quantity', r.qty > 1 ? String(r.qty) : '']];
    return {
      serial: r.label, desc: shortDesc(r.desc), group: r.pack === 'None' ? '' : r.pack,
      qty: r.label ? 1 : r.qty, raw: raw.filter(function (p) { return p[1]; })
    };
  }

  return { parse: parse, group: group, itemFields: itemFields, shortDesc: shortDesc, toLines: toLines, lineText: lineText, clean: clean };
});

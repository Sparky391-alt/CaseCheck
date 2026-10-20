/* Receiving and check out reports as PDF. Laid out like the bill of materials and packing list.
   Needs the jsPDF constructor. Pure data in, document out, so it runs in Node tests too. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Report = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp(ts) {
    var d = new Date(ts), h = d.getHours() % 12 || 12;
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + h + ':' + p2(d.getMinutes()) + (d.getHours() < 12 ? ' AM' : ' PM');
  }
  function shortTime(ts) { if (!ts) return ''; var d = new Date(ts); return DAYS[d.getDay()].slice(0, 3) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  // The built in PDF fonts cover Latin 1 only.
  function safe(s) { return String(s == null ? '' : s).replace(/[^\u0009\u000A -~ -ÿ]/g, '?'); }
  function rawOf(it, k) { var p = (it.raw || []).filter(function (r) { return r[0] === k; })[0]; return p ? p[1] : ''; }

  // How one item stands for this kind of report. type is 'in' (receiving) or 'out' (check out).
  function standing(it, type) {
    var q = (it.qty || 1), bulk = q > 1;
    if (type === 'in') {
      if (bulk) { if ((it.got || 0) >= q) return { ok: true, text: 'Received', time: it.inAt }; if (it.got > 0) return { ok: false, part: true, text: it.got + ' of ' + q + ' received' }; return { ok: false, text: 'MISSING' }; }
      return it.status === 'wait' ? { ok: false, text: 'MISSING' } : { ok: true, text: 'Received', time: it.inAt };
    }
    if (bulk) { if ((it.gone || 0) >= q) return { ok: true, text: 'Collected', time: it.outAt }; if (it.gone > 0) return { ok: false, part: true, text: it.gone + ' of ' + q + ' collected' }; return { ok: false, text: 'NOT COLLECTED' }; }
    return it.status === 'out' ? { ok: true, text: 'Collected', time: it.outAt } : { ok: false, text: 'NOT COLLECTED' };
  }

  function summary(items, type) {
    var s = { lines: 0, ok: 0, bad: 0, part: 0, unl: 0 };
    items.forEach(function (it) {
      if (it.unlisted) { s.unl++; return; }
      s.lines++;
      var st = standing(it, type);
      if (st.ok) s.ok++; else if (st.part) { s.part++; s.bad++; } else s.bad++;
    });
    return s;
  }

  // opts: { JsPDF, type, project, items, zones:[names], comment, by, now }
  function build(opts) {
    var type = opts.type === 'out' ? 'out' : 'in';
    var proj = opts.project, doc = new opts.JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    var W = 595, H = 842, M = 36, R = 559, FOOT = 800;
    var COL = { qty: 74, desc: 78.7, mfr: 206.4, label: 266.9, pack: 336, stat: 392, com: 452 };
    var LH = 10.4;
    var title = type === 'in' ? 'Receiving Report' : 'Check-out Report';
    var org = (proj.org && proj.org.length) ? proj.org : [];
    var y = 0;

    function txt(s, x, yy, o) { doc.text(safe(s), x, yy, o || {}); }
    function pageHeader() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
      txt(title, M, 58);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      org.slice(0, 5).forEach(function (l, i) { txt(l, 325, 50 + i * 10.5); });
      y = 98;
    }
    function tableHead() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setDrawColor(0); doc.setLineWidth(0.6);
      txt('Quantity', M + 1, y); txt('Description', COL.desc, y); txt('Manufacturer', COL.mfr, y); txt('Equipment label', COL.label, y);
      txt('Packaged', COL.pack, y); txt(type === 'in' ? 'Received' : 'Collected', COL.stat, y); txt('Comment', COL.com, y);
      y += 5; doc.line(M, y, R, y); y += 11;
      doc.setFont('helvetica', 'normal');
    }
    function newPage(withHead) { doc.addPage(); pageHeader(); if (withHead) tableHead(); }
    function need(h, withHead) { if (y + h > FOOT) newPage(withHead); }

    pageHeader();

    // Details block, same order as the bill of materials.
    var zones = opts.zones, metaFor = function (z) { return (proj.zoneMeta && proj.zoneMeta[z]) || {}; };
    var first = metaFor(zones[0]);
    var detail = [
      ['Receiving location:', zones.length === 1 ? (first.place || zones[0]) : (proj.name + ' (' + zones.join(', ') + ')')],
      ['Event code:', zones.length === 1 ? (first.code || '') : ''],
      ['Event date(s):', first.dates || ''],
      ['Program overseer:', first.overseer || ''],
      ['Bill of materials:', zones.length === 1 ? (first.bom || '') : ''],
      ['Packing list:', zones.length === 1 ? (first.pl || '') : ''],
      ['Checked by:', opts.by || '']
    ].filter(function (d) { return d[1]; });
    doc.setFontSize(9);
    detail.forEach(function (d) {
      doc.setFont('helvetica', 'normal'); txt(d[0], M, y); txt(d[1], 162, y); y += 16;
    });
    y += 4;

    // Totals across everything in this report.
    var all = opts.items.filter(function (i) { return zones.indexOf(i.zone) !== -1; });
    var tot = summary(all, type);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    txt((type === 'in' ? 'Received ' : 'Collected ') + tot.ok + ' of ' + tot.lines + ' lines' + (tot.bad ? '   |   ' + tot.bad + (type === 'in' ? ' missing or short' : ' still on site') : '   |   Complete') + (tot.unl ? '   |   ' + tot.unl + ' not on the list' : ''), M, y);
    y += 20;

    zones.forEach(function (z) {
      var zi = all.filter(function (i) { return i.zone === z && !i.unlisted; });
      var mz = metaFor(z);
      need(70, false);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      txt(mz.place || z, M, y); if (mz.code) txt(mz.code, R, y, { align: 'right' }); y += 14;
      var sz = summary(zi, type);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      txt((type === 'in' ? 'Received ' : 'Collected ') + sz.ok + ' of ' + sz.lines + ' lines', M, y); y += 14;
      tableHead();
      zi.forEach(function (it) { row(it); });
      y += 8;
    });

    var unl = all.filter(function (i) { return i.unlisted; });
    if (unl.length) {
      need(60, false);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); txt('Not on the list', M, y); y += 14;
      tableHead();
      unl.forEach(function (it) { row(it); });
      y += 8;
    }

    function row(it) {
      var st = standing(it, type), q = it.qty || 1;
      var contents = rawOf(it, 'Contents') || it.desc || '';
      var lines = {
        desc: doc.splitTextToSize(safe(contents), COL.mfr - COL.desc - 4),
        mfr: doc.splitTextToSize(safe(rawOf(it, 'Maker')), COL.label - COL.mfr - 4),
        label: doc.splitTextToSize(safe(it.serial || ''), COL.pack - COL.label - 4),
        pack: doc.splitTextToSize(safe(rawOf(it, 'Packed in') || it.group || 'None'), COL.stat - COL.pack - 4),
        stat: doc.splitTextToSize(safe(st.text + (st.time ? ' ' + shortTime(st.time) : '')), COL.com - COL.stat - 4),
        com: doc.splitTextToSize(safe(it.note && it.note !== 'Not on the original list' ? it.note : ''), R - COL.com)
      };
      var n = Math.max(lines.desc.length, lines.mfr.length, lines.label.length, lines.pack.length, lines.stat.length, lines.com.length, 1);
      need(n * LH + 4, true);
      doc.setFontSize(8);
      if (!st.ok) { doc.setFillColor(238, 238, 238); doc.rect(M, y - 8, R - M, n * LH + 1.5, 'F'); }
      doc.setTextColor(0);
      doc.setFont('helvetica', 'normal');
      txt(String(q), COL.qty, y, { align: 'right' });
      doc.text(lines.desc, COL.desc, y); doc.text(lines.mfr, COL.mfr, y); doc.text(lines.label, COL.label, y); doc.text(lines.pack, COL.pack, y);
      doc.setFont('helvetica', st.ok ? 'normal' : 'bold'); doc.text(lines.stat, COL.stat, y);
      doc.setFont('helvetica', 'normal'); doc.text(lines.com, COL.com, y);
      y += n * LH + 3;
    }

    // Damage and inside checks, with photos when they were supplied.
    var ph = opts.photos || {};
    function picture(key, x, yy, maxW, maxH) {
      var im = key && ph[key];
      if (!im) return null;
      var sc = Math.min(maxW / im.w, maxH / im.h), w = im.w * sc, hh = im.h * sc;
      try { doc.addImage(im.url, 'JPEG', x, yy, w, hh); } catch (e) { return null; }
      doc.setDrawColor(150); doc.setLineWidth(0.4); doc.rect(x, yy, w, hh);
      return { w: w, h: hh };
    }
    function section(title) {
      need(60, false);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0); txt(title, M, y); y += 6;
      doc.setDrawColor(0); doc.setLineWidth(0.6); doc.line(M, y, R, y); y += 14;
    }
    // One row: a picture on the left, text on the right.
    function photoRow(key, lines, bold) {
      var pw = 150, phh = 112, tx = M + (key ? pw + 12 : 0), tw = R - tx;
      var wrapped = doc.splitTextToSize(safe(lines.join('\n')), tw), th = wrapped.length * 11;
      var im = key && ph[key], h1 = Math.max(th, im ? phh : 0) + 10;
      need(h1, false);
      var got = picture(key, M, y - 8, pw, phh);
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(0);
      if (key && !got) { doc.setTextColor(110); txt('(photo not available)', M, y); doc.setTextColor(0); }
      doc.text(wrapped, tx, y);
      y += Math.max(th, got ? got.h : (key ? 12 : 0)) + 8;
    }
    var dmgItems = all.filter(function (i) { return i.dmg && i.dmg.length; });
    if (dmgItems.length) {
      var nd = dmgItems.reduce(function (n, i) { return n + i.dmg.length; }, 0);
      section('Damage report (' + nd + (nd === 1 ? ' photo)' : ' photos)'));
      dmgItems.forEach(function (it) {
        need(40, false);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); txt((it.serial || it.desc || 'Item') + '   ' + (it.zone || ''), M, y); y += 12;
        it.dmg.forEach(function (d) {
          photoRow(d.key, [(d.n || 'Damage') , shortTime(d.at) + (d.by ? '  ' + d.by : '')], false);
        });
      });
      y += 6;
    }
    var chkItems = all.filter(function (i) { return i.chk && i.chk.lines && i.chk.lines.length; });
    if (chkItems.length) {
      section('Inside checks');
      chkItems.forEach(function (it) {
        var c = { ok: 0, bad: 0, miss: 0, open: 0 };
        it.chk.lines.forEach(function (l) { if (l.v === 'ok') c.ok++; else if (l.v === 'bad') c.bad++; else if (l.v === 'miss') c.miss++; else c.open++; });
        need(34, false);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
        txt((it.serial || it.desc || 'Case') + '   ' + (it.zone || ''), M, y);
        doc.setFont('helvetica', 'normal');
        txt(c.ok + ' right, ' + c.bad + ' wrong, ' + c.miss + ' missing' + (c.open ? ', ' + c.open + ' not decided' : '') + (it.chk.doneAt ? '' : '  (not finished)'), R, y, { align: 'right' });
        y += 13;
        it.chk.lines.filter(function (l) { return l.v !== 'ok'; }).forEach(function (l) {
          photoRow(l.key, [(l.v === 'bad' ? 'WRONG' : l.v === 'miss' ? 'MISSING' : 'NOT DECIDED') + (l.dmg ? ', DAMAGED' : ''), l.n || ''].filter(Boolean), false);
        });
        y += 4;
      });
      y += 6;
    }

    // Comments and sign off.
    need(150, false);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); txt('Comments', M, y); y += 8;
    doc.setLineWidth(0.5); doc.setDrawColor(120);
    var cm = doc.splitTextToSize(safe(opts.comment || ''), R - M - 8);
    var boxH = Math.max(80, cm.length * 12 + 12);
    need(boxH + 70, false);
    doc.rect(M, y, R - M, boxH);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (cm.length) doc.text(cm, M + 5, y + 14);
    y += boxH + 30;
    doc.setDrawColor(0);
    txt('Checked by:', M, y); doc.line(M + 58, y + 2, M + 230, y + 2);
    txt('Signature:', 270, y); doc.line(270 + 48, y + 2, 270 + 190, y + 2);
    txt('Date:', 480, y); doc.line(480 + 26, y + 2, R, y + 2);

    // Footer on every page, like the source documents.
    var pages = doc.getNumberOfPages(), when = stamp(opts.now || Date.now());
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0);
      txt(when, M, 805); txt('Page ' + p + ' of ' + pages, R, 805, { align: 'right' });
    }
    return doc;
  }

  return { build: build, standing: standing, summary: summary, stamp: stamp };
});

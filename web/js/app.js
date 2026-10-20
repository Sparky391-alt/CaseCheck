/* Case Check screens. Home, import wizard, project (scan, list, zones, menu). */
'use strict';

var root = document.getElementById('app');
var P = null;     // the open project: { project, items, byId, index, ui }
var Imp = null;   // import wizard state
var S = null;     // scan screen state
var BOX = { x: 0.06, y: 0.36, w: 0.88, h: 0.26 };   // must match .reticle in app.css

/* ===================== data helpers ===================== */
function counts(items) {
  var c = { total: items.length, wait: 0, in: 0, out: 0, unl: 0 };
  items.forEach(function (i) { c[i.status === 'in' ? 'in' : i.status === 'out' ? 'out' : 'wait']++; if (i.unlisted) c.unl++; });
  return c;
}
function zoneInfo(name) {
  name = name || '';
  var zs = P.project.zones;
  var z = zs.find(function (x) { return x.name === name; });
  if (!z) {
    z = { name: name, color: name ? PALETTE[zs.length % PALETTE.length] : '#7C8B99' };
    if (name) { zs.push(z); Store.putProject(P.project); }
  }
  return z;
}
function zoneChip(name) {
  var z = zoneInfo(name);
  return h('span', { class: 'zone', style: { background: z.color, color: textOn(z.color), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' } }, name || 'No zone');
}
function nm(it) { return it.serial || it.desc || 'Item'; }
function bulk(it) { return (it.qty || 1) > 1; }
function statusBadge(it) {
  var txt = it.status === 'in' ? 'In' : it.status === 'out' ? 'Out' : 'Waiting', cls = it.status === 'in' ? 'in' : it.status === 'out' ? 'out' : 'wait';
  if (bulk(it)) {
    if (it.status === 'wait' && it.got > 0) { txt = 'In ' + it.got + '/' + it.qty; cls = 'in'; }
    else if (it.status === 'in' && it.gone > 0) { txt = 'Out ' + it.gone + '/' + it.qty; cls = 'out'; }
  }
  return h('span', { class: 'badge ' + cls }, txt);
}
// Items with a quantity above one, such as 8 drums, are counted by hand. This sets the status from the counts.
function syncQty(it) {
  var q = it.qty || 1;
  it.got = Math.max(0, Math.min(q, it.got || 0)); it.gone = Math.max(0, Math.min(it.got, it.gone || 0));
  if (it.gone >= q) { it.status = 'out'; it.outAt = it.outAt || Date.now(); }
  else if (it.got >= q) { it.status = 'in'; it.inAt = it.inAt || Date.now(); it.outAt = null; }
  else { it.status = 'wait'; it.outAt = null; if (!it.got) it.inAt = null; else it.inAt = it.inAt || Date.now(); }
}
function reindex() {
  P.byId = {};
  P.items.forEach(function (i) { P.byId[i.id] = i; });
  P.index = Match.buildIndex(P.items);
}
async function loadProject(id) {
  var ps = await Store.listProjects();
  var project = ps.find(function (p) { return p.id === id; });
  var items = await Store.getItems(id);
  items.sort(function (a, b) { return a.ord - b.ord; });
  var keep = P && P.project.id === id ? P.ui : null;
  P = { project: project, items: items, byId: {}, index: null, ui: keep || { q: '', filter: 'all', zone: null, limit: 100 } };
  reindex();
}
async function openProject(id) {
  await loadProject(id);
  goScreen({ s: 'project', tab: 'scan' });
  if (P.project.team) Sync.cycle(true);
}
function saveItem(it) { return Store.putItem(it); }
function touchProject() { P.project.updatedAt = Date.now(); return Store.putProject(P.project); }

/* ===================== render ===================== */
function render() {
  teardownScan();
  var r = curScreen().route;
  root.replaceChildren();
  var node = r.s === 'home' ? homeScreen() : r.s === 'import' ? importScreen() : r.s === 'report' ? reportScreen() : projectScreen(r);
  root.appendChild(node);
  if (r.s === 'project' && r.tab === 'scan') mountScan();
}

function topbar(title, sub, onBack, right) {
  return h('div', { class: 'top' },
    onBack ? h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: onBack }, icon('back')) : null,
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('div', { class: 'sub', id: 'subline' }, sub) : null),
    right || null);
}

/* ===================== home ===================== */
function updBanner() {
  if (!window.Upd) return null;
  var st = Upd.state, kids = [];
  if (st.state === 'ready' && st.web) kids.push(h('button', { class: 'btn yellow block', onclick: function () { Upd.restart(); } }, 'Update ready. Tap to restart'));
  if (st.apk) kids.push(h('button', { class: 'btn block', onclick: function () { if (!Upd.openApk()) toast('Ask Mark for the new app file'); } }, 'New app version ' + st.apk.version + '. Tap to download'));
  return kids.length ? h('div', { style: { display: 'grid', gap: '8px' } }, kids) : null;
}
function verLine() {
  var w = window.CC_WEB, extra = w && w.v > w.builtin ? ' · updated ' + new Date(w.v * 1000).toISOString().slice(0, 10) : '';
  return 'Case Check 1.8' + extra + ' · works offline';
}
function homeScreen() {
  var list = h('div', { class: 'scroll' });
  Store.listProjects().then(function (ps) {
    ps.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return Promise.all(ps.map(function (p) { return Store.getItems(p.id).then(function (its) { return { p: p, c: counts(its) }; }); }));
  }).then(function (rows) {
    list.replaceChildren();
    var ub = updBanner(); if (ub) list.appendChild(ub);
    list.appendChild(h('button', { class: 'btn primary block', onclick: function () { startImport(null); } }, icon('plus'), 'New project'));
    list.appendChild(h('button', { class: 'btn block', onclick: joinSheet }, 'Join a team with a code'));
    if (!rows.length) {
      list.appendChild(h('div', { class: 'empty' },
        h('h2', null, 'Start with your list'),
        h('p', { style: { margin: 0, maxWidth: '30ch' } }, 'Choose the inventory list for your event. Excel, CSV or PDF. Each upload becomes its own project.')));
    }
    rows.forEach(function (r) {
      var c = r.c, p = r.p;
      var pctIn = c.total ? (c.in / c.total * 100) : 0, pctOut = c.total ? (c.out / c.total * 100) : 0;
      list.appendChild(h('button', { class: 'card tap proj', onclick: function () { openProject(p.id); } },
        h('h3', null, p.name),
        h('div', { class: 'mute', style: { fontSize: '14px', margin: '4px 0 10px' } }, (p.docs ? p.docs.length : 1) + (p.docs && p.docs.length > 1 ? ' documents' : ' document') + ' · started ' + fmtDay(p.createdAt)),
        h('div', { class: 'bar' }, h('i', { class: 'b-in', style: { width: pctIn + '%' } }), h('i', { class: 'b-out', style: { width: pctOut + '%' } })),
        h('div', { class: 'stats', style: { marginTop: '10px' } },
          h('span', null, h('b', null, c.wait), ' waiting'), h('span', null, h('b', null, c.in), ' in'), h('span', null, h('b', null, c.out), ' out'))));
    });
    list.appendChild(h('div', { class: 'homelinks' },
      h('button', { class: 'linkbtn', onclick: cycleTheme }, 'Theme: ' + themeName()),
      h('button', { class: 'linkbtn', onclick: problemSheet }, 'Problem log'),
      h('button', { class: 'linkbtn', onclick: checkUpdates }, 'Updates')));
    list.appendChild(h('div', { class: 'homefoot' }, h('div', null, verLine()), h('div', null, h('b', null, 'Created and operated by M Barnard'))));
  });
  return h('div', { class: 'screen' }, h('div', { class: 'top' }, h('div', { class: 'brandmark', role: 'img', 'aria-label': 'Case Check' }), h('div', { class: 'grow' }, h('h1', null, 'Case Check'), h('div', { class: 'sub', id: 'subline' }, 'Flight cases and pallets'))), list);
}
async function checkUpdates() {
  if (!window.Upd) return;
  toast('Checking for updates');
  await Upd.check(true);
  if (Upd.state.err) toast('Could not check. ' + Upd.state.err);
  else if (Upd.state.state === 'ready' || Upd.state.apk) toast('An update is ready');
  else toast('You have the latest version');
  try { if (curScreen().route.s === 'home') render(); } catch (e) { /* ignore */ }
}
function nameSheet(done) {
  var inp = h('input', { type: 'text', placeholder: 'Your name', value: Store.who(), maxLength: 30 });
  var s = sheet('Your name', [h('p', { style: { margin: 0, color: 'var(--ink2)' } }, 'Shown next to your scans on the admin dashboard.'), inp,
    h('button', { class: 'btn primary block', onclick: function () { try { localStorage.setItem('cc_name', inp.value.trim()); } catch (e) { /* ignore */ } closeOv(s.el); if (typeof done === 'function') done(); else render(); } }, 'Save')]);
  setTimeout(function () { inp.focus(); }, 150);
}
function joinSheet() {
  var inp = h('input', { type: 'text', class: 'mono', placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', maxLength: 12, style: { fontSize: '30px', letterSpacing: '.2em', textAlign: 'center', textTransform: 'uppercase' } });
  var msg = h('div', { class: 'note', hidden: true });
  var s, go = h('button', { class: 'btn primary block', onclick: async function () {
    go.disabled = true; msg.hidden = true; go.textContent = 'Joining';
    try {
      try { localStorage.setItem('cc_name', nm2.value.trim()); } catch (e2) { /* ignore */ }
      var id = await Sync.join(inp.value);
      closeOv(s.el);
      await openProject(id);
      toast('Joined the team');
    } catch (e) { msg.textContent = e.message; msg.hidden = false; go.disabled = false; go.textContent = 'Join'; Diag.log('JOIN ' + e.message); }
  } }, 'Join');
  var nm2 = h('input', { type: 'text', placeholder: 'Your name, shown on the admin dashboard', value: Store.who(), maxLength: 30 });
  s = sheet('Join a team', [h('p', { style: { margin: 0, color: 'var(--ink2)' } }, 'Type the code from the person who set up the project. You get the same list and zones.'), inp, nm2, msg, go]);
  setTimeout(function () { inp.focus(); }, 150);
}
function teamSheet() {
  var p = P.project, s, body = h('div', { style: { display: 'grid', gap: '12px' } });
  function draw() {
    body.replaceChildren();
    if (!p.team) {
      var msg = h('div', { class: 'note', hidden: true });
      var go = h('button', { class: 'btn primary block', onclick: async function () {
        go.disabled = true; go.textContent = 'Setting up'; msg.hidden = true;
        try { await Sync.create(p); draw(); refreshView(); if (curScreen().route.tab === 'menu') render(); }
        catch (e) { msg.textContent = e.message; msg.hidden = false; go.disabled = false; go.textContent = 'Share with team'; Diag.log('SHARE ' + e.message); }
      } }, 'Share with team');
      body.append(h('p', { style: { margin: 0, color: 'var(--ink2)' } }, 'Everyone with the code sees the same list and the same check ins. It needs signal now and then. Without signal the app still works and sends the changes later.'), go, msg);
    } else {
      var n = Sync.dirty(P.items).length, st = Sync.state;
      body.append(
        h('div', { class: 'label' }, 'Team code'),
        h('div', { class: 'mono', style: { fontSize: '44px', fontWeight: '600', letterSpacing: '.18em', textAlign: 'center', padding: '8px 0' } }, p.team.code),
        h('p', { style: { margin: 0, color: 'var(--ink2)', textAlign: 'center' } }, 'Others tap Join a team with a code on the home screen and type this.'),
        h('div', { class: 'note' + (st.err ? '' : ' ok') }, st.err ? 'Not connected. ' + st.err : (st.last ? 'Synced ' + fmtT(st.last) : 'Not synced yet') + (n ? '. ' + n + ' changes waiting.' : '')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: async function () { await Sync.cycle(true); draw(); } }, 'Sync now'),
          h('button', { class: 'btn grow', onclick: function () { shareText('Case Check team code', 'Join my Case Check project "' + p.name + '". In the app tap Join a team with a code and type ' + p.team.code); } }, 'Send code')),
        h('div', { class: 'mute', style: { fontSize: '14px' } }, 'Photos and the site plan are shared with the team.'),
        h('div', { class: 'note' }, Perms.describe()),
        h('button', { class: 'btn danger block', onclick: async function () {
          if (!(await confirmDlg({ title: 'Stop syncing?', body: 'This phone keeps its copy. It stops sending and receiving changes.', ok: 'Stop', danger: true }))) return;
          p.team = null; await Store.putProject(p); draw(); refreshView();
        } }, 'Stop syncing on this phone'));
    }
  }
  s = sheet('Team sync', [body]);
  draw();
}
function problemSheet() {
  var lines = Diag.all(), text = lines.join('\n') || 'Nothing logged yet.';
  sheet('Problem log', [
    h('pre', { class: 'mono', style: { margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '45vh', overflow: 'auto' } }, text),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: function () { Diag.clear(); toast('Cleared'); } }, 'Clear'),
      h('button', { class: 'btn primary grow', onclick: function () { shareText('Case Check problem log', 'Case Check 1.4 problem log\n' + text); } }, 'Share'))]);
}
function themeName() { var t = 'auto'; try { t = localStorage.getItem('theme') || 'auto'; } catch (e) { /* ignore */ } return t === 'auto' ? 'Auto' : t === 'dark' ? 'Dark' : 'Light'; }
function applyTheme() {
  var t = 'auto'; try { t = localStorage.getItem('theme') || 'auto'; } catch (e) { /* ignore */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}
function cycleTheme() {
  var t = 'auto'; try { t = localStorage.getItem('theme') || 'auto'; } catch (e) { /* ignore */ }
  var next = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
  applyTheme(); render();
}

/* ===================== import wizard ===================== */
var RX_SERIAL = [/serial|s\/n|\bsn\b/, /barcode|asset|tag|case\s*(no|num|id|#)|pallet\s*(no|num|id|#)|flight\s*case|\bid\b|\bref/];
function startImport(targetId) {
  Imp = { step: 1, target: targetId || null, fileName: '', sheets: null, sheetIdx: 0, headerRow: 0, map: { serial: -1, alt: -1, desc: -1, group: -1, zone: -1 },
          name: '', defaultZone: 'Unassigned', groupZone: {}, err: '', busy: false };
  goScreen({ s: 'import' });
}

async function parseFile(file) {
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  var wb;
  if (['csv', 'tsv', 'txt'].indexOf(ext) !== -1) {
    var buf = await file.arrayBuffer();
    var text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
    if (text.indexOf('�') !== -1) text = new TextDecoder('windows-1252').decode(buf);
    wb = XLSX.read(text, { type: 'string', raw: true });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  var sheets = wb.SheetNames.map(function (n) {
    return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: false }) };
  }).filter(function (s) { return s.rows.length > 1; });
  if (!sheets.length) throw new Error('No rows found in that file.');
  return sheets;
}
function loadScript(src) {
  return new Promise(function (res, rej) {
    var sc = document.createElement('script');
    var t = setTimeout(function () { rej(new Error('Timed out loading ' + src)); }, 20000);
    sc.src = src;
    sc.onload = function () { clearTimeout(t); res(); };
    sc.onerror = function () { clearTimeout(t); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(sc);
  });
}
// The reader and its worker are plain scripts. Loading the worker script ourselves makes the reader run it
// in the page, so it does not depend on the phone starting a separate worker thread.
function loadPdfLib() {
  if (window.pdfjsLib && window.pdfjsWorker) return Promise.resolve();
  return loadScript('/lib/pdf.min.js').then(function () { return loadScript('/lib/pdf.worker.min.js'); }).then(function () {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.min.js';
    Diag.log('PDF reader ready, worker ' + (window.pdfjsWorker ? 'in page' : 'missing'));
  });
}
async function readPdf(file) {
  await loadPdfLib();
  var buf = await file.arrayBuffer();
  var doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false }).promise;
  var pages = [];
  for (var n = 1; n <= doc.numPages; n++) {
    var tc = await (await doc.getPage(n)).getTextContent();
    pages.push(tc.items.map(function (i) { return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }; }));
  }
  var res = PdfImport.parse(pages);
  if (!res.rows.length) throw new Error('No equipment rows found in ' + file.name + '.');
  return { name: file.name, meta: res.meta, rows: res.rows };
}
function guessHeaderRow(rows) {
  var lim = Math.min(rows.length, 30), max = 0, i;
  var filled = function (r) { return r.filter(function (c) { return String(c).trim() !== ''; }).length; };
  for (i = 0; i < lim; i++) max = Math.max(max, filled(rows[i]));
  for (i = 0; i < lim; i++) if (filled(rows[i]) >= Math.max(2, Math.ceil(max * 0.6))) return i;
  return 0;
}
function headersOf(rows, hr) {
  var raw = rows[hr] || [], seen = {};
  return raw.map(function (c, i) {
    var n = String(c).trim() || ('Column ' + (i + 1));
    if (seen[n]) { seen[n]++; n = n + ' (' + seen[n] + ')'; } else seen[n] = 1;
    return n;
  });
}
function detectMap(headers) {
  var low = headers.map(function (s) { return s.toLowerCase(); }), used = {};
  function find(rxs) {
    for (var r = 0; r < rxs.length; r++) for (var i = 0; i < low.length; i++) if (!used[i] && rxs[r].test(low[i])) { used[i] = 1; return i; }
    return -1;
  }
  var m = { serial: -1, alt: -1, desc: -1, group: -1, zone: -1 };
  m.serial = find(RX_SERIAL);
  m.zone = find([/zone|loading|dock|bay|door|destination|location|area/]);
  m.desc = find([/desc|item|equipment|contents|product|model|name/]);
  m.group = find([/client|exhibitor|company|owner|dept|department|stand|booth|supplier|vendor|stage|customer|project|hall/]);
  m.alt = find([/asset|tag|barcode|case|pallet|\bid\b|ref/]);
  if (m.serial < 0) m.serial = 0;
  return m;
}
function curSheet() { return Imp.sheets[Imp.sheetIdx]; }
function impRows() { return curSheet().rows.slice(Imp.headerRow + 1); }
function cell(r, i) { return i < 0 || i == null ? '' : String(r[i] == null ? '' : r[i]).trim(); }

function importScreen() {
  var title = Imp.target ? 'Add a document' : 'New project';
  var nSteps = Imp.pdf ? 2 : 3;
  var steps = h('div', { class: 'steps' }, [1, 2, 3].slice(0, nSteps).map(function (n) { return h('i', { class: n <= Imp.step ? 'on' : '' }); }));
  var body = Imp.step === 1 ? impStep1() : Imp.pdf ? impPdf() : Imp.step === 2 ? impStep2() : impStep3();
  return h('div', { class: 'screen' },
    topbar(title, null, function () { if (Imp.step > 1) { Imp.step--; render(); } else popScreen(); }),
    h('div', { class: 'scroll' }, steps, body));
}

function impStep1() {
  var input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xls,.xlsm,.csv,.tsv,.txt,.pdf,application/pdf', hidden: true, id: 'impfile', onchange: onImpFile });
  return h('div', { class: 'screen', style: { gap: '12px' } },
    h('div', { class: 'drop' },
      h('h2', { style: { fontSize: '30px' } }, 'Choose your inventory list'),
      h('p', { class: 'mute', style: { margin: 0, maxWidth: '32ch' } }, 'Excel, CSV or PDF. Pick all your PDFs at once. Every language goes into one project. You can add more files before you create it.'),
      h('button', { class: 'btn primary', onclick: function () { input.click(); } }, 'Choose file'),
      Imp.busy ? h('div', { class: 'row' }, h('div', { class: 'spin', style: { borderColor: 'var(--line)', borderTopColor: 'var(--accent)', width: '26px', height: '26px', borderWidth: '4px' } }), h('span', null, Imp.progress || 'Reading files')) : null),
    Imp.err ? h('div', { class: 'note' }, Imp.err) : null,
    input);
}
async function onImpFile(e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  Diag.log('Picked ' + files.length + ' file(s): ' + files.map(function (x) { return x.name + ' ' + x.size; }).join(', '));
  if (!files.length) { Imp.err = 'No file came back from the picker. Try again.'; render(); return; }
  var pdfs = files.filter(function (x) { return /\.pdf$/i.test(x.name); });
  var f = pdfs.length ? pdfs[0] : files[0];
  Imp.busy = true; Imp.err = ''; render();
  try {
    if (pdfs.length) {
      await addPdfs(pdfs);
      Imp.step = 2; Imp.busy = false; Imp.progress = ''; render();
      return;
    }
    Imp.pdf = null;
    var sheets = await parseFile(f);
    Imp.sheets = sheets; Imp.fileName = f.name;
    var best = 0;
    sheets.forEach(function (s, i) { if (s.rows.length > sheets[best].rows.length) best = i; });
    Imp.sheetIdx = best;
    Imp.headerRow = guessHeaderRow(curSheet().rows);
    Imp.map = detectMap(headersOf(curSheet().rows, Imp.headerRow));
    Imp.name = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    Imp.step = 2;
  } catch (err) {
    Diag.log('IMPORT FAILED ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
    Imp.err = (err && err.message ? err.message : 'Could not read that file.') + ' Open Problem log on the home screen for details.';
  }
  Imp.progress = ''; Imp.busy = false; render();
}

function impStep2() {
  var rows = curSheet().rows, headers = headersOf(rows, Imp.headerRow);
  var first = rows[Imp.headerRow + 1] || [];
  var opts = function (cur, allowNone) {
    var out = [];
    if (allowNone) out.push(h('option', { value: '-1', selected: cur < 0 }, 'None'));
    headers.forEach(function (hd, i) {
      var sample = cell(first, i);
      out.push(h('option', { value: String(i), selected: cur === i }, hd + (sample ? '   (' + sample.slice(0, 18) + ')' : '')));
    });
    return out;
  };
  var statsBox = h('div');
  function drawStats() {
    var data = impRows(), keys = {}, dup = 0, n = 0;
    data.forEach(function (r) { var s = cell(r, Imp.map.serial); if (!s) return; n++; var k = Match.norm(s); if (keys[k]) dup++; keys[k] = 1; });
    statsBox.replaceChildren(
      h('div', { class: 'note ok' }, n + ' items found' + (data.length - n ? ', ' + (data.length - n) + ' blank rows skipped' : '')),
      dup ? h('div', { class: 'note', style: { marginTop: '8px' } }, dup + ' repeated serial numbers. They stay in the list and the app asks you to choose when scanned.') : null);
    nextBtn.disabled = !n;
  }
  var sel = function (key, label, none) {
    return h('label', { class: 'field' }, h('span', null, label),
      h('select', { onchange: function (ev) { Imp.map[key] = parseInt(ev.target.value, 10); drawStats(); } }, opts(Imp.map[key], none)));
  };
  var nextBtn = h('button', { class: 'btn primary grow', onclick: function () { Imp.step = 3; render(); } }, 'Next');
  var sheetSel = Imp.sheets.length > 1 ? h('label', { class: 'field' }, h('span', null, 'Sheet'),
    h('select', { onchange: function (ev) {
      Imp.sheetIdx = parseInt(ev.target.value, 10); Imp.headerRow = guessHeaderRow(curSheet().rows);
      Imp.map = detectMap(headersOf(curSheet().rows, Imp.headerRow)); render();
    } }, Imp.sheets.map(function (s, i) { return h('option', { value: String(i), selected: i === Imp.sheetIdx }, s.name + ' (' + s.rows.length + ' rows)'); }))) : null;
  var hrIn = h('input', { type: 'number', min: '1', max: String(Math.min(rows.length, 50)), value: String(Imp.headerRow + 1), inputMode: 'numeric',
    onchange: function (ev) {
      var v = Math.max(1, Math.min(parseInt(ev.target.value, 10) || 1, rows.length - 1));
      Imp.headerRow = v - 1; Imp.map = detectMap(headersOf(rows, Imp.headerRow)); render();
    } });
  var prev = h('div', { class: 'tablewrap' }, h('table', { class: 'prev' },
    h('thead', null, h('tr', null, headers.map(function (hd) { return h('th', null, hd); }))),
    h('tbody', null, rows.slice(Imp.headerRow + 1, Imp.headerRow + 6).map(function (r) {
      return h('tr', null, headers.map(function (hd, i) { return h('td', null, cell(r, i)); }));
    }))));
  var view = h('div', { class: 'map' },
    h('p', { class: 'mute', style: { margin: 0 } }, Imp.fileName),
    sheetSel,
    h('label', { class: 'field' }, h('span', null, 'Row with column titles'), hrIn),
    prev,
    sel('serial', 'Serial number (required)', false),
    sel('alt', 'Second ID, such as asset tag or pallet number', true),
    sel('desc', 'Description', true),
    sel('group', 'Group, such as client or department', true),
    sel('zone', 'Loading zone', true),
    statsBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: function () { Imp.step = 1; render(); } }, 'Back'), nextBtn));
  setTimeout(drawStats, 0);
  return view;
}

function distinct(colIdx) {
  var m = {}, order = [];
  impRows().forEach(function (r) {
    if (!cell(r, Imp.map.serial)) return;
    var v = cell(r, colIdx); if (!v) return;
    var k = v.toLowerCase();
    if (!m[k]) { m[k] = { name: v, n: 0 }; order.push(k); }
    m[k].n++;
  });
  return order.map(function (k) { return m[k]; });
}

function impStep3() {
  var existing = Imp.target && P ? P.project.zones.map(function (z) { return z.name; }) : [];
  var parts = [];
  if (!Imp.target) {
    parts.push(h('label', { class: 'field' }, h('span', null, 'Project name'),
      h('input', { type: 'text', value: Imp.name, oninput: function (e) { Imp.name = e.target.value; } })));
  }
  var dl = h('datalist', { id: 'zonelist' });
  if (Imp.map.zone >= 0) {
    var zs = distinct(Imp.map.zone);
    parts.push(h('div', { class: 'field' }, h('span', null, 'Zones found in the list'),
      h('div', { class: 'row wrap' }, zs.slice(0, 60).map(function (z) { return h('span', { class: 'chip', style: { minHeight: '34px', display: 'inline-grid', alignItems: 'center' } }, z.name + '  ' + z.n); }))));
  } else if (Imp.map.group >= 0) {
    var gs = distinct(Imp.map.group).slice(0, 400);
    var setAll = h('input', { type: 'text', placeholder: 'Zone name', list: 'zonelist' });
    parts.push(h('div', { class: 'field' }, h('span', null, 'Which zone does each ' + 'group go to?'),
      h('div', { class: 'row' }, setAll, h('button', { class: 'btn small', onclick: function () {
        var v = setAll.value.trim(); if (!v) return;
        gs.forEach(function (g) { Imp.groupZone[g.name.toLowerCase()] = v; });
        render();
      } }, 'Set all')) ));
    gs.forEach(function (g) {
      parts.push(h('div', { class: 'zrow' },
        h('div', { class: 'g' }, g.name, h('span', { class: 'mute' }, '  ' + g.n)),
        h('input', { type: 'text', list: 'zonelist', placeholder: 'Zone', value: Imp.groupZone[g.name.toLowerCase()] || '',
          oninput: function (e) { Imp.groupZone[g.name.toLowerCase()] = e.target.value.trim(); } })));
    });
  }
  parts.push(h('label', { class: 'field' }, h('span', null, Imp.map.zone >= 0 || Imp.map.group >= 0 ? 'Zone when none is given' : 'All items go to this zone'),
    h('input', { type: 'text', list: 'zonelist', value: Imp.defaultZone, oninput: function (e) { Imp.defaultZone = e.target.value.trim(); } })));
  var names = {};
  existing.concat(Object.keys(Imp.groupZone).map(function (k) { return Imp.groupZone[k]; })).forEach(function (n) { if (n) names[n] = 1; });
  Object.keys(names).forEach(function (n) { dl.appendChild(h('option', { value: n })); });
  parts.push(dl);
  var go = h('button', { class: 'btn primary grow', onclick: function () { go.disabled = true; finishImport(); } }, Imp.target ? 'Add items' : 'Create project');
  parts.push(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: function () { Imp.step = 2; render(); } }, 'Back'), go));
  return h('div', { class: 'map' }, parts);
}

// Reads PDFs and adds them to the one project being built. Can be called again to add more files.
async function addPdfs(pdfs) {
  var old = Imp.pdf ? Imp.pdf.docs : [], docs = old.slice(), have = {};
  old.forEach(function (d) { have[d.meta.kind + d.meta.number] = 1; });
  for (var k = 0; k < pdfs.length; k++) {
    Imp.progress = 'Reading ' + (k + 1) + ' of ' + pdfs.length + ': ' + pdfs[k].name; render();
    var d = await readPdf(pdfs[k]);
    if (d.meta.number && have[d.meta.kind + d.meta.number]) continue;
    have[d.meta.kind + d.meta.number] = 1; docs.push(d);
  }
  var zoneBy = {};
  if (Imp.pdf) Imp.pdf.groups.forEach(function (g) { zoneBy[g.key] = g.zone; });
  var groups = PdfImport.group(docs);
  groups.forEach(function (g) { g.zone = zoneBy[g.key] || g.lang || g.code || 'Unassigned'; });
  Imp.pdf = { docs: docs, groups: groups };
  var d0 = docs[0].meta, yr = /(\d{4})/.exec(d0.dates || '');
  Imp.fileName = docs.length === 1 ? docs[0].name : docs.length + ' PDF files, ' + groups.length + ' ' + (groups.length === 1 ? 'language' : 'languages');
  if (!Imp.name) Imp.name = ((d0.place || '').split(',')[0] + (yr ? ' ' + yr[1] : '')).trim() || 'Event';
}
async function onMorePdfs(e) {
  var files = Array.prototype.slice.call(e.target.files || []).filter(function (x) { return /\.pdf$/i.test(x.name); });
  Diag.log('Added ' + files.length + ' more PDF(s)');
  if (!files.length) return;
  Imp.busy = true; render();
  try { await addPdfs(files); } catch (err) { Diag.log('ADD FAILED ' + err); toast('Could not read that PDF'); }
  Imp.busy = false; Imp.progress = ''; render();
}
function impPdf() {
  var pd = Imp.pdf, parts = [];
  parts.push(h('p', { class: 'mute', style: { margin: 0 } }, Imp.fileName));
  if (Imp.busy) parts.push(h('div', { class: 'row' }, h('div', { class: 'spin', style: { borderColor: 'var(--line)', borderTopColor: 'var(--accent)', width: '26px', height: '26px', borderWidth: '4px' } }), h('span', null, Imp.progress || 'Reading files')));
  if (!Imp.target) {
    parts.push(h('label', { class: 'field' }, h('span', null, 'Project name'),
      h('input', { type: 'text', value: Imp.name, oninput: function (e) { Imp.name = e.target.value; } })));
  }
  var total = 0;
  pd.groups.forEach(function (g) {
    total += g.units;
    var bare = g.rows.filter(function (r) { return !r.label; }).length;
    var checks = [];
    if (g.bom && g.pl) {
      if (!g.diff.length) checks.push(h('div', { class: 'note ok' }, 'The bill of materials and the packing list match.'));
      else checks.push(h('div', { class: 'note' }, h('b', null, 'The two lists differ'), g.diff.slice(0, 6).map(function (d) { return h('div', null, d); }),
        g.diff.length > 6 ? h('div', null, 'and ' + (g.diff.length - 6) + ' more') : null,
        h('div', { style: { marginTop: '6px' } }, 'The app uses the bill of materials.')));
    } else {
      checks.push(h('div', { class: 'note' }, g.bom ? 'Only the bill of materials was added. No packing list to check against.' : 'Only the packing list was added. No bill of materials to check against.'));
    }
    if (bare) checks.push(h('div', { class: 'note', style: { marginTop: '8px', background: 'var(--panel2)', color: 'var(--ink2)', border: '1px solid var(--line)', fontWeight: '500' } },
      bare + ' lines have no label, such as cables, drums and pallets. Use No label on the Scan tab and take a photo of each one.'));
    parts.push(h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
      h('label', { class: 'field' }, h('span', null, 'Zone for ' + (g.lang || g.code)),
        h('input', { type: 'text', value: g.zone, oninput: function (e) { g.zone = e.target.value.trim(); } })),
      h('div', { class: 'stats' }, h('span', null, h('b', null, g.lines), ' lines'), h('span', null, h('b', null, g.units), ' pieces')),
      checks));
  });
  var more = h('input', { type: 'file', multiple: true, accept: '.pdf,application/pdf', hidden: true, onchange: onMorePdfs });
  parts.push(h('button', { class: 'btn block', onclick: function () { more.click(); } }, icon('plus'), 'Add more PDFs to this project'), more);
  var go = h('button', { class: 'btn primary grow', onclick: function () { go.disabled = true; finishPdfImport(); } }, Imp.target ? 'Add items' : 'Create project');
  parts.push(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: function () { Imp.pdf = null; Imp.name = ''; Imp.step = 1; render(); } }, 'Start again'), go));
  return h('div', { class: 'map' }, parts);
}

async function finishPdfImport() {
  try {
    var pd = Imp.pdf, proj, base = 0;
    if (Imp.target) {
      await loadProject(Imp.target);
      proj = P.project; base = P.items.reduce(function (a, i) { return Math.max(a, i.ord); }, 0) + 1;
    } else {
      proj = { id: Store.uid(), name: (Imp.name || 'Event').trim() || 'Event', createdAt: Date.now(), updatedAt: Date.now(), mode: 'in', zones: [], cols: [], docs: [] };
    }
    var canonical = {};
    proj.zones.forEach(function (z) { canonical[z.name.toLowerCase()] = z.name; });
    var items = [], ord = base;
    pd.groups.forEach(function (g) {
      var z = g.zone || g.lang || 'Unassigned', zk = z.toLowerCase();
      if (!canonical[zk]) { canonical[zk] = z; proj.zones.push({ name: z, color: PALETTE[proj.zones.length % PALETTE.length] }); }
      g.rows.forEach(function (r) {
        var f = PdfImport.itemFields(r), copies = r.label ? Math.max(1, r.qty) : 1;
        var extra = [['Language', g.lang || ''], ['Checked against', g.bom && g.pl ? (g.diff.length ? 'Packing list differs' : 'Packing list matches') : '']].filter(function (p) { return p[1]; });
        for (var c = 0; c < copies; c++) {
          items.push({ id: Store.uid(), pid: proj.id, serial: f.serial, alt: '', desc: f.desc, group: f.group, zone: canonical[zk],
            status: 'wait', inAt: null, outAt: null, note: '', unlisted: false, ord: ord++, qty: f.qty, got: 0, gone: 0, raw: f.raw.concat(extra) });
        }
      });
    });
    ['Contents', 'Maker', 'Packed in', 'Size cm', 'Weight kg', 'Language', 'Checked against'].forEach(function (c) { if (proj.cols.indexOf(c) === -1) proj.cols.push(c); });
    proj.zoneMeta = proj.zoneMeta || {};
    pd.groups.forEach(function (g) {
      var m = (g.bom || g.pl).meta;
      proj.zoneMeta[canonical[(g.zone || g.lang || 'Unassigned').toLowerCase()]] = { place: g.place, code: g.code, dates: g.dates, overseer: m.overseer || '', bom: g.bom ? g.bom.meta.number : '', pl: g.pl ? g.pl.meta.number : '' };
      if (!proj.org && m.org && m.org.length) proj.org = m.org;
    });
    pd.docs.forEach(function (d) { proj.docs.push({ name: d.name, addedAt: Date.now(), count: d.rows.length }); });
    proj.updatedAt = Date.now();
    await Store.putProject(proj);
    await Store.putItems(items);
    Nav.stack.pop();
    if (Imp.target) { await loadProject(proj.id); render(); toast(items.length + ' items added'); }
    else { await openProject(proj.id); toast(items.length + ' items ready'); }
  } catch (e) {
    console.error(e); toast('Could not create the project');
  }
}

async function finishImport() {
  try {
    var rows = impRows(), headers = headersOf(curSheet().rows, Imp.headerRow), m = Imp.map;
    var proj, base = 0, existing = [];
    if (Imp.target) {
      await loadProject(Imp.target);
      proj = P.project; existing = P.items;
      base = existing.reduce(function (a, i) { return Math.max(a, i.ord); }, 0) + 1;
    } else {
      proj = { id: Store.uid(), name: (Imp.name || 'Event').trim() || 'Event', createdAt: Date.now(), updatedAt: Date.now(), mode: 'in', zones: [], cols: [], docs: [] };
    }
    var zoneFor = function (r) {
      var z = cell(r, m.zone);
      if (!z && m.group >= 0) z = Imp.groupZone[cell(r, m.group).toLowerCase()] || '';
      return z || Imp.defaultZone || 'Unassigned';
    };
    var canonical = {};
    proj.zones.forEach(function (z) { canonical[z.name.toLowerCase()] = z.name; });
    var items = [];
    rows.forEach(function (r, ix) {
      var serial = cell(r, m.serial);
      if (!serial) return;
      var z = zoneFor(r), zk = z.toLowerCase();
      if (!canonical[zk]) { canonical[zk] = z; proj.zones.push({ name: z, color: PALETTE[proj.zones.length % PALETTE.length] }); }
      items.push({
        id: Store.uid(), pid: proj.id, serial: serial, alt: cell(r, m.alt), desc: cell(r, m.desc), group: cell(r, m.group), zone: canonical[zk],
        status: 'wait', inAt: null, outAt: null, note: '', unlisted: false, ord: base + ix,
        raw: headers.map(function (hd, i) { return [hd, cell(r, i)]; }).filter(function (p) { return p[1] !== ''; })
      });
    });
    headers.forEach(function (hd) { if (proj.cols.indexOf(hd) === -1) proj.cols.push(hd); });
    proj.docs.push({ name: Imp.fileName, addedAt: Date.now(), count: items.length });
    proj.updatedAt = Date.now();
    await Store.putProject(proj);
    await Store.putItems(items);
    Nav.stack.pop();   // leave the wizard
    if (Imp.target) { await loadProject(proj.id); render(); toast(items.length + ' items added'); }
    else { await openProject(proj.id); toast(items.length + ' items ready'); }
  } catch (e) {
    console.error(e); toast('Could not create the project');
  }
}

/* ===================== project shell ===================== */
function projectScreen(r) {
  var p = P.project, c = counts(P.items);
  var tab = r.tab || 'scan';
  var content = tab === 'scan' ? scanView() : tab === 'list' ? listView() : tab === 'zones' ? zonesView() : menuView();
  function tb(key, label, ic) {
    return h('button', { 'aria-current': String(key === tab), onclick: function () { if (key !== tab) replaceScreen({ s: 'project', tab: key }); } }, icon(ic), label);
  }
  return h('div', { class: 'screen' },
    topbar(p.name, subText(c), function () { popScreen(); }),
    content,
    h('nav', { class: 'tabs', 'aria-label': 'Project' },
      tb('list', 'List', 'list'), tb('zones', 'Zones', 'zones'),
      h('button', { class: 'bigscan', 'aria-label': 'Scan', 'aria-current': String(tab === 'scan'), onclick: function () { if (tab !== 'scan') replaceScreen({ s: 'project', tab: 'scan' }); } }, h('span', { class: 'disc' }, icon('scan')), h('span', { class: 'lbl' }, 'Scan')),
      h('button', { onclick: function () { openPlan({}); } }, icon('map'), 'Plan'),
      tb('menu', 'More', 'menu')));
}
function subText(c) { return (c.in + c.out) + ' of ' + c.total + ' arrived' + (c.out ? ' · ' + c.out + ' out' : '') + (P && P.project ? Sync.label(P.project) : ''); }
function refreshView() {
  var r = curScreen().route;
  var sub = document.getElementById('subline'); if (sub) sub.textContent = subText(counts(P.items));
  if (r.s !== 'project') return;
  if (r.tab === 'scan') refreshStats();
  else if (r.tab === 'list' && P.redraw) P.redraw();
  else if (r.tab === 'zones') render();
}

/* ===================== scan ===================== */
function mbtn(mode, label) {
  var b = h('button', { 'aria-pressed': String(mode === 'inside' ? !!P.project.scanInside : (!P.project.scanInside && P.project.mode === mode)), onclick: function () { setMode(mode); } }, label);
  S.modeBtns[mode] = b;
  return b;
}
function setMode(mode) {
  var wasIn = !!P.project.scanInside;
  P.project.scanInside = mode === 'inside';
  if (wasIn !== P.project.scanInside) Store.putProject(P.project);
  if (mode === 'inside') {
    S.inside = true;
    S.hint.textContent = 'Scan the flight case to check inside it';
  } else {
    S.inside = false; P.project.mode = mode; Store.putProject(P.project);
    S.hint.textContent = 'Fit the serial number inside the frame';
  }
  var cur = S.inside ? 'inside' : P.project.mode;
  Object.keys(S.modeBtns).forEach(function (k) { S.modeBtns[k].setAttribute('aria-pressed', String(k === cur)); });
}
function recentScans() {
  var ev = [];
  P.items.forEach(function (i) {
    if (i.status === 'in' && i.inAt) ev.push({ it: i, t: i.inAt, k: 'In' });
    else if (i.status === 'out' && i.outAt) ev.push({ it: i, t: i.outAt, k: 'Out' });
  });
  ev.sort(function (x, y) { return y.t - x.t; });
  return ev.slice(0, 3);
}
function refreshRecent() {
  if (!S || !S.recent) return;
  var ev = recentScans();
  S.recent.hidden = !ev.length;
  S.recent.replaceChildren.apply(S.recent, ev.map(function (e) {
    var z = zoneInfo(e.it.zone);
    return h('button', { class: 'rec', 'aria-label': 'Fix ' + nm(e.it), onclick: function () { itemSheet(e.it); } },
      h('i', { style: { background: z.color } }), h('b', null, nm(e.it)), h('span', null, e.k + ' ' + fmtT(e.t)));
  }));
}
function refreshStats() {
  if (!S || !S.stats) return;
  refreshRecent();
  var c = counts(P.items);
  S.stats.replaceChildren(
    h('span', null, h('b', null, c.wait), ' waiting'), h('span', null, h('b', null, c.in), ' in'), h('span', null, h('b', null, c.out), ' out'));
}

function scanView() {
  S = { mounted: false, busy: false, auto: false, timer: null, modeBtns: {}, ocrReady: false };
  S.video = h('video', { playsinline: true, muted: true, autoplay: true });
  S.hint = h('div', { class: 'hint' }, P.project.scanInside ? 'Scan the flight case to check inside it' : 'Fit the serial number inside the frame');
  S.msg = h('div', { class: 'msg', hidden: true });
  S.busyEl = h('div', { class: 'busy', hidden: true }, h('div', { class: 'spin' }), h('div', null, 'Reading'));
  S.shutter = h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: function () { takePhoto(false); } });
  S.torchBtn = h('button', { class: 'pill', hidden: true, 'aria-pressed': 'false', onclick: toggleTorch }, 'Light');
  S.autoBtn = h('button', { class: 'pill', 'aria-pressed': 'false', onclick: toggleAuto }, 'Auto');
  S.fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onPickPhoto });
  var ctrl = h('div', { class: 'ctrl' }, h('div', { class: 'side' }, S.torchBtn), S.shutter, h('div', { class: 'side r' }, S.autoBtn));
  var cam = h('div', { class: 'cam' }, S.video, h('div', { class: 'reticle' }, h('i')), S.hint, ctrl, S.msg, S.busyEl);
  S.inside = !!P.project.scanInside;
  var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, mbtn('in', 'Check in'), mbtn('out', 'Check out'), mbtn('inside', 'Inside'));
  S.stats = h('div', { class: 'stats' });
  var strip = h('div', { class: 'strip2' }, S.stats,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', 'aria-label': 'Use a photo from the gallery', onclick: function () { S.fileIn.click(); } }, icon('image')),
      h('button', { class: 'btn small', onclick: function () { noLabelSheet(); } }, icon('scan'), 'No label'),
      h('button', { class: 'btn small', onclick: function () { findSheet({}); } }, icon('keys'), 'Type')));
  refreshStats();
  S.recent = h('div', { class: 'recent', 'aria-label': 'Last scans' });
  refreshRecent();
  return h('div', { class: 'scanwrap' }, seg, cam, S.recent, strip, S.fileIn);
}

function showCamMsg(title, text, actions) {
  S.msg.replaceChildren(h('h2', { style: { fontSize: '28px' } }, title), h('p', null, text), h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, actions));
  S.msg.hidden = false;
}
function startCamera() {
  if (!S) return Promise.resolve();
  var sref = S;
  S.msg.hidden = true;
  return Cam.start(S.video).then(function () {
    if (S !== sref) { Cam.stop(); return; }
    S.torchBtn.hidden = !Cam.hasTorch();
  }).catch(function (e) {
    if (S !== sref) return;
    showCamMsg('Camera is off', 'Allow the camera for Case Check in Android settings, then try again. You can still type serial numbers.', [
      h('button', { class: 'btn yellow small', onclick: startCamera }, 'Try again'),
      h('button', { class: 'btn small', style: { color: '#fff', borderColor: '#fff' }, onclick: function () { findSheet({}); } }, 'Type serial')]);
  });
}
function mountScan() {
  if (!S) return;
  S.mounted = true;
  startCamera();
  if (window.Tesseract) {
    S.hint.textContent = 'Getting the reader ready';
    var sref = S;
    OCR.init().then(function () { if (S === sref) { S.ocrReady = true; S.hint.textContent = 'Fit the serial number inside the frame'; } })
      .catch(function (e) { console.error(e); if (S === sref) S.hint.textContent = 'Reader failed to start. You can still type serials.'; });
  }
}
function teardownScan() {
  if (S) { clearInterval(S.timer); S.mounted = false; }
  Cam.stop();
  S = null;
}
function toggleTorch() {
  var on = S.torchBtn.getAttribute('aria-pressed') !== 'true';
  Cam.torch(on).then(function (ok) { S.torchBtn.setAttribute('aria-pressed', String(on && ok)); });
}
function toggleAuto() {
  S.auto = !S.auto;
  S.autoBtn.setAttribute('aria-pressed', String(S.auto));
  clearInterval(S.timer);
  if (S.auto) {
    toast('Auto scan on. It marks sure matches only.');
    S.timer = setInterval(function () { if (S && !S.busy && topEntry().t === 'screen') takePhoto(true); }, 1800);
  }
}
function takePhoto(auto) {
  if (!S || S.busy) return;
  if (!Cam.isLive() || !S.video.videoWidth) { if (!auto) toast('The camera is not ready yet'); return; }
  S.busy = true; S.busyEl.hidden = auto; S.shutter.disabled = true;
  runIdentify({ crop: Cam.crop(S.video, BOX), full: Cam.whole(S.video) }, auto);
}
function runIdentify(frames, auto) {
  var sref = S;
  S.busy = true; if (!auto) S.busyEl.hidden = false;
  Scanner.identify(frames, P.index).then(function (res) { onScan(res, frames, auto); })
    .catch(function (e) { console.error(e); if (!auto) toast('Could not read the photo. Try again or type the serial.'); })
    .then(function () { if (S === sref && S) { S.busy = false; S.busyEl.hidden = true; S.shutter.disabled = false; } });
}
async function onPickPhoto(e) {
  var f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f || !S) return;
  try {
    var bmp = await createImageBitmap(f);
    var s = Math.min(1, 2000 / bmp.width);
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    runIdentify({ crop: c, full: null }, false);
  } catch (err) { toast('Could not open that photo'); }
}
function makeThumb(src) {
  var w = Math.min(800, src.width), s = w / src.width;
  var c = document.createElement('canvas');
  c.width = w; c.height = Math.max(1, Math.round(src.height * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.6); });
}
function alreadyDone(item) { return P.project.mode === 'in' ? item.status !== 'wait' : item.status === 'out'; }

function onScan(res, frames, auto) {
  var d = res.decision, thumb = makeThumb(frames.full || frames.crop);
  S.readAs = d.type === 'sure' && res.matches[0] ? res.matches[0].token : '';
  if (d.type === 'sure') {
    if (S && S.inside) { if (!auto) { feedback('ok'); openInside(d.item); } return; }
    if (auto && alreadyDone(d.item)) return;
    applyScan(d.item, thumb);
  } else if (!auto) {
    feedback('warn');
    findSheet({ ocrText: res.text, candidates: d.list, thumb: thumb });
  }
}

async function applyScan(item, thumbPromise) {
  if (S && S.inside) { feedback('ok'); openInside(item); return; }
  var mode = P.project.mode, prev = { status: item.status, inAt: item.inAt, outAt: item.outAt }, kind, changed = true;
  if (mode === 'in') {
    if (item.status === 'in') { kind = 'dup-in'; changed = false; }
    else if (item.status === 'out') { kind = 'dup-out'; changed = false; }
    else { item.status = 'in'; item.inAt = Date.now(); kind = 'ok-in'; }
  } else {
    if (item.status === 'out') { kind = 'dup-outd'; changed = false; }
    else { kind = item.status === 'in' ? 'ok-out' : 'ok-out-noin'; item.status = 'out'; item.outAt = Date.now(); }
  }
  if (changed) {
    await saveItem(item);
    if (thumbPromise) thumbPromise.then(function (b) { if (b) Store.putPhoto(item.id + ':' + mode, b); });
  }
  feedback(kind.indexOf('ok') === 0 && kind !== 'ok-out-noin' ? 'ok' : 'warn');
  showResult(item, kind, prev, mode);
  refreshView();
}

var RESULT_TEXT = {
  'ok-in': ['Checked in', false], 'ok-out': ['Checked out', false],
  'dup-in': ['Already checked in', true], 'dup-out': ['Already collected', true],
  'ok-out-noin': ['Checked out, never checked in', true], 'dup-outd': ['Already checked out', true]
};
function showResult(item, kind, prev, mode) {
  var readAs = S && S.readAs ? S.readAs : ''; if (S) S.readAs = '';
  var z = zoneInfo(item.zone), fg = textOn(z.color), t = RESULT_TEXT[kind];
  var label = t[0];
  if (kind === 'dup-in' && item.inAt) label += ' ' + fmtT(item.inAt);
  if (kind === 'dup-outd' && item.outAt) label += ' ' + fmtT(item.outAt);
  var el;
  var canNote = kind !== 'view' && (Perms.can(mode === 'in' ? 'checkin' : 'checkout', item) || Perms.can('damage', item));
  var curNote = item.note && item.note !== 'Not on the original list' ? item.note : '';
  var ta = h('textarea', { class: 'resnote', rows: 3, placeholder: 'Type a note for this item', value: curNote, hidden: curNote ? null : true, 'aria-label': 'Note' });
  var nb = h('button', { class: 'btn ghost small notebtn', onclick: function () { ta.hidden = false; nb.hidden = true; ta.focus(); } }, icon('pencil'), curNote ? 'Edit note' : 'Add note');
  function saveNote() {
    if (!canNote) return;
    var v = ta.value.trim();
    if (v !== curNote) { curNote = v; item.note = v; saveItem(item); toast(v ? 'Note saved' : 'Note removed'); }
  }
  function done() { saveNote(); closeOv(el); }
  ta.addEventListener('change', saveNote);
  var undo = h('button', { class: 'btn', onclick: async function () {
    item.status = prev.status; item.inAt = prev.inAt; item.outAt = prev.outAt;
    await saveItem(item); done(); refreshView(); toast('Undone');
  } }, kind.indexOf('ok') === 0 ? 'Undo' : 'Close');
  var acts = [undo];
  if (kind === 'view') {
    acts = [h('button', { class: 'btn', onclick: done }, 'Close')];
  } else if (kind === 'dup-out') {
    acts = [h('button', { class: 'btn', onclick: done }, 'Close'),
      h('button', { class: 'btn', onclick: async function () {
        item.status = 'in'; item.inAt = Date.now(); item.outAt = null; await saveItem(item); done(); refreshView(); toast('Checked in again');
      } }, 'Check in again')];
  } else {
    acts.push(h('button', { class: 'btn', onclick: done }, 'Next'));
  }
  el = h('div', { class: 'result', style: { background: z.color, color: fg } },
    h('span', { class: 'state' + (t[1] ? ' warn' : '') }, label),
    h('div', { class: 'goto' }, mode === 'in' ? 'Take to' : 'Collect from'),
    h('div', { class: 'zonebig', style: { fontSize: fitSize(item.zone || 'No zone') } }, item.zone || 'No zone'),
    h('div', { class: 'locbig' }, dropKind(item)),
    h('div', { class: 'who' },
      h('div', { class: 'sn' }, nm(item)),
      item.desc ? h('div', { class: 'ds' }, item.desc) : null,
      item.group ? h('div', { class: 'ds', style: { opacity: '.85' } }, item.group) : null,
      readAs ? h('div', { class: 'ds', style: { opacity: '.85' } }, 'Read from the label: ' + readAs) : null,
      pinsFor(P.project, item).length ? h('button', { class: 'btn small', style: { justifySelf: 'start', marginTop: '6px' }, onclick: function () { openPlan({ zone: item.zone, kind: dropKind(item) }); } }, pinsFor(P.project, item).length > 1 ? 'Show ' + pinsFor(P.project, item).length + ' pins on plan' : 'Show on plan') : null),
    canNote ? h('div', { class: 'notewrap' }, nb, ta) : null,
    h('div', { class: 'acts' }, acts));
  openOv(el);
}

/* find, choose and add sheet */
function bestToken(text) {
  var toks = Match.tokensFromText(text || '').filter(function (t) { return t.n === 1 && /\d/.test(t.k) && t.k.length >= 4 && t.k.length <= 24; });
  function score(t) {
    return (/[A-Za-z]/.test(t.raw) ? 2 : 0) + (/-/.test(t.raw) ? 1 : 0) + (t.k.length >= 6 && t.k.length <= 16 ? 1 : 0) + Math.min(3, (t.k.match(/\d/g) || []).length) * 0.2;
  }
  toks.sort(function (a, b) { return score(b) - score(a); });
  return toks.length ? toks[0].raw : '';
}
/* Items with no label are tracked by a photo. The photo is the label. */
function unlabelled(it) { return !it.serial; }
async function photoCheck(item) {
  var mode = P.project.mode;
  if (!Perms.can(mode === 'in' ? 'checkin' : 'checkout', item)) { applyScan(item, null); return; }
  var blob = await Photos.shoot({ title: nm(item), hint: 'Photo of the item. The photo is its label.' });
  if (!blob) return;
  await Photos.save(item.id + ':' + mode, blob);
  item.ph = item.ph || {}; item.ph[mode] = 1;
  await saveItem(item);
  if (bulk(item)) { refreshView(); toast('Photo saved. Count the pieces.'); itemSheet(item); }
  else applyScan(item, null);
}
function noLabelSheet() {
  var q = h('input', { type: 'search', placeholder: 'Search description or pallet', autocomplete: 'off' });
  var list = h('div', { class: 'items' }), head = h('div', { class: 'label' }), sh;
  function draw() {
    var term = q.value.trim().toLowerCase();
    var rows = P.items.filter(unlabelled).filter(function (it) { return !term || ((it.desc || '') + ' ' + (it.group || '') + ' ' + (it.zone || '')).toLowerCase().indexOf(term) >= 0; });
    rows.sort(function (a, b) { return (alreadyDone(a) ? 1 : 0) - (alreadyDone(b) ? 1 : 0) || a.ord - b.ord; });
    head.textContent = rows.length ? rows.length + ' with no label. The ones still to do come first.' : (term ? 'Nothing matches' : 'Every item has a label.');
    list.replaceChildren.apply(list, rows.slice(0, 80).map(function (it) { return itemRow(it, function () { closeOv(sh.el); photoCheck(it); }); }));
  }
  q.addEventListener('input', draw);
  sh = sheet('Item with no label', [h('p', { style: { margin: 0, color: 'var(--ink2)' } }, 'Pick the item, then take a photo of it. The photo shows the team what you checked.'), q, head, list]);
  draw();
}

function findSheet(opts) {
  var cands = (opts.candidates || []).map(function (c) { return c.item; });
  var input = h('input', { type: 'search', class: 'mono', placeholder: 'Type serial or description', autocomplete: 'off', value: '' });
  var results = h('div', { class: 'items' });
  var heading = h('div', { class: 'label' });
  var sh;
  function choose(it) { var t = opts.thumb || null; closeOv(sh.el); if (S && S.inside) openInside(it); else if (bulk(it)) itemSheet(it); else applyScan(it, t); }
  function draw() {
    var q = input.value.trim(), list;
    if (!q) { list = cands; heading.textContent = cands.length ? 'Possible matches' : 'Type at least 3 characters'; }
    else { list = Match.searchItems(P.items, q, 30); heading.textContent = list.length ? list.length + ' found' : 'Nothing matches'; }
    results.replaceChildren.apply(results, list.map(function (it) { return itemRow(it, function () { choose(it); }); }));
    addBtn.hidden = !(q.length >= 3 || (!q && opts.ocrText));
  }
  var addBtn = h('button', { class: 'btn block', onclick: function () { addUnlistedSheet(sh, input.value.trim() || bestToken(opts.ocrText), opts); } }, icon('plus'), 'Not on the list. Add it');
  input.addEventListener('input', draw);
  var readBox = opts.ocrText ? h('div', { class: 'note', style: { background: 'var(--panel2)', color: 'var(--ink2)', border: '1px solid var(--line)', fontWeight: '500' } },
    h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Camera read'),
    h('span', { class: 'mono', style: { fontSize: '13px', overflowWrap: 'anywhere' } }, (opts.ocrText.replace(/\s+/g, ' ').trim().slice(0, 140)) || 'No text found')) : null;
  sh = sheet(opts.ocrText !== undefined ? (cands.length ? 'Which one is it?' : 'No match') : 'Find item', [readBox, input, heading, results, addBtn]);
  draw();
  if (opts.ocrText === undefined) setTimeout(function () { input.focus(); }, 120);
  if (opts.ocrText !== undefined && !cands.length) { input.value = bestToken(opts.ocrText); draw(); }
}

function addUnlistedSheet(parentSheet, serial, opts) {
  var zones = P.project.zones.map(function (z) { return z.name; });
  var sn = h('input', { type: 'text', class: 'mono', value: serial || '' });
  var ds = h('input', { type: 'text', placeholder: 'What is it' });
  var gp = h('input', { type: 'text', placeholder: 'Client or department' });
  var zs = h('select', null, zones.map(function (z) { return h('option', { value: z }, z); }).concat([h('option', { value: '__new' }, 'New zone')]));
  var zn = h('input', { type: 'text', placeholder: 'New zone name', hidden: true });
  if (P.project.lastZone && zones.indexOf(P.project.lastZone) >= 0) zs.value = P.project.lastZone;
  zs.addEventListener('change', function () { zn.hidden = zs.value !== '__new'; });
  var s2;
  var save = h('button', { class: 'btn primary block', onclick: async function () {
    var serialV = sn.value.trim(); if (!serialV) { toast('Enter a serial number'); return; }
    var zone = zs.value === '__new' ? zn.value.trim() : zs.value;
    if (zone) { P.project.lastZone = zone; Store.putProject(P.project); }
    var it = { id: Store.uid(), pid: P.project.id, serial: serialV, alt: '', desc: ds.value.trim(), group: gp.value.trim(), zone: zone || 'Unassigned',
               status: 'wait', inAt: null, outAt: null, note: 'Not on the original list', unlisted: true, ord: P.items.length ? P.items[P.items.length - 1].ord + 1 : 0, raw: [] };
    P.items.push(it); reindex(); zoneInfo(it.zone);
    await saveItem(it);
    closeOv(parentSheet.el);
    applyScan(it, opts.thumb || null);
  } }, 'Add and ' + (P.project.mode === 'in' ? 'check in' : 'check out'));
  s2 = sheet('Add unlisted item', [
    h('div', { class: 'field' }, h('span', null, 'Serial number'), sn),
    h('div', { class: 'field' }, h('span', null, 'Description'), ds),
    h('div', { class: 'field' }, h('span', null, 'Group'), gp),
    h('div', { class: 'field' }, h('span', null, 'Zone'), zs, zn), save]);
}

/* ===================== list ===================== */
function itemRow(it, onclick) {
  var z = zoneInfo(it.zone);
  var when = it.status === 'in' ? fmtT(it.inAt) : it.status === 'out' ? fmtT(it.outAt) : '';
  return h('button', { class: 'item', onclick: onclick },
    h('div', { class: 'strip', style: { background: z.color } }),
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'sn' }, nm(it)),
      it.serial && it.desc ? h('div', { class: 'ds' }, it.desc) : (bulk(it) ? h('div', { class: 'ds' }, '' + it.qty + ' pieces, no label') : (!it.serial ? h('div', { class: 'ds' }, 'No label') : null)),
      h('div', { class: 'meta' }, zoneChip(it.zone), it.group ? h('span', null, it.group) : null)),
    h('div', { class: 'rt' }, statusBadge(it), it.unlisted ? h('span', { class: 'badge unl' }, 'Unlisted') : null, when ? h('span', null, when) : null));
}

function listView() {
  var ui = P.ui;
  var box = h('div', { class: 'items' }), count = h('div', { class: 'mute', style: { fontSize: '14px' } });
  var more = h('button', { class: 'btn block', onclick: function () { ui.limit += 150; draw(); } }, 'Show more');
  function filtered() {
    var a = P.items;
    if (ui.zone) a = a.filter(function (i) { return i.zone === ui.zone; });
    if (ui.filter === 'wait') a = a.filter(function (i) { return i.status === 'wait'; });
    else if (ui.filter === 'in') a = a.filter(function (i) { return i.status === 'in'; });
    else if (ui.filter === 'out') a = a.filter(function (i) { return i.status === 'out'; });
    else if (ui.filter === 'unl') a = a.filter(function (i) { return i.unlisted; });
    var q = ui.q.trim();
    if (q) {
      var low = q.toLowerCase(), key = Match.norm(q);
      a = a.filter(function (i) {
        return (key && (Match.norm(i.serial).indexOf(key) !== -1 || Match.norm(i.alt).indexOf(key) !== -1)) ||
          (i.desc || '').toLowerCase().indexOf(low) !== -1 || (i.group || '').toLowerCase().indexOf(low) !== -1 ||
          (i.zone || '').toLowerCase().indexOf(low) !== -1 ||
          (i.raw || []).some(function (r) { return String(r[1]).toLowerCase().indexOf(low) !== -1; });
      });
    }
    if (ui.filter === 'in') a = a.slice().sort(function (x, y) { return (y.inAt || 0) - (x.inAt || 0); });
    if (ui.filter === 'out') a = a.slice().sort(function (x, y) { return (y.outAt || 0) - (x.outAt || 0); });
    return a;
  }
  function draw() {
    var a = filtered();
    count.textContent = a.length + (a.length === 1 ? ' item' : ' items');
    box.replaceChildren.apply(box, a.slice(0, ui.limit).map(function (it) { return itemRow(it, function () { itemSheet(it); }); }));
    more.hidden = a.length <= ui.limit;
    if (!a.length) box.appendChild(h('div', { class: 'empty' }, h('p', { style: { margin: 0 } }, 'Nothing here yet.')));
  }
  P.redraw = draw;
  var q = h('input', { type: 'search', placeholder: 'Search name, code, case or pallet', value: ui.q, 'aria-label': 'Search' });
  q.addEventListener('input', function () { ui.q = q.value; ui.limit = 100; draw(); });
  var chipsEl = h('div', { class: 'chips' });
  function drawChips() {
    var c = counts(P.items);
    var defs = [['all', 'All ' + c.total], ['wait', 'Waiting ' + c.wait], ['in', 'In ' + c.in], ['out', 'Out ' + c.out]];
    if (c.unl) defs.push(['unl', 'Unlisted ' + c.unl]);
    chipsEl.replaceChildren.apply(chipsEl, defs.map(function (d) {
      return h('button', { class: 'chip', 'aria-pressed': String(ui.filter === d[0]), onclick: function () { ui.filter = d[0]; ui.limit = 100; drawChips(); draw(); } }, d[1]);
    }));
    if (ui.zone) chipsEl.appendChild(h('button', { class: 'chip', 'aria-pressed': 'true', onclick: function () { ui.zone = null; drawChips(); draw(); } }, 'Zone: ' + ui.zone + '  ×'));
  }
  var origRedraw = draw;
  P.redraw = function () { drawChips(); origRedraw(); };
  drawChips(); draw();
  return h('div', { class: 'scroll' }, h('div', { class: 'listhead' }, q, chipsEl), count, box, more);
}

/* item detail */
function itemSheet(it) {
  var urls = [];
  var body = h('div', { style: { display: 'grid', gap: '12px' } });
  var sh;
  function setStatus(st) {
    return async function () {
      if (!Perms.ok(st === 'in' ? 'checkin' : st === 'out' ? 'checkout' : 'edit', it)) return;
      if (st === 'in') { it.status = 'in'; it.inAt = it.inAt || Date.now(); it.outAt = null; if (it.status === 'in' && !it.inAt) it.inAt = Date.now(); }
      else if (st === 'out') { it.status = 'out'; it.outAt = Date.now(); }
      else { it.status = 'wait'; it.inAt = null; it.outAt = null; }
      await saveItem(it); refreshView(); drawBody();
    };
  }
  function stepper(label, key, max) {
    var val = h('b', { style: { fontSize: '30px', minWidth: '3ch', textAlign: 'center', fontFamily: 'var(--display)' } }, (it[key] || 0) + ' / ' + max);
    var bump = function (d) {
      return async function () {
        if (!Perms.ok('count', it)) return;
        it[key] = Math.max(0, Math.min(max, (it[key] || 0) + d));
        if (key === 'got' && it.gone > it.got) it.gone = it.got;
        if (it.got > 0 && !it.inAt) it.inAt = Date.now();
        syncQty(it); await saveItem(it); refreshView(); drawBody();
      };
    };
    return h('div', { class: 'field' }, h('span', null, label),
      h('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'space-between' } },
        h('button', { class: 'btn', 'aria-label': 'One less', onclick: bump(-1) }, '-'), val,
        h('button', { class: 'btn primary', 'aria-label': 'One more', onclick: bump(1) }, '+'),
        h('button', { class: 'btn small', onclick: async function () { if (!Perms.ok('count', it)) return; it[key] = max; if (key === 'gone') it.got = max; syncQty(it); await saveItem(it); refreshView(); drawBody(); } }, 'All')));
  }
  function bulkControls() {
    return h('div', { style: { display: 'grid', gap: '12px' } },
      stepper('Arrived, of ' + it.qty, 'got', it.qty), stepper('Collected, of ' + it.qty, 'gone', it.qty));
  }
  function drawBody() {
    body.replaceChildren();
    var kv = h('dl', { class: 'kv', style: { margin: 0 } });
    function row(k, v) { if (v) kv.append(h('dt', null, k), h('dd', null, v)); }
    row('Description', it.desc); row('Group', it.group); row('Second ID', it.alt);
    row('Checked in', fmtT(it.inAt)); row('Checked out', fmtT(it.outAt));
    (it.raw || []).forEach(function (p) {
      if (p[1] !== it.serial && p[1] !== it.desc && p[1] !== it.group && p[1] !== it.alt && p[1] !== it.zone) row(p[0], p[1]);
    });
    var note = h('textarea', { rows: 2, placeholder: 'Note', value: it.note || '', style: { minHeight: '70px' } });
    note.addEventListener('change', function () { if (!Perms.ok('edit', it)) { note.value = it.note || ''; return; } it.note = note.value; saveItem(it); });
    body.append(
      h('div', { class: 'row wrap' }, statusBadge(it), it.unlisted ? h('span', { class: 'badge unl' }, 'Not on list') : null, zoneChip(it.zone),
        h('button', { class: 'btn small', onclick: function () { pickZoneSheet(it, drawBody); } }, 'Change zone')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: function () { openInside(it); } }, 'Inside check' + (it.chk && it.chk.lines && it.chk.lines.length ? ' (' + it.chk.lines.length + ')' : '')),
        h('button', { class: 'btn small', onclick: function () { openDamage(it); } }, 'Damage' + (it.dmg && it.dmg.length ? ' (' + it.dmg.length + ')' : '')),
        unlabelled(it) ? h('button', { class: 'btn small', onclick: function () { closeOv(sh.el); photoCheck(it); } }, 'Photo as label') : null),
      h('div', { class: 'row wrap' }, h('span', { class: 'badge' }, 'Drop off: ' + dropKind(it) + (it.drop ? '' : ' (auto)')),
        h('button', { class: 'btn small', onclick: function () { pickDropSheet(it, drawBody); } }, 'Change drop off')),
      bulk(it) ? bulkControls() : h('div', { class: 'row' },
        h('button', { class: 'btn small grow', onclick: setStatus('in') }, 'In'),
        h('button', { class: 'btn small grow', onclick: setStatus('out') }, 'Out'),
        h('button', { class: 'btn small grow', onclick: setStatus('wait') }, 'Waiting')),
      kv, h('div', { class: 'field' }, h('span', null, 'Note'), note));
    ['in', 'out'].forEach(function (m) {
      var key = it.id + ':' + m;
      Photos.url(key).then(function (u) {
        if (!u) return;
        body.append(h('div', { class: 'label' }, m === 'in' ? 'Check in photo' : 'Check out photo'), h('img', { class: 'photo', src: u, alt: 'Photo at ' + m, onclick: function () { viewPhoto(key, m === 'in' ? 'Check in photo' : 'Check out photo'); } }));
      });
    });
  }
  sh = sheet(nm(it), [body], { onClose: function () { urls.forEach(URL.revokeObjectURL); } });
  sh.el.querySelector('h2').className = 'mono';
  sh.el.querySelector('h2').style.fontSize = '22px';
  drawBody();
}
function pickDropSheet(it, done) {
  var s, same = it.group ? P.items.filter(function (x) { return x.group === it.group && x.id !== it.id; }) : [];
  var all = h('input', { type: 'checkbox', id: 'dropAll' });
  function choose(k) {
    return async function () {
      var list = [it]; if (all.checked) list = list.concat(same);
      list.forEach(function (x) { if (k) x.drop = k; else delete x.drop; });
      await Store.putItems(list); closeOv(s.el); refreshView(); done();
    };
  }
  var rows = DROP_KINDS.map(function (k) { return h('button', { class: 'item', style: { gridTemplateColumns: '1fr' }, onclick: choose(k) }, h('div', { class: 'sn', style: { fontFamily: 'var(--display)', fontSize: '22px', textTransform: 'uppercase' } }, k)); });
  rows.push(h('button', { class: 'item', style: { gridTemplateColumns: '1fr' }, onclick: choose(null) }, h('div', { class: 'sn' }, 'Automatic: ' + dropGuess(it))));
  s = sheet('Drop off', [h('div', { class: 'items' }, rows), same.length ? h('label', { class: 'row', style: { gap: '10px' } }, all, 'Same for all ' + (same.length + 1) + ' items in ' + it.group) : null]);
}
function pickZoneSheet(it, done) {
  var s;
  var zl = P.project.zones.slice().sort(function (x, y) { return (y.name === P.project.lastZone) - (x.name === P.project.lastZone); });
  var rows = zl.map(function (z) {
    return h('button', { class: 'item', style: { gridTemplateColumns: '8px 1fr' }, onclick: async function () { it.zone = z.name; P.project.lastZone = z.name; Store.putProject(P.project); await saveItem(it); closeOv(s.el); refreshView(); done(); } },
      h('div', { class: 'strip', style: { background: z.color } }), h('div', { class: 'sn', style: { fontFamily: 'var(--display)', fontSize: '22px', textTransform: 'uppercase' } }, z.name));
  });
  s = sheet('Change zone', [h('div', { class: 'items' }, rows)]);
}

/* ===================== zones ===================== */
function zoneStats() {
  var m = {};
  P.project.zones.forEach(function (z) { m[z.name] = { zone: z, total: 0, in: 0, out: 0 }; });
  P.items.forEach(function (i) {
    var name = i.zone || '';
    if (!m[name]) m[name] = { zone: zoneInfo(name), total: 0, in: 0, out: 0 };
    m[name].total++; if (i.status === 'in') m[name].in++; else if (i.status === 'out') m[name].out++;
  });
  return Object.keys(m).map(function (k) { return m[k]; }).filter(function (z) { return z.total > 0; });
}
function zonesView() {
  var stats = zoneStats();
  var cards = stats.map(function (s) {
    var z = s.zone, arrived = s.in + s.out;
    return h('div', { class: 'zcard' },
      h('div', { class: 'zname', style: { background: z.color, color: textOn(z.color) } }, z.name || 'No zone'),
      h('button', { class: 'zbody', onclick: function () { P.ui.zone = z.name; P.ui.filter = 'all'; replaceScreen({ s: 'project', tab: 'list' }); } },
        h('div', { class: 'stats' }, h('span', null, h('b', null, arrived), ' of ' + s.total + ' in'), s.out ? h('span', null, h('b', null, s.out), ' out') : null),
        h('div', { class: 'bar' }, h('i', { class: 'b-in', style: { width: (s.in / s.total * 100) + '%' } }), h('i', { class: 'b-out', style: { width: (s.out / s.total * 100) + '%' } })),
        h('div', { class: 'mute', style: { fontSize: '14px' } }, (s.total - arrived) + ' still to arrive')),
      h('button', { class: 'iconbtn edit', 'aria-label': 'Edit zone', onclick: function () { editZoneSheet(z); } }, icon('pencil')));
  });
  return h('div', { class: 'scroll' }, cards.length ? cards : h('div', { class: 'empty' }, h('p', null, 'No zones yet.')));
}
function editZoneSheet(z) {
  var name = h('input', { type: 'text', value: z.name });
  var color = z.color;
  var sw = h('div', { class: 'swatches' });
  function drawSw() {
    sw.replaceChildren.apply(sw, PALETTE.map(function (c) {
      return h('button', { class: 'swatch', style: { background: c }, 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === color), onclick: function () { color = c; drawSw(); } });
    }));
  }
  drawSw();
  var s;
  var save = h('button', { class: 'btn primary block', onclick: async function () {
    var nn = name.value.trim(); if (!nn) { toast('Enter a name'); return; }
    var old = z.name, changed = [];
    z.color = color;
    if (nn !== old) {
      var clash = P.project.zones.find(function (x) { return x !== z && x.name.toLowerCase() === nn.toLowerCase(); });
      P.items.forEach(function (i) { if (i.zone === old) { i.zone = clash ? clash.name : nn; changed.push(i); } });
      if (clash) P.project.zones = P.project.zones.filter(function (x) { return x !== z; });
      else z.name = nn;
    }
    await Store.putProject(P.project);
    if (changed.length) await Store.putItems(changed);
    closeOv(s.el); refreshView();
  } }, 'Save');
  s = sheet('Edit zone', [h('div', { class: 'field' }, h('span', null, 'Name'), name), h('div', { class: 'field' }, h('span', null, 'Colour'), sw), save]);
}

/* ===================== menu and export ===================== */
function buildCSV() {
  var p = P.project, extra = p.cols || [];
  var anyBulk = P.items.some(bulk);
  var rows = [['Serial', 'Second ID', 'Description', 'Group', 'Zone', 'Status', 'Checked in', 'Checked out', 'Note', 'Not on list'].concat(anyBulk ? ['Pieces', 'Pieces arrived', 'Pieces collected'] : [], extra)];
  P.items.forEach(function (i) {
    var raw = {}; (i.raw || []).forEach(function (pr) { raw[pr[0]] = pr[1]; });
    rows.push([i.serial, i.alt, i.desc, i.group, i.zone, i.status === 'in' ? 'In' : i.status === 'out' ? 'Out' : 'Waiting',
      fmtFull(i.inAt), fmtFull(i.outAt), i.note === 'Not on the original list' ? '' : i.note, i.unlisted ? 'Yes' : ''].concat(anyBulk ? [bulk(i) ? i.qty : 1, bulk(i) ? (i.got || 0) : (i.status !== 'wait' ? 1 : 0), bulk(i) ? (i.gone || 0) : (i.status === 'out' ? 1 : 0)] : [], extra.map(function (c) { return raw[c] || ''; })));
  });
  return toCSV(rows);
}
function menuView() {
  var p = P.project;
  var MENU_PERM = { 'Share report (CSV)': 'report', 'Add another document': 'manage', 'Rename project': 'manage', 'Save a backup': 'manage', 'Reset all check ins': 'wipe', 'Delete project': 'wipe' };
  var b = function (label, fn, cls) { var pm = MENU_PERM[label]; return h('button', { class: 'btn ' + (cls || ''), onclick: pm ? function () { if (Perms.ok(pm)) fn(); } : fn }, label); };
  return h('div', { class: 'scroll' },
    h('div', { class: 'menu' },
      b('Report and PDF', function () { goScreen({ s: 'report' }); }, 'primary'),
      b('Team sync' + (p.team ? ' · ' + p.team.code : ''), teamSheet),
      b('Your name: ' + (Store.who() || 'not set'), nameSheet),
      p.team && Perms.isAdmin() ? b('Phones and permissions', phonesSheet) : null,
      b('Site plan', function () { openPlan({}); }),
      b('Share report (CSV)', function () { shareText(p.name + ' report.csv', buildCSV()); }),
      b('Add another document', function () { startImport(p.id); }),
      b('Rename project', renameSheet),
      b('Theme: ' + themeName(), cycleTheme),
      b('Check for updates', checkUpdates),
      b('Save a backup', function () { shareText(p.name + ' backup.json', JSON.stringify({ app: 'casecheck', project: p, items: P.items })); }),
      Perms.can('wipe') ? b('Reset all check ins', async function () {
        if (!(await confirmDlg({ title: 'Reset everything?', body: 'Every item goes back to Waiting. Photos stay.', ok: 'Reset', danger: true }))) return;
        P.items.forEach(function (i) { i.status = 'wait'; i.inAt = null; i.outAt = null; i.got = 0; i.gone = 0; });
        await Store.putItems(P.items); refreshView(); toast('All items are waiting again');
      }, 'danger') : null,
      Perms.can('wipe') ? b('Delete project', async function () {
        if (!(await confirmDlg({ title: 'Delete "' + p.name + '"?', body: 'The list, check ins and photos are removed from this phone.', ok: 'Delete', danger: true }))) return;
        if (p.plan) await planClear(); await Store.deleteProject(p.id); P = null; Nav.stack = [{ t: 'screen', route: { s: 'home' } }]; render();
      }, 'danger') : null),
    h('div', { class: 'ver' }, verLine()), h('div', { class: 'ver credit' }, 'Created and operated by M Barnard'));
}
/* ===================== report ===================== */
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise(function (res, rej) {
    var sc = document.createElement('script');
    sc.src = '/lib/jspdf.umd.min.js'; sc.onload = res; sc.onerror = function () { rej(new Error('Could not start the PDF maker.')); };
    document.head.appendChild(sc);
  });
}
function bufToB64(buf) {
  var bytes = new Uint8Array(buf), bin = '', n = 0x8000;
  for (var i = 0; i < bytes.length; i += n) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + n));
  return btoa(bin);
}
function reportScreen() {
  var p = P.project;
  p.report = p.report || {};
  var st = P.rep = P.rep || { type: 'in', zone: '*' };
  var cur = function () { p.report[st.type] = p.report[st.type] || { comment: '', by: '' }; return p.report[st.type]; };
  var saveRep = function () { Store.putProject(p); };
  var zoneNames = P.project.zones.map(function (z) { return z.name; }).filter(function (n) { return P.items.some(function (i) { return i.zone === n; }); });
  var inScope = function () { return P.items.filter(function (i) { return st.zone === '*' || i.zone === st.zone; }); };
  var view = h('div', { class: 'scroll' });

  function draw() {
    var items = inScope(), sum = Report.summary(items, st.type), c = cur();
    var word = st.type === 'in' ? 'Received' : 'Collected';
    var attention = items.filter(function (i) { return !i.unlisted && !Report.standing(i, st.type).ok; });
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Report type' },
      h('button', { 'aria-pressed': String(st.type === 'in'), onclick: function () { st.type = 'in'; draw(); } }, 'Receiving'),
      h('button', { 'aria-pressed': String(st.type === 'out'), onclick: function () { st.type = 'out'; draw(); } }, 'Check out'));
    var zsel = h('select', { onchange: function (e) { st.zone = e.target.value; draw(); } },
      [h('option', { value: '*', selected: st.zone === '*' }, 'All zones')].concat(zoneNames.map(function (n) { return h('option', { value: n, selected: st.zone === n }, n); })));
    var pct = sum.lines ? sum.ok / sum.lines * 100 : 0;
    var card = h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'stats' }, h('span', null, h('b', null, sum.ok), ' of ' + sum.lines + ' ' + word.toLowerCase()),
        sum.bad ? h('span', null, h('b', null, sum.bad), st.type === 'in' ? ' missing or short' : ' still on site') : h('span', null, h('b', null, 'Complete'))),
      h('div', { class: 'bar' }, h('i', { class: 'b-in', style: { width: pct + '%' } })),
      sum.unl ? h('div', { class: 'mute', style: { fontSize: '14px' } }, sum.unl + ' not on the list') : null);
    var rows = attention.slice(0, 60).map(function (it) {
      var inp = h('input', { type: 'text', placeholder: 'Comment', value: it.note && it.note !== 'Not on the original list' ? it.note : '' });
      inp.addEventListener('change', function () { it.note = inp.value; saveItem(it); });
      return h('div', { class: 'card', style: { display: 'grid', gap: '8px', padding: '12px' } },
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'start' } },
          h('div', { style: { minWidth: 0 } }, h('div', { class: 'sn mono', style: { fontWeight: '600', overflowWrap: 'anywhere' } }, nm(it)),
            h('div', { class: 'mute', style: { fontSize: '14px' } }, it.serial ? it.desc : 'No label')),
          h('div', { style: { display: 'grid', gap: '6px', justifyItems: 'end' } }, zoneChip(it.zone), h('span', { class: 'badge wait' }, Report.standing(it, st.type).text.toLowerCase()))), inp);
    });
    var comment = h('textarea', { rows: 4, placeholder: 'Comments for the report', value: c.comment || '', style: { minHeight: '110px' } });
    comment.addEventListener('change', function () { c.comment = comment.value; saveRep(); });
    var by = h('input', { type: 'text', placeholder: 'Your name', value: c.by || '' });
    by.addEventListener('change', function () { c.by = by.value; saveRep(); });
    var exp = h('button', { class: 'btn primary block', onclick: function () { exp.disabled = true; exportPdf().then(function () { exp.disabled = false; }); } }, 'Export PDF');
    var nodes = [seg, h('label', { class: 'field' }, h('span', null, 'Zone'), zsel), card,
      attention.length ? h('div', { class: 'label' }, (st.type === 'in' ? 'Missing or short' : 'Still on site') + ' (' + attention.length + ')') : null]
      .concat(rows,
        [attention.length > 60 ? h('div', { class: 'mute' }, 'and ' + (attention.length - 60) + ' more. They show in the PDF.') : null,
         h('label', { class: 'field' }, h('span', null, 'Comments'), comment),
         h('label', { class: 'field' }, h('span', null, 'Checked by'), by), exp]);
    view.replaceChildren.apply(view, nodes.filter(Boolean));
  }
  async function exportPdf() {
    try {
      await loadJsPdf();
      var c = cur(), zones = st.zone === '*' ? zoneNames : [st.zone];
      var photos = {}, keys = [];
      P.items.forEach(function (i) {
        if (zones.indexOf(i.zone) < 0) return;
        (i.dmg || []).forEach(function (d) { if (d.key) keys.push(d.key); });
        ((i.chk && i.chk.lines) || []).forEach(function (l) { if (l.key && l.v !== 'ok') keys.push(l.key); });
      });
      if (keys.length) toast('Adding ' + keys.length + ' photos');
      for (var ki = 0; ki < keys.length; ki += 4) {
        await Promise.all(keys.slice(ki, ki + 4).map(async function (k) { try { var im = await Photos.forPdf(k, 640); if (im) photos[k] = im; } catch (e2) { /* photo missing */ } }));
      }
      var doc = Report.build({ JsPDF: window.jspdf.jsPDF, type: st.type, project: p, items: P.items, zones: zones, comment: c.comment, by: c.by, now: Date.now(), photos: photos });
      var d = new Date(), ds = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      var name = (p.name + ' ' + (st.type === 'in' ? 'receiving' : 'check-out') + ' report ' + (st.zone === '*' ? 'all zones' : st.zone) + ' ' + ds + '.pdf').replace(/[\\/:*?"<>|]+/g, ' ');
      var buf = doc.output('arraybuffer');
      if (window.Android && Android.savePdf) {
        var res = String(Android.savePdf(name, bufToB64(buf)));
        toast(res.indexOf('ok') === 0 ? 'Saved to Downloads' : 'Could not save the PDF');
      } else {
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        toast('PDF made');
      }
    } catch (e) { console.error(e); toast('Could not make the PDF'); }
  }
  draw();
  return h('div', { class: 'screen' }, topbar('Report', p.name, function () { popScreen(); }), view);
}

function renameSheet() {
  var inp = h('input', { type: 'text', value: P.project.name });
  var s;
  s = sheet('Rename project', [h('div', { class: 'field' }, h('span', null, 'Name'), inp),
    h('button', { class: 'btn primary block', onclick: async function () { var n = inp.value.trim(); if (!n) return; P.project.name = n; await Store.putProject(P.project); closeOv(s.el); render(); } }, 'Save')]);
}

/* ===================== boot ===================== */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) Cam.stop();
  else if (S && S.mounted) startCamera();
});
applyTheme();
navInit(render);
// The app started. Tell the loader this bundle is good.
try { if (window.CC_WEB) localStorage.setItem('cc_web_ok', String(CC_WEB.v)); } catch (e) { /* ignore */ }

Sync.start();
render();
